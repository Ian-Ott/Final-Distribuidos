from fastapi import FastAPI
from pydantic import BaseModel
import subprocess
import pika
import ssl
import json
import time
import threading
import os

import observability as obs
from observability import SERVICE_UP
from prometheus_client import Counter, Histogram, Gauge

# --- Observabilidad ---------------------------------------------------------
log = obs.setup_logging("gpu-server")
obs.setup_tracing("gpu-server")

GPU_MINE_REQUESTS = Counter("gpu_mine_requests_total", "Pedidos de minado recibidos por el gpu-server")
GPU_SOLUTIONS = Counter("gpu_solutions_found_total", "Pedidos en los que el binario CUDA encontro nonce")
GPU_MINE_SECONDS = Histogram(
    "gpu_mine_duration_seconds", "Duracion de la corrida del binario CUDA",
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60),
)
RABBIT_CONNECTED = Gauge("rabbit_connected", "Conexión con RabbitMQ")

app = FastAPI()
_metrics_app = obs.metrics_asgi_app()
if _metrics_app is not None:
    app.mount("/metrics", _metrics_app)
obs.instrument_fastapi(app)

# -------------------------
# CONEXIÓN A RABBITMQ (para el heartbeat)
# -------------------------

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
                    os.getenv("RABBITMQ_HOST", "rabbitmq"),
                    port=5671,
                    ssl_options=rabbitmq_ssl_context(),
                )
            )
            RABBIT_CONNECTED.set(1)
            log.info("gpu-server conectado a RabbitMQ (TLS)")
            return conn
        except Exception:
            log.warning("Esperando RabbitMQ...")
            RABBIT_CONNECTED.set(0)
            time.sleep(3)

# -------------------------
# KEEP-ALIVE via RabbitMQ
# -------------------------
# Publica un mensaje cada 10s en la cola heartbeat_gpu.
# El TrP lo consume y setea la key en Redis.

def heartbeat_loop():
    hb_conn = connect_rabbitmq()
    hb_ch = hb_conn.channel()
    hb_ch.queue_declare(queue='heartbeat_gpu')
    log.info("Heartbeat iniciado")
    while True:
        try:
            if hb_conn is None or hb_conn.is_closed:
                hb_conn = connect_rabbitmq()
                hb_ch = hb_conn.channel()
                hb_ch.queue_declare(queue="heartbeat_gpu")
            hb_ch.basic_publish(
                exchange='',
                routing_key='heartbeat_gpu',
                body=json.dumps({"status": "alive", "timestamp": time.time()})
            )
        except Exception as e:
            log.exception(e)
            try:
                hb_conn.close()
            except:
                pass
            hb_conn = None
        time.sleep(10)

threading.Thread(target=heartbeat_loop, daemon=True).start()
SERVICE_UP.labels(service="gpu-server").set(1)

class MineRequest(BaseModel):
    difficulty: str
    data: str
    start: int
    end: int


def get_gpu_name():
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
        capture_output=True,
        text=True
    )
    return result.stdout.strip().lower()


def select_binary(gpu):
    gpu = gpu.lower()
    log.info("Identificando GPU")
    if "4060" in gpu or "rtx 40" in gpu:
        return "./minero_sm89"
    if "3060" in gpu or "3050" in gpu or "rtx 30" in gpu:
        return "./minero_sm86"
    if "1060" in gpu or "1050" in gpu or "gtx 10" in gpu:
        return "./minero_sm61"
    log.warning(
        f"GPU desconocida ({gpu}), usando SM61 por defecto"
    )
    return "./minero_sm61"


@app.post("/mine")
def mine(req: MineRequest):
    GPU_MINE_REQUESTS.inc()
    gpu = get_gpu_name()
    log.info(f"GPU detectada: {gpu}")
    binary = select_binary(gpu)
    log.info(f"Binario seleccionado: {binary}")
    log.info(
        f"Nuevo trabajo: dificultad={req.difficulty} "
        f"rango={req.start}-{req.end}"
    )
    with GPU_MINE_SECONDS.time():
        result = subprocess.run(
            [
                binary,
                req.data,
                req.difficulty,
                str(req.start),
                str(req.end)
            ],
            capture_output=True,
            text=True
        )

    if "Nonce encontrado:" in (result.stdout or ""):
        log.info("Nonce encontrado!!!")
        GPU_SOLUTIONS.inc()
    else:
        log.info("Trabajo terminado sin solución")

    if result.returncode != 0:
        log.error(
            f"CUDA terminó con código {result.returncode}: "
            f"{result.stderr}"
        )
    if not result.stdout:
        log.warning("El binario CUDA no produjo salida")

    return {"stdout": result.stdout}