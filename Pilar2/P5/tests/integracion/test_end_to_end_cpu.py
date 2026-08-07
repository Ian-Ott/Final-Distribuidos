import json
from time import sleep

import pika
from testcontainers.rabbitmq import RabbitMqContainer


def test_end_to_end_cpu():

    with RabbitMqContainer("rabbitmq:3-management") as rabbit:

        connection = pika.BlockingConnection(
            pika.ConnectionParameters(
                host=rabbit.get_container_host_ip(),
                port=int(rabbit.get_exposed_port(5672)),
            )
        )

        channel = connection.channel()

        channel.queue_declare(queue="tareas_pool")
        channel.queue_declare(queue="soluciones")

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

        connection.close()