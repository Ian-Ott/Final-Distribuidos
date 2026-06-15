import pika

import subprocess

import json


connection = pika.BlockingConnection(
    pika.ConnectionParameters("rabbitmq")
)


channel = connection.channel()

channel.queue_declare(
    queue='tareas'
)

channel.queue_declare(
    queue='soluciones'
)



def callback(ch,method,properties,body):

    tarea = json.loads(body)

    resultado = subprocess.run(

        [
            "./minero",

            tarea["difficulty"],

            tarea["data"],

            str(tarea["start"]),

            str(tarea["end"])
        ],

        capture_output=True,

        text=True
    )

    nonce = None

    hash_resultado = None

    for linea in resultado.stdout.splitlines():

        if linea.startswith("Nonce encontrado:"):

            nonce = int(linea.split(":")[1])

        if linea.startswith("Hash resultante:"):

            hash_resultado = linea.split(":")[1].strip()

    if nonce is not None:

        solucion = {

            "nonce":nonce,

            "hash":hash_resultado
        }

        channel.basic_publish(
        exchange='',
        routing_key='soluciones',
        body=json.dumps(solucion)
        )


channel.basic_consume(

    queue="tareas",

    on_message_callback=callback,

    auto_ack=True
)

channel.start_consuming()