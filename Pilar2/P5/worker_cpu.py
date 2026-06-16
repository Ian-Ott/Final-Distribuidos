import pika
import json
import time
import redis
import uuid
import threading
import hashlib

# Este archivo es un minero de GPU.
# Su único trabajo es recibir un desafío matemático, resolverlo por fuerza bruta, y reportar la solución.
# No sabe nada de bloques, transacciones ni blockchain — solo mina

WORKER_ID = str(uuid.uuid4())[:8] # Generamos un ID aleatorio único. Le tomamos solo los primeros 8 caracteres.
HAS_GPU = False # No mina en GPU

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

# Declaracion y creacion de colas
channel = connection.channel()
channel.queue_declare(queue='tareas') 
channel.queue_declare(queue='soluciones')

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
    tarea = json.loads(body)

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
            body=json.dumps({"nonce": nonce, "hash": hash_resultado})
        )
        print(f"[CPU Worker {WORKER_ID}] Nonce encontrado: {nonce}")
    else:
        print(f"[CPU Worker {WORKER_ID}] Sin solución en rango {tarea['start']}-{tarea['end']}")

channel.basic_consume(queue="tareas", on_message_callback=callback, auto_ack=True)
print(f"[CPU Worker {WORKER_ID}] Esperando tareas...")
channel.start_consuming()