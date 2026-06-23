from fastapi import FastAPI
from pydantic import BaseModel
import subprocess
import pika
import ssl
import json
import time
import threading
import os

app = FastAPI()

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
            print("gpu-server conectado a RabbitMQ (TLS)")
            return conn
        except Exception:
            print("Esperando RabbitMQ...")
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
    while True:
        try:
            hb_ch.basic_publish(
                exchange='',
                routing_key='heartbeat_gpu',
                body=json.dumps({"status": "alive", "timestamp": time.time()})
            )
        except Exception:
            hb_conn = connect_rabbitmq()
            hb_ch = hb_conn.channel()
            hb_ch.queue_declare(queue='heartbeat_gpu')
        time.sleep(10)

threading.Thread(target=heartbeat_loop, daemon=True).start()


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

    if "4060" in gpu or "rtx 40" in gpu:
        return "./minero_sm89"
    if "3060" in gpu or "3050" in gpu or "rtx 30" in gpu:
        return "./minero_sm86"
    if "1060" in gpu or "1050" in gpu or "gtx 10" in gpu:
        return "./minero_sm61"

    return "./minero_sm61"


@app.post("/mine")
def mine(req: MineRequest):

    gpu = get_gpu_name()
    binary = select_binary(gpu)

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

    return {"stdout": result.stdout}