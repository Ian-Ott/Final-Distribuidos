import pika
import subprocess
import json
import time
import redis
import uuid
import threading

WORKER_ID = str(uuid.uuid4())[:8]
HAS_GPU = True  # Mina en GPU

# Retry loop para conectarse a rabbitmq
def connect_rabbitmq():
    while True:
        try:
            connection = pika.BlockingConnection(pika.ConnectionParameters("rabbitmq"))
            return connection
        except Exception:
            print("Esperando RabbitMQ...")
            time.sleep(3)

# Retry loop para conectarse a redis
def connect_redis():
    while True:
        try:
            r = redis.Redis(host="redis", port=6379, decode_responses=True)
            r.ping()
            return r
        except Exception:
            time.sleep(3)

r = connect_redis()
connection = connect_rabbitmq()
channel = connection.channel()
channel.queue_declare(queue='tareas')
channel.queue_declare(queue='soluciones')

# Keep-alive, se identifica como GPU en redis. El TTL es clave: si el worker muere o se desconecta,
# después de 30 segundos esa clave desaparece sola de Redis.
# El TrP monitorea estas claves para saber cuántos workers están vivos y de qué tipo son.
def heartbeat_loop():
    while True:
        r.setex(f"heartbeat:{WORKER_ID}", 30, "gpu" if HAS_GPU else "cpu")
        time.sleep(10)

threading.Thread(target=heartbeat_loop, daemon=True).start()

# Este worker delega el minado a un proceso externo:
# Se ejecuta el binario ./minero como si lo corrierams en la terminal, pasándole los parámetros como argumentos.
# Ese binario es el minero CUDA (PILAR 1) compilado corriendo directamente en la GPU.
# Luego, se captura lo que el binario imprime en pantalla para que Python pueda leerlo. 
def callback(ch, method, properties, body):
    tarea = json.loads(body)
    resultado = subprocess.run(
        ["./minero", tarea["difficulty"], tarea["data"], str(tarea["start"]), str(tarea["end"])],
        capture_output=True, text=True
    )
    nonce = None
    hash_resultado = None
    for linea in resultado.stdout.splitlines():
        if linea.startswith("Nonce encontrado:"):
            nonce = int(linea.split(":")[1].strip())
        if linea.startswith("Hash resultante:"):
            hash_resultado = linea.split(":")[1].strip()
    if nonce is not None:
        channel.basic_publish(
            exchange='', routing_key='soluciones',
            body=json.dumps({"nonce": nonce, "hash": hash_resultado})
        )

channel.basic_consume(queue="tareas", on_message_callback=callback, auto_ack=True)
channel.start_consuming()