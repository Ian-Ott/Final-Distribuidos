import pika
import json
import time
import redis
import threading
import math
from kubernetes import client, config

# TRP (Pool de Transacciones) es un intermediario inteligente entre el NCT y los workers. 
# El NCT dice "minà este bloque", y el TrP se encarga de dividir ese trabajo, distribuirlo, y decidir si hay que cambiar de modo GPU a CPU.

# -------------------------
# CONEXIONES
# -------------------------

def connect_redis():
    while True:
        try:
            r = redis.Redis(host="redis", port=6379, decode_responses=True)
            r.ping()
            return r
        except Exception:
            time.sleep(3)

def connect_rabbitmq():
    while True:
        try:
            conn = pika.BlockingConnection(pika.ConnectionParameters("rabbitmq"))
            return conn
        except Exception:
            time.sleep(3)

r = connect_redis()
connection = connect_rabbitmq()
channel = connection.channel()
channel.queue_declare(queue='tareas_pool')   # NCT → TrP
channel.queue_declare(queue='tareas')        # TrP → Workers
channel.queue_declare(queue='soluciones')

# -------------------------
# KUBERNETES
# -------------------------

try:
    config.load_incluster_config()   # dentro del cluster
except Exception:
    config.load_kube_config()        # local para testing

apps_v1 = client.AppsV1Api()

CPU_DEPLOYMENT = "miners-cpu"
CPU_NAMESPACE  = "default"

# Funcion para escalar pods desde codigo, es equivalente a kubectl scale deployment miners-cpu --replicas=4,
# por eso necesitaba el rbac.yaml, sin esos permisos K8s rechazaría esta llamada.
def set_cpu_replicas(n: int):
    """Escala el deployment de miners CPU vía patch."""
    body = {"spec": {"replicas": n}}
    apps_v1.patch_namespaced_deployment_scale(
        name=CPU_DEPLOYMENT,
        namespace=CPU_NAMESPACE,
        body=body
    )
    print(f"[TrP] CPU miners escalados a {n}")

# -------------------------
# MONITOREO DE GPU
# -------------------------

FALLBACK_DIFFICULTY = "0"    # dificultad reducida para CPU
ORIGINAL_DIFFICULTY_KEY = "difficulty_original"

# Contamos los workers GPU activos
def count_active_gpus() -> int:
    keys = r.keys("heartbeat:*")
    return sum(1 for k in keys if r.get(k) == "gpu")


# Esta funcion corre en background. Cada 15s revisa si hay GPU vivos.
# Si no hay: reduce dificultad y escala CPU miners.
# Si vuelven: restaura dificultad y baja CPU miners.
def monitor_loop():
    in_fallback = False

    while True:
        gpu_count = count_active_gpus()

        if gpu_count == 0 and not in_fallback:
            print("[TrP] Sin GPU detectados — activando fallback CPU")

            # Guardar dificultad original y reducirla
            original = r.get("difficulty")
            if original:
                r.set(ORIGINAL_DIFFICULTY_KEY, original)
            r.set("difficulty", FALLBACK_DIFFICULTY)

            # Escalar CPU miners
            set_cpu_replicas(4)
            in_fallback = True

        elif gpu_count > 0 and in_fallback:
            print(f"[TrP] {gpu_count} GPU detectados — restaurando modo GPU")

            # Restaurar dificultad
            original = r.get(ORIGINAL_DIFFICULTY_KEY)
            if original:
                r.set("difficulty", original)

            # Bajar CPU miners
            set_cpu_replicas(0)
            in_fallback = False

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
    start      = tarea.get("start", 0)
    end        = tarea.get("end", TOTAL)
    difficulty = tarea.get("difficulty", r.get("difficulty"))
    data       = tarea["data"]

    total_range = end - start
    n_chunks    = math.ceil(total_range / CHUNK_SIZE)

    print(f"[TrP] Subdiviendo tarea en {n_chunks} chunks (dificultad: {difficulty})")

    for i in range(n_chunks):
        chunk_start = start + i * CHUNK_SIZE
        chunk_end   = min(chunk_start + CHUNK_SIZE - 1, end)

        subtarea = {
            "difficulty": difficulty,
            "data":       data,
            "start":      chunk_start,
            "end":        chunk_end
        }

        channel.basic_publish(
            exchange='',
            routing_key='tareas',
            body=json.dumps(subtarea)
        )

    r.rpush("logs", json.dumps({
        "timestamp": time.time(),
        "event":     "trp_subdividio_tarea",
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
print("[TrP] Esperando tareas del NCT...")
channel.start_consuming()