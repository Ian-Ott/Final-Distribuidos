import pika
import ssl
import json
import requests
import os
import time
import redis
import uuid
import logging

# Este worker no mina localmente: delega el cálculo pesado al servidor GPU
# vía HTTP y solo reporta el resultado.

# -------------------------
# LOGGING
# -------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("worker-gpu")

# Identificador único de este worker — antes no existía, por eso no había
# forma de saber CUÁL réplica encontró la solución (acá solo hay una réplica
# de gpu-server según el deployment, pero igual queda preparado si en algún
# momento se escala). Mismo patrón que ya usa worker_cpu.py.
WORKER_ID = str(uuid.uuid4())[:8]

GPU_SERVER_URL = os.getenv("GPU_SERVICE_URL", "http://gpu-service-internal:8000/mine")


def connect_redis():
    while True:
        try:
            client = redis.Redis(host="redis", port=6379, decode_responses=True)
            client.ping()
            log.info("Conectado a Redis")
            return client
        except Exception:
            log.warning("Esperando Redis...")
            time.sleep(3)


def log_event(r, event: str, **fields):
    """Mismo patrón de log centralizado que usan NCT y TrP: escribe en la
    clave 'logs' de Redis (visible vía GET /logs) y también en consola."""
    entry = {"timestamp": time.time(), "event": event, "worker_id": WORKER_ID, "tipo": "gpu", **fields}
    r.rpush("logs", json.dumps(entry))
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

        # 1. Delegamos el cálculo pesado al servidor central con GPU via HTTP
        payload = {
            "difficulty": tarea["difficulty"],
            "data": tarea["data"],
            "start": tarea["start"],
            "end": tarea["end"]
        }
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
                "nonce": nonce,
                "hash": hash_resultado
            }
            ch.basic_publish(
                exchange='',
                routing_key='soluciones',
                body=json.dumps(solucion)
            )
            log_event(
                r, "solucion_encontrada",
                nonce=nonce, hash=hash_resultado,
                start=tarea["start"], end=tarea["end"],
            )
        else:
            log.info(f"[{WORKER_ID}] No se encontró solución en el rango [{tarea['start']} - {tarea['end']}]")
        ch.basic_ack(
                delivery_tag=method.delivery_tag
            )
    except Exception as e:
        log.error(f"[{WORKER_ID}] Error procesando tarea: {e}", exc_info=True)
        ch.basic_nack(
            delivery_tag=method.delivery_tag,
            requeue=True
        )

# Escuchamos de la cola 'tareas'
channel.basic_consume(
    queue="tareas",
    on_message_callback=callback,
    auto_ack=False
)
log.info(f"[{WORKER_ID}] Worker GPU esperando tareas...")
channel.start_consuming()