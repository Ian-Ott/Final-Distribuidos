import json
import pika
import pytest
from time import sleep
from testcontainers.rabbitmq import RabbitMqContainer

@pytest.mark.integration
def test_nct_envia_tarea_y_trp_la_fragmenta():

    with RabbitMqContainer("rabbitmq:3-management") as rabbit:

        params = pika.URLParameters(rabbit.get_connection_url())
        conn = pika.BlockingConnection(params)
        channel = conn.channel()

        channel.queue_declare("tareas_pool")
        channel.queue_declare("tareas")

        tarea = {
            "task_id": "123",
            "difficulty": "00",
            "data": "hola"
        }

        channel.basic_publish(
            exchange="",
            routing_key="tareas_pool",
            body=json.dumps(tarea)
        )

        sleep(2)

        method, _, body = channel.basic_get("tareas")

        assert method is not None

        subtarea = json.loads(body)

        assert subtarea["task_id"] == "123"
        assert subtarea["difficulty"] == "00"