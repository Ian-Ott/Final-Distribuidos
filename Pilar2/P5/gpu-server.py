from fastapi import FastAPI
from pydantic import BaseModel
import subprocess
import pika
import ssl
import json
import time
import threading
import os
import ctypes
from ctypes import byref, c_int, c_char
from ctypes.util import find_library

import observability as obs
from observability import SERVICE_UP
from metrics import GPU_MINE_REQUESTS, GPU_SOLUTIONS, GPU_MINE_SECONDS,RABBIT_CONNECTED,GPU_BUSY,GPU_HASHES_REQUESTED,GPU_ERRORS


log = obs.setup_logging("gpu-server")
app = FastAPI()

@app.on_event("startup")
def startup():
    main()



class CudaDeviceProp(ctypes.Structure):
    _fields_ = [
        ("name", c_char * 256),
        ("totalGlobalMem", ctypes.c_size_t),
        ("sharedMemPerBlock", ctypes.c_size_t),
        ("regsPerBlock", ctypes.c_int),
        ("warpSize", ctypes.c_int),
        ("memPitch", ctypes.c_size_t),
        ("maxThreadsPerBlock", ctypes.c_int),
        ("maxThreadsDim", ctypes.c_int * 3),
        ("maxGridSize", ctypes.c_int * 3),
        ("clockRate", ctypes.c_int),
        ("totalConstMem", ctypes.c_size_t),
        ("major", ctypes.c_int),
        ("minor", ctypes.c_int),
        ("textureAlignment", ctypes.c_size_t),
        ("texturePitchAlignment", ctypes.c_size_t),
        ("deviceOverlap", ctypes.c_int),
        ("multiProcessorCount", ctypes.c_int),
        ("kernelExecTimeoutEnabled", ctypes.c_int),
        ("integrated", ctypes.c_int),
        ("canMapHostMemory", ctypes.c_int),
        ("computeMode", ctypes.c_int),
        ("maxTexture1D", ctypes.c_int),
        ("maxTexture2D", ctypes.c_int * 2),
        ("maxTexture3D", ctypes.c_int * 3),
        ("maxTexture2DLayered", ctypes.c_int * 2),
        ("maxTexture1DLayered", ctypes.c_int * 2),
        ("surfaceAlignment", ctypes.c_size_t),
        ("concurrentKernels", ctypes.c_int),
        ("ECCEnabled", ctypes.c_int),
        ("pciBusID", ctypes.c_int),
        ("pciDeviceID", ctypes.c_int),
        ("pciDomainID", ctypes.c_int),
        ("tccDriver", ctypes.c_int),
        ("asyncEngineCount", ctypes.c_int),
        ("unifiedAddressing", ctypes.c_int),
        ("memoryClockRate", ctypes.c_int),
        ("memoryBusWidth", ctypes.c_int),
        ("l2CacheSize", ctypes.c_int),
        ("maxThreadsPerMultiProcessor", ctypes.c_int),
        ("streamPrioritiesSupported", ctypes.c_int),
        ("globalL1CacheSupported", ctypes.c_int),
        ("localL1CacheSupported", ctypes.c_int),
        ("sharedMemPerMultiprocessor", ctypes.c_size_t),
        ("regsPerMultiprocessor", ctypes.c_int),
        ("managedMemory", ctypes.c_int),
        ("isMultiGpuBoard", ctypes.c_int),
        ("multiGpuBoardGroupID", ctypes.c_int),
    ]




# -------------------------
# CONEXIÓN A RABBITMQ (para el heartbeat)
# -------------------------

def rabbitmq_ssl_context():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return pika.SSLOptions(ctx)

def create_connection():
    return pika.BlockingConnection(
        pika.ConnectionParameters(
            host=os.getenv("RABBITMQ_HOST", "rabbitmq"),
            port=5671,
            ssl_options=rabbitmq_ssl_context(),

            heartbeat=30,
            blocked_connection_timeout=30,
            socket_timeout=10,
            connection_attempts=3,
            retry_delay=2,
        )
    )

# -------------------------
# KEEP-ALIVE via RabbitMQ
# -------------------------
# Publica un mensaje cada 10s en la cola heartbeat_gpu.
# El TrP lo consume y setea la key en Redis.

def heartbeat_loop():
    while True:

        conn = None
        channel = None

        try:
            log.info("Conectando a RabbitMQ...")

            conn = create_connection()
            channel = conn.channel()

            channel.queue_declare(
                queue="heartbeat_gpu",
                durable=False,
            )

            RABBIT_CONNECTED.set(1)

            log.info("Heartbeat iniciado")

            while True:

                channel.basic_publish(
                    exchange="",
                    routing_key="heartbeat_gpu",
                    body=json.dumps(
                        {
                            "status": "alive",
                            "timestamp": time.time(),
                        }
                    ),
                )

                conn.process_data_events()

                time.sleep(10)

        except (
            pika.exceptions.AMQPConnectionError,
            pika.exceptions.StreamLostError,
            pika.exceptions.ConnectionWrongStateError,
            OSError,
            EOFError,
        ) as e:

            RABBIT_CONNECTED.set(0)

            log.warning(
                f"Conexión RabbitMQ perdida: {e}"
            )

        except Exception:

            RABBIT_CONNECTED.set(0)

            log.exception(
                "Error inesperado en heartbeat"
            )

        finally:

            try:
                if channel is not None and channel.is_open:
                    channel.close()
            except Exception:
                pass

            try:
                if conn is not None and conn.is_open:
                    conn.close()
            except Exception:
                pass

            log.info(
                "Reconectando en 3 segundos..."
            )

            time.sleep(3)



class MineRequest(BaseModel):
    difficulty: str
    data: str
    start: int
    end: int


def get_gpu_name():

    device = c_int()

    err = libcudart.cudaGetDevice(
        ctypes.byref(device)
    )

    if err != 0:
        log.warning(
            f"cudaGetDevice fallo: {err}"
        )
        return ""

    prop = CudaDeviceProp()

    err = libcudart.cudaGetDeviceProperties(
        ctypes.byref(prop),
        device.value
    )

    if err != 0:
        log.warning(
            f"cudaGetDeviceProperties fallo: {err}"
        )
        return ""

    gpu = prop.name.decode(
        "utf-8",
        errors="ignore"
    ).strip("\x00")

    log.info(
        f"GPU detectada con CUDA: {gpu}"
    )

    return gpu.lower()


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
    GPU_HASHES_REQUESTED.inc(req.end - req.start + 1)
    GPU_MINE_REQUESTS.inc()
    gpu = get_gpu_name()
    log.info(f"GPU detectada: {gpu}")
    binary = select_binary(gpu)
    log.info(f"Binario seleccionado: {binary}")
    log.info(
        f"Nuevo trabajo: dificultad={req.difficulty} "
        f"rango={req.start}-{req.end}"
    )
    GPU_BUSY.set(1)
    try:
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
    finally:
        GPU_BUSY.set(0)

    if "Nonce encontrado:" in (result.stdout or ""):
        log.info("Nonce encontrado!!!")
        GPU_SOLUTIONS.inc()
    else:
        log.info("Trabajo terminado sin solución")

    if result.returncode != 0:
        GPU_ERRORS.inc()
        log.error(
            f"CUDA terminó con código {result.returncode}: "
            f"{result.stderr}"
        )
    if not result.stdout:
        log.warning("El binario CUDA no produjo salida")

    return {"stdout": result.stdout}

def main():
    global connection
    global channel
    global libcudart

    # CUDA Runtime
    path = find_library("cudart")

    if path is None:
        path = "/usr/local/cuda/targets/x86_64-linux/lib/libcudart.so.12"

    libcudart = ctypes.CDLL(path)
    
    libcudart.cudaGetDevice.argtypes = [
        ctypes.POINTER(c_int)
    ]
    libcudart.cudaGetDevice.restype = c_int


    libcudart.cudaGetDeviceProperties.argtypes = [
        ctypes.POINTER(CudaDeviceProp),
        c_int
    ]
    libcudart.cudaGetDeviceProperties.restype = c_int


    # --- Observabilidad ---------------------------------------------------------
    obs.setup_tracing("gpu-server")

    
    _metrics_app = obs.metrics_asgi_app()
    if _metrics_app is not None:
        app.mount("/metrics", _metrics_app)
    obs.instrument_fastapi(app)

    
    threading.Thread(target=heartbeat_loop, daemon=True).start()
    SERVICE_UP.labels(service="gpu-server").set(1)

if __name__ == "__main__":
    main()
