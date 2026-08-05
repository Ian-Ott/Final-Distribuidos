import json
import pika
from time import sleep

def test_end_to_end_gpu():

    connection = pika.BlockingConnection(
        pika.ConnectionParameters("localhost")
    )

    channel = connection.channel()

    channel.queue_declare("tareas_pool")
    channel.queue_declare("soluciones")

    tarea = {
        "task_id": "gpu1",
        "difficulty": "00",
        "data": "gpu-block"
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

    assert solucion["task_id"] == "gpu1"
    assert solucion["hash"].startswith("00")