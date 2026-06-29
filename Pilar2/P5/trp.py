import pika
import json
import time
import redis
import threading
import math
import logging
import ssl
import urllib.request

import observability as obs
from prometheus_client import Counter, Gauge

# TRP (Pool de Transacciones) es un intermediario inteligente entre el NCT y los workers.
# El NCT dice "minà este bloque", y el TrP se encarga de dividir ese trabajo, distribuirlo, y decidir si hay que cambiar de modo GPU a CPU.

# -------------------------
# OBSERVABILIDAD (logging JSON + métricas + trazas)
# -------------------------
log = obs.setup_logging("trp")
obs.setup_tracing("trp")
obs.instrument_redis()
tracer = obs.get_tracer("trp")
obs.start_metrics_server()  # /metrics en METRICS_PORT (default 9000)

TRP_TASKS = Counter("trp_tasks_subdivided_total", "Tareas del NCT subdivididas")
TRP_CHUNKS = Counter("trp_chunks_published_total", "Sub-tareas (chunks) publicadas a los workers")
TRP_FALLBACK_ACTIVE = Gauge("trp_fallback_active", "1 si el fallback a CPU esta activo")
TRP_GPU_ALIVE = Gauge("trp_gpu_alive", "1 si el gpu-server tiene heartbeat vivo")
TRP_SCALE_EVENTS = Counter("trp_cpu_scale_events_total", "Eventos de escalado de worker-cpu", ["action"])

# -------------------------
# CONEXIONES
# -------------------------

def connect_redis():
    while True:
        try:
            r = redis.Redis(host="redis", port=6379, decode_responses=True)
            r.ping()
            log.info("Conectado a Redis")
            return r
        except Exception:
            log.warning("Esperando Redis...")
            time.sleep(3)

def rabbitmq_ssl_context():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return pika.SSLOptions(ctx)

def connect_rabbitmq():
    while True:
        try:
            conn = pika.BlockingConnection(
                pika.ConnectionParameters(
                    "rabbitmq",
                    port=5671,
                    ssl_options=rabbitmq_ssl_context(),
                    heartbeat=180,
                    blocked_connection_timeout=300,
                )
            )
            log.info("Conectado a RabbitMQ (TLS)")
            return conn
        except Exception:
            log.warning("Esperando RabbitMQ...")
            time.sleep(3)

r = connect_redis()
connection = connect_rabbitmq()
channel = connection.channel()
channel.queue_declare(queue='tareas_pool')   # NCT → TrP
channel.queue_declare(queue='tareas')        # TrP → Workers
channel.queue_declare(queue='soluciones')
channel.queue_declare(queue='heartbeat_gpu') # gpu-server → TrP

# -------------------------
# MONITOREO DE GPU
# -------------------------

FALLBACK_DIFFICULTY = "0"    # dificultad reducida para CPU (1 cero)
GPU_DIFFICULTY = "00"        # dificultad normal con GPU (2 ceros). Es el valor
                             # canónico al que se restaura: no dependemos de haber
                             # guardado el original, así nunca queda pegada en "0".
ORIGINAL_DIFFICULTY_KEY = "difficulty_original"
CPU_WORKER_REPLICAS = 2     # réplicas de worker-cpu en modo fallback


def scale_cpu_workers(replicas: int):
    """Escala el deployment de worker-cpu usando la API de Kubernetes in-cluster."""
    try:
        token_path = "/var/run/secrets/kubernetes.io/serviceaccount/token"
        ca_path = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
        with open(token_path) as f:
            token = f.read().strip()
        url = (
            "https://kubernetes.default.svc/apis/apps/v1"
            "/namespaces/sdypp/deployments/blockchain-worker-cpu/scale"
        )
        patch = json.dumps({"spec": {"replicas": replicas}}).encode()
        ctx = ssl.create_default_context(cafile=ca_path)
        req = urllib.request.Request(
            url, data=patch, method="PATCH",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/merge-patch+json",
            },
        )
        urllib.request.urlopen(req, context=ctx, timeout=10)
        log.info(f"worker-cpu escalado a {replicas} réplicas")
    except Exception as e:
        log.error(f"Error escalando worker-cpu: {e}")

def heartbeat_consumer():
    """Consume mensajes de la cola heartbeat_gpu y actualiza Redis.

    Wrapped en un loop infinito con catch-all: si la conexión a RabbitMQ se
    cierra (heartbeat timeout, SSL EOF) o Redis devuelve un error transitorio
    (ReadOnly durante failover, timeout), reconectamos en 3s en vez de matar
    el thread. Antes una sola excepción mataba el thread, lo cual hacía que
    nadie renovara heartbeat:gpu-server, Redis lo expiraba en 30s y
    monitor_loop activaba fallback CPU como falso positivo.
    """
    def on_heartbeat(ch, method, properties, body):
        try:
            # set(..., ex=N) reemplaza a setex deprecado. Si Redis está en
            # estado read-only durante un failover, esta llamada lanza
            # ReadOnlyError — la capturamos arriba en el while True.
            r.set("heartbeat:gpu-server", "alive", ex=30)
        except Exception as e:
            log.warning(f"heartbeat write fallo (sigo consumiendo): {e}")

    while True:
        try:
            hb_conn = connect_rabbitmq()
            hb_ch = hb_conn.channel()
            hb_ch.queue_declare(queue='heartbeat_gpu')
            hb_ch.basic_consume(queue='heartbeat_gpu', on_message_callback=on_heartbeat, auto_ack=True)
            log.info("heartbeat_consumer escuchando")
            hb_ch.start_consuming()
        except Exception as e:
            log.error(f"heartbeat_consumer crashed: {e}. Reintento en 3s.")
            time.sleep(3)

threading.Thread(target=heartbeat_consumer, daemon=True).start()

def is_gpu_server_alive() -> bool:
    return r.exists("heartbeat:gpu-server") == 1


# Esta funcion corre en background. Cada 15s revisa si el gpu-server sigue vivo.
# Si no responde: reduce la dificultad y dispara el fallback CPU en la nube (GCP).
# Si vuelve: restaura la dificultad y destruye las instancias CPU que ya no hacen falta.
#
# Diseñada para correr en N réplicas del TrP a la vez:
# - El estado "estamos en fallback" vive en Redis (key FALLBACK_MODE_KEY), no
#   en memoria. Cualquier réplica puede leerlo.
# - Las transiciones (activar/restaurar) se hacen con SET NX atómico: solo
#   el primer TrP que detecta el cambio ejecuta el trabajo. Los demás ven el
#   flag ya cambiado y no hacen nada (evita guardar difficulty_original con
#   valor ya pisado, evita disparar scale_cpu_workers en duplicado, evita
#   doble log).
FALLBACK_MODE_KEY = "trp:fallback_active"

def activate_fallback():
    # SET NX: solo el primer TrP en detectar la caída entra al if.
    if not r.set(FALLBACK_MODE_KEY, "1", nx=True):
        return False
    log.warning("gpu-server no responde — activando fallback CPU")
    original = r.get("difficulty")
    # NX en el save del original: si otro TrP ya lo guardó (no debería pasar
    # con el flag NX de arriba, pero es defensa en profundidad), no lo pisamos.
    if original and original != FALLBACK_DIFFICULTY:
        r.set(ORIGINAL_DIFFICULTY_KEY, original, nx=True)
    r.set("difficulty", FALLBACK_DIFFICULTY)
    r.rpush("logs", json.dumps({
        "timestamp": time.time(),
        "event": "fallback_cpu_activado",
        "difficulty_anterior": original,
        "difficulty_nueva": FALLBACK_DIFFICULTY,
    }))
    TRP_SCALE_EVENTS.labels(action="scale_up").inc()
    scale_cpu_workers(CPU_WORKER_REPLICAS)
    return True

def restore_from_fallback():
    # Solo el primer TrP en detectar el regreso entra (DEL devuelve 1 si borró).
    if r.delete(FALLBACK_MODE_KEY) == 0:
        return False
    log.info("gpu-server activo de nuevo — restaurando modo GPU")
    original = r.get(ORIGINAL_DIFFICULTY_KEY)
    # Si no se guardó el original, o quedó en "0" (puede pasar si el fallback se
    # activó cuando la dificultad ya era "0" por flapping previo), volvemos al
    # default de GPU. Antes esto dejaba la dificultad pegada en "0" para siempre.
    if not original or original == FALLBACK_DIFFICULTY:
        original = GPU_DIFFICULTY
    r.set("difficulty", original)
    r.delete(ORIGINAL_DIFFICULTY_KEY)
    r.rpush("logs", json.dumps({
        "timestamp": time.time(),
        "event": "fallback_cpu_restaurado",
        "difficulty_restaurada": original,
    }))
    TRP_SCALE_EVENTS.labels(action="scale_down").inc()
    scale_cpu_workers(0)
    return True

def monitor_loop():
    while True:
        try:
            gpu_alive = is_gpu_server_alive()
            in_fallback = r.exists(FALLBACK_MODE_KEY) == 1
            # Reflejar el estado en Prometheus en cada iteración.
            TRP_GPU_ALIVE.set(1 if gpu_alive else 0)
            TRP_FALLBACK_ACTIVE.set(1 if in_fallback else 0)
            if not gpu_alive and not in_fallback:
                activate_fallback()
            elif gpu_alive and in_fallback:
                restore_from_fallback()
        except Exception as e:
            log.error(f"monitor_loop iter fallo (sigo intentando): {e}")
        time.sleep(15)

threading.Thread(target=monitor_loop, daemon=True).start()

# -------------------------
# SUBDIVISION DE TAREAS
# -------------------------

TOTAL       = 10_000_000
CHUNK_SIZE  = 2_500_000   # cada sub-tarea cubre este rango


# Recibe una tarea del NCT con start/end opcionales,
# la fragmenta en chunks y publica cada uno en 'tareas'.
# Cada chunk se publica como un mensaje separado en [tareas]. RabbitMQ los distribuye entre los workers disponibles automáticamente
def subdivide_and_publish(tarea: dict):
    task_id    = tarea.get("task_id")
    start      = tarea.get("start", 0)
    end        = tarea.get("end", TOTAL)
    difficulty = tarea.get("difficulty", r.get("difficulty"))
    data       = tarea["data"]

    total_range = end - start
    n_chunks    = math.ceil(total_range / CHUNK_SIZE)

    # Continuamos la traza que arrancó el NCT (contexto embebido en el payload).
    parent_ctx = obs.extract_trace_context(tarea.get("_trace"))
    span_cm = tracer.start_as_current_span("trp_subdivide", context=parent_ctx) \
        if parent_ctx is not None else tracer.start_as_current_span("trp_subdivide")
    with span_cm as span:
        span.set_attribute("task_id", str(task_id))
        span.set_attribute("chunks", n_chunks)
        log.info(f"Subdividiendo tarea en {n_chunks} chunks (dificultad: {difficulty})")

        # El contexto a propagar a los workers se toma del span actual.
        trace_ctx = obs.inject_trace_context()
        for i in range(n_chunks):
            chunk_start = start + i * CHUNK_SIZE
            chunk_end   = min(chunk_start + CHUNK_SIZE - 1, end)

            subtarea = {
                "task_id":    task_id,
                "difficulty": difficulty,
                "data":       data,
                "start":      chunk_start,
                "end":        chunk_end,
                "_trace":     trace_ctx,
            }

            channel.basic_publish(
                exchange='',
                routing_key='tareas',
                body=json.dumps(subtarea)
            )
            TRP_CHUNKS.inc()

    TRP_TASKS.inc()
    r.rpush("logs", json.dumps({
        "timestamp": time.time(),
        "event":     "trp_subdividio_tarea",
        "task_id":   task_id,
        "chunks":    n_chunks,
        "difficulty": difficulty
    }))

# -------------------------
# CONSUMER: tareas_pool
# -------------------------

def on_task(ch, method, properties, body):
    tarea = json.loads(body)
    subdivide_and_publish(tarea)

channel.basic_consume(queue='tareas_pool', on_message_callback=on_task, auto_ack=True)
log.info("Esperando tareas del NCT...")
channel.start_consuming()
