import pika
import ssl
import json
import requests
import os
import time
import redis
import uuid
import logging
import hashlib

import observability as obs
from prometheus_client import Counter, Histogram

# Este worker no mina localmente: delega el cálculo pesado al servidor GPU
# vía HTTP y solo reporta el resultado.

# -------------------------
# OBSERVABILIDAD
# -------------------------
log = obs.setup_logging("worker-gpu")
obs.setup_tracing("worker-gpu")
obs.instrument_requests()  # las llamadas HTTP al gpu-server quedan trazadas
obs.instrument_redis()
tracer = obs.get_tracer("worker-gpu")
obs.start_metrics_server()

WORKER_TYPE = "gpu"
WORKER_TASKS = Counter("worker_tasks_processed_total", "Tareas procesadas", ["worker_type"])
WORKER_SOLUTIONS = Counter("worker_solutions_found_total", "Soluciones encontradas", ["worker_type"])
WORKER_TASK_SECONDS = Histogram(
    "worker_task_duration_seconds", "Duracion del minado de una sub-tarea (incluye HTTP a gpu-server)",
    ["worker_type"], buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60),
)

# Identificador único de este worker — antes no existía, por eso no había
# forma de saber CUÁL réplica encontró la solución (acá solo hay una réplica
# de gpu-server según el deployment, pero igual queda preparado si en algún
# momento se escala). Mismo patrón que ya usa worker_cpu.py.
WORKER_ID = str(uuid.uuid4())[:8]

GPU_SERVER_URL = os.getenv("GPU_SERVICE_URL", "http://gpu-service-internal:8000/mine")


def connect_redis():
    # Reintentamos como con RabbitMQ. Antes, si Redis no respondía al
    # primer ping, el worker se quedaba con r=None de por vida y toda su
    # telemetría (solucion_encontrada, etc.) se perdía silenciosamente.
    for intento in range(20):
        try:
            client = redis.Redis(host=os.getenv("REDIS_HOST", "redis"), port=6379, decode_responses=True)
            client.ping()
            log.info("Conectado a Redis")
            return client
        except Exception:
            log.warning(f"Redis no disponible (intento {intento+1}/20), reintentando en 3s...")
            time.sleep(3)
    log.error("Redis sigue sin responder tras 20 intentos — logs solo por consola")
    return None


def log_event(r, event: str, **fields):
    entry = {"timestamp": time.time(), "event": event, "worker_id": WORKER_ID, "tipo": "gpu", **fields}
    if r:
        try:
            r.rpush("logs", json.dumps(entry))
        except Exception:
            pass
    log.info(f"event={event} " + " ".join(f"{k}={v}" for k, v in fields.items()))


r = connect_redis()

def rabbitmq_ssl_context():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return pika.SSLOptions(ctx)

log.info(f"Conectando a RabbitMQ (worker_id={WORKER_ID})")
while True:
    try:
        connection = pika.BlockingConnection(
            pika.ConnectionParameters(
                os.getenv("RABBITMQ_HOST", "rabbitmq"),
                port=5671,
                ssl_options=rabbitmq_ssl_context(),
                heartbeat=180,
                blocked_connection_timeout=300,
            )
        )
        channel = connection.channel()
        break
    except pika.exceptions.AMQPConnectionError:
        log.warning("RabbitMQ no está listo todavía. Reintentando en 3 segundos...")
        time.sleep(3)

# Declaramos las mismas colas
channel.queue_declare(queue='tareas')
channel.queue_declare(queue='soluciones')


def callback(ch, method, properties, body):
    try:
        tarea = json.loads(body)
        log.info(f"[{WORKER_ID}] Procesando rango [{tarea['start']} - {tarea['end']}]...")

        # Continuamos la traza propagada por el TrP (contexto en el payload).
        parent_ctx = obs.extract_trace_context(tarea.get("_trace"))
        span_cm = tracer.start_as_current_span("worker_mine_gpu", context=parent_ctx) \
            if parent_ctx is not None else tracer.start_as_current_span("worker_mine_gpu")
        with span_cm as span:
            span.set_attribute("worker_id", WORKER_ID)
            span.set_attribute("range_start", tarea["start"])
            span.set_attribute("range_end", tarea["end"])
            WORKER_TASKS.labels(worker_type=WORKER_TYPE).inc()

            # 1. Delegamos el cálculo pesado al servidor central con GPU via HTTP
            payload = {
                "difficulty": tarea["difficulty"],
                "data": tarea["data"],
                "start": tarea["start"],
                "end": tarea["end"]
            }
            with WORKER_TASK_SECONDS.labels(worker_type=WORKER_TYPE).time():
                response = requests.post(GPU_SERVER_URL, json=payload, timeout=60)
                response.raise_for_status()
            stdout_data = response.json().get("stdout", "")

        nonce = None
        hash_resultado = None

        # 2. Parseamos la salida que nos devolvió el servidor de GPU
        for linea in stdout_data.splitlines():
            if linea.startswith("Nonce encontrado:"):
                nonce = int(linea.split(":")[1])
            if linea.startswith("Hash resultante:"):
                hash_resultado = linea.split(":")[1].strip()

        # 3. CRUCIAL: Solo publicamos si este worker REALMENTE encontró el nonce ganador
        if nonce is not None:
            log.info(f"[{WORKER_ID}] ¡CONSEGUIDO! Nonce ganador encontrado: {nonce}")
            solucion = {
                "task_id": tarea.get("task_id"),
                "nonce": nonce,
                "hash": hash_resultado
            }
            ch.basic_publish(
                exchange='',
                routing_key='soluciones',
                body=json.dumps(solucion)
            )
            WORKER_SOLUTIONS.labels(worker_type=WORKER_TYPE).inc()
            data_str = tarea.get("data", "")
            data_sha = hashlib.sha256(data_str.encode()).hexdigest() if data_str else "EMPTY"
            verify_calc = hashlib.md5((data_str + str(nonce)).encode()).hexdigest()
            log_event(
                r, "solucion_encontrada",
                task_id=tarea.get("task_id"),
                nonce=nonce, hash=hash_resultado,
                start=tarea["start"], end=tarea["end"],
                data_len=len(data_str),
                data_sha256=data_sha,
                local_md5_recompute=verify_calc,
                local_matches_binary=verify_calc == hash_resultado,
            )
        else:
            log.info(f"[{WORKER_ID}] No se encontró solución en el rango [{tarea['start']} - {tarea['end']}]")
        ch.basic_ack(
                delivery_tag=method.delivery_tag
            )
    except Exception as e:
        # Reintentar UNA sola vez y después soltar la tarea (ack), en vez de
        # requeue infinito. Antes, si el gpu-server estaba caído o timeouteaba,
        # cada tarea rebotaba para siempre (poison message) y generaba una
        # tormenta de requeue que saturaba el pipeline (bug M3). pika marca
        # method.redelivered=True cuando el mensaje ya fue entregado antes; lo
        # usamos como contador de 1 reintento. Si igual no se mina, el NCT
        # timeoutea y el auto-miner republica un task nuevo.
        already_retried = bool(method.redelivered)
        log.error(f"[{WORKER_ID}] Error procesando tarea (redelivered={already_retried}): {e}", exc_info=True)
        if already_retried:
            ch.basic_ack(delivery_tag=method.delivery_tag)
        else:
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

# Escuchamos de la cola 'tareas'
channel.basic_consume(
    queue="tareas",
    on_message_callback=callback,
    auto_ack=False
)
log.info(f"[{WORKER_ID}] Worker GPU esperando tareas...")
channel.start_consuming()
