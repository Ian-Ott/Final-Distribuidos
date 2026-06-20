import pika
import json
import requests
import os
import time


GPU_SERVER_URL = os.getenv("GPU_SERVICE_URL", "http://gpu-service-internal:8000/mine")

print("Conectando a rabbitmq")
while True:
    try:
        connection = pika.BlockingConnection(pika.ConnectionParameters("rabbitmq"))
        channel = connection.channel()
        break
    except pika.exceptions.AMQPConnectionError:
        print("RabbitMQ no está listo todavía. Reintentando en 3 segundos...")
        time.sleep(3)

# Declaramos las mismas colas
channel.queue_declare(queue='tareas')
channel.queue_declare(queue='soluciones')

def callback(ch, method, properties, body):
    try:
        tarea = json.loads(body)
        print(f"Procesando rango [{tarea['start']} - {tarea['end']}]...")

    
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
            print(f"¡CONSEGUIDO! Nonce ganador encontrado: {nonce}")
            solucion = {
                "nonce": nonce,
                "hash": hash_resultado
            }
            ch.basic_publish(
                exchange='',
                routing_key='soluciones',
                body=json.dumps(solucion)
            )
        else:
            print(f"No se encontró solución en el rango [{tarea['start']} - {tarea['end']}]")
        ch.basic_ack(
                delivery_tag=method.delivery_tag
            )
    except Exception as e:

        print(e)

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
print("Worker esperando tareas...")
channel.start_consuming()