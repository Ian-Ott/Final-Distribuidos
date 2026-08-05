import json
import pika
from time import sleep

def test_worker_cpu_publica_solucion():

    connection = pika.BlockingConnection(
        pika.ConnectionParameters("localhost")
    )

    channel = connection.channel()

    channel.queue_declare("tareas")
    channel.queue_declare("soluciones")

    tarea = {
        "task_id": "1",
        "difficulty": "0",
        "data": "abc",
        "start": 0,
        "end": 100000
    }

    channel.basic_publish(
        exchange="",
        routing_key="tareas",
        body=json.dumps(tarea)
    )

    sleep(3)

    method, _, body = channel.basic_get("soluciones")

    assert method is not None

    solucion = json.loads(body)

    assert solucion["task_id"] == "1"
    assert "nonce" in solucion
    assert "hash" in solucion