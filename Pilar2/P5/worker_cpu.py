import pika
import ssl
import json
import time
import redis
import uuid
import threading
import hashlib
import logging

import observability as obs
from prometheus_client import Counter, Histogram

# Este archivo es un minero de GPU... digo, de CPU.
# Su único trabajo es recibir un desafío matemático, resolverlo por fuerza bruta, y reportar la solución.
# No sabe nada de bloques, transacciones ni blockchain — solo mina

# -------------------------
# OBSERVABILIDAD
# -------------------------
log = obs.setup_logging("worker-cpu")
obs.setup_tracing("worker-cpu")
obs.instrument_redis()
tracer = obs.get_tracer("worker-cpu")
obs.start_metrics_server()

WORKER_TYPE = "cpu"
WORKER_TASKS = Counter("worker_tasks_processed_total", "Tareas procesadas", ["worker_type"])
WORKER_SOLUTIONS = Counter("worker_solutions_found_total", "Soluciones encontradas", ["worker_type"])
WORKER_TASK_SECONDS = Histogram(
    "worker_task_duration_seconds", "Duracion del minado de una sub-tarea",
    ["worker_type"], buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30),
)

WORKER_ID = str(uuid.uuid4())[:8] # Generamos un ID aleatorio único. Le tomamos solo los primeros 8 caracteres.
HAS_GPU = False # No mina en GPU

# Retry loop para conectarse a rabbitmq
def rabbitmq_ssl_context():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return pika.SSLOptions(ctx)

def connect_rabbitmq():
    while True:
        try:
            connection = pika.BlockingConnection(
                pika.ConnectionParameters(
                    "rabbitmq",
                    port=5671,
                    ssl_options=rabbitmq_ssl_context(),
                    heartbeat=180,
                    blocked_connection_timeout=300,
                )
            )
            log.info("Conectado a RabbitMQ (TLS)")
            return connection
        except Exception:
            log.warning("Esperando RabbitMQ...")
            time.sleep(3)

# Retry loop para conectarse a redis
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

r = connect_redis()
connection = connect_rabbitmq()

# Declaracion y creacion de colas
channel = connection.channel()
channel.queue_declare(queue='tareas') 
channel.queue_declare(queue='soluciones')


def log_event(event: str, **fields):
    """Mismo patrón de log centralizado que usan NCT y TrP: escribe en la
    clave 'logs' de Redis (visible vía GET /logs) y también en consola."""
    entry = {"timestamp": time.time(), "event": event, "worker_id": WORKER_ID, "tipo": "cpu", **fields}
    r.rpush("logs", json.dumps(entry))
    log.info(f"event={event} " + " ".join(f"{k}={v}" for k, v in fields.items()))


# Keep-alive, se identifica como CPU en redis. El TTL es clave: si el worker muere o se desconecta,
# después de 30 segundos esa clave desaparece sola de Redis.
# El TrP monitorea estas claves para saber cuántos workers están vivos y de qué tipo son.
def heartbeat_loop():
    while True:
        r.setex(f"heartbeat:{WORKER_ID}", 30, "cpu")
        time.sleep(10)

threading.Thread(target=heartbeat_loop, daemon=True).start()

# Algoritmo de minado (Proof of Work)
# data es el contenido del bloque (transacciones, hash anterior, etc.) serializado como string
# nonce es un número que se prueba uno por uno
# Se concatenan: data + nonce y se hashea con MD5
# El rango start/end es el fragmento que le asignó el TrP a este worker. Si no encuentra nada en ese rango, devuelve None, None.
# Si el hash resultante empieza con el prefijo de dificultad (ej: "00"), se encontró la solución
def mine_cpu(data: str, difficulty: str, start: int, end: int):
    for nonce in range(start, end + 1):
        text = data + str(nonce)
        h = hashlib.md5(text.encode()).hexdigest()
        if h.startswith(difficulty):
            return nonce, h
    return None, None

# Cuando RabbitMQ entrega un mensaje de la cola tareas, llama a esta función.
# El mensaje contiene:
# data: el bloque a minar
# difficulty: el prefijo requerido
# start y end: el rango de nonces a probar
# Si encuentra solución la publica en la cola soluciones para que el NCT la recoja.
# Si no encuentra nada, no publica nada, simplemente termina y queda listo para la próxima tarea.
def callback(ch, method, properties, body):
    # auto_ack=False + ack manual al terminar: si el worker muere a mitad del
    # minado, la tarea queda sin ackear y RabbitMQ la reentrega a otro worker
    # en vez de perderse (bug M5). El ack se hace recién después de procesar.
    try:
        tarea = json.loads(body)

        log.info(f"[{WORKER_ID}] Procesando rango [{tarea['start']} - {tarea['end']}]...")

        # Continuamos la traza propagada por el TrP (contexto en el payload).
        parent_ctx = obs.extract_trace_context(tarea.get("_trace"))
        span_cm = tracer.start_as_current_span("worker_mine_cpu", context=parent_ctx) \
            if parent_ctx is not None else tracer.start_as_current_span("worker_mine_cpu")
        with span_cm as span:
            span.set_attribute("worker_id", WORKER_ID)
            span.set_attribute("range_start", tarea["start"])
            span.set_attribute("range_end", tarea["end"])
            WORKER_TASKS.labels(worker_type=WORKER_TYPE).inc()
            with WORKER_TASK_SECONDS.labels(worker_type=WORKER_TYPE).time():
                nonce, hash_resultado = mine_cpu(
                    tarea["data"],
                    tarea["difficulty"],
                    tarea["start"],
                    tarea["end"]
                )

        if nonce is not None:
            channel.basic_publish(
                exchange='',
                routing_key='soluciones',
                body=json.dumps({
                    "task_id": tarea.get("task_id"),
                    "nonce": nonce,
                    "hash": hash_resultado,
                })
            )
            WORKER_SOLUTIONS.labels(worker_type=WORKER_TYPE).inc()
            log.info(f"[{WORKER_ID}] Nonce encontrado: {nonce}")
            log_event(
                "solucion_encontrada",
                task_id=tarea.get("task_id"),
                nonce=nonce, hash=hash_resultado,
                start=tarea["start"], end=tarea["end"],
            )
        else:
            log.info(f"[{WORKER_ID}] Sin solución en rango {tarea['start']}-{tarea['end']}")

        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as e:
        # Reintentar una vez y luego soltar (mismo patrón anti-poison que el
        # worker GPU): evita el requeue infinito si el mensaje es inválido.
        already_retried = bool(method.redelivered)
        log.error(f"[{WORKER_ID}] Error procesando tarea (redelivered={already_retried}): {e}", exc_info=True)
        if already_retried:
            ch.basic_ack(delivery_tag=method.delivery_tag)
        else:
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

channel.basic_consume(queue="tareas", on_message_callback=callback, auto_ack=False)
log.info(f"[{WORKER_ID}] Worker CPU esperando tareas...")
channel.start_consuming()
