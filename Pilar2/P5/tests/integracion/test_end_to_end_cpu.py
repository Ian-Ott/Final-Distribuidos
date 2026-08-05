import json
import pika
from time import sleep

def test_end_to_end_cpu():

    connection = pika.BlockingConnection(
        pika.ConnectionParameters("localhost")
    )

    channel = connection.channel()

    channel.queue_declare("tareas_pool")
    channel.queue_declare("soluciones")

    tarea = {
        "task_id": "999",
        "difficulty": "0",
        "data": "bloque"
    }

    channel.basic_publish(
        exchange="",
        routing_key="tareas_pool",
        body=json.dumps(tarea)
    )

    sleep(5)

    method, _, body = channel.basic_get("soluciones")

    assert method is not None

    solucion = json.loads(body)

    assert solucion["task_id"] == "999"
    assert solucion["nonce"] >= 0
    assert solucion["hash"].startswith("0")