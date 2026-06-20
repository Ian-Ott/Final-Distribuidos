from fastapi import FastAPI
from pydantic import BaseModel
import subprocess
import redis
import time
import threading

app = FastAPI()

# -------------------------
# CONEXIÓN A REDIS (para el heartbeat)
# -------------------------

def connect_redis():
    while True:
        try:
            r = redis.Redis(host="redis", port=6379, decode_responses=True)
            r.ping()
            return r
        except Exception:
            print("Esperando Redis...")
            time.sleep(3)

r = connect_redis()

# -------------------------
# KEEP-ALIVE
# -------------------------
# El TrP monitorea esta clave para saber si hay GPU física disponible.
# TTL de 30s: si el gpu-server muere o queda colgado, la clave desaparece sola.

def heartbeat_loop():
    while True:
        r.setex("heartbeat:gpu-server", 30, "alive")
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