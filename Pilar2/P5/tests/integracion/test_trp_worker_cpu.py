import json
from time import sleep

import pika
from testcontainers.rabbitmq import RabbitMqContainer


def test_worker_cpu_publica_solucion():

    with RabbitMqContainer("rabbitmq:3-management") as rabbit:

        connection = pika.BlockingConnection(
            pika.ConnectionParameters(
                host=rabbit.get_container_host_ip(),
                port=int(rabbit.get_exposed_port(5672)),
            )
        )

        channel = connection.channel()

        channel.queue_declare(queue="tareas")
        channel.queue_declare(queue="soluciones")

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

        connection.close()