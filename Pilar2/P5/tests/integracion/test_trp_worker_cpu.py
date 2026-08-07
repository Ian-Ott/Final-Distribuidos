import json
import pika
import pytest
from unittest.mock import MagicMock

from testcontainers.rabbitmq import RabbitMqContainer

import sys
sys.path.append("Pilar2/P5")

import worker


@pytest.mark.integration
def test_worker_cpu_publica_solucion():

    with RabbitMqContainer("rabbitmq:3-management") as rabbit:

        connection = pika.BlockingConnection(
            pika.URLParameters(
                rabbit.get_connection_url()
            )
        )

        channel = connection.channel()


        channel.queue_declare(queue="tareas")
        channel.queue_declare(queue="soluciones")


        # ==========================
        # Mock dependencias worker
        # ==========================

        worker.channel = channel


        worker.r = MagicMock()


        # tracer
        cm = MagicMock()
        span = MagicMock()

        cm.__enter__.return_value = span
        cm.__exit__.return_value = False

        worker.tracer = MagicMock()
        worker.tracer.start_as_current_span.return_value = cm


        # tracing propagation
        worker.obs.extract_trace_context = MagicMock(
            return_value=None
        )


        # métricas
        metric = MagicMock()

        timer = MagicMock()
        timer.__enter__.return_value = None
        timer.__exit__.return_value = False

        metric.time.return_value = timer


        worker.WORKER_TASKS = MagicMock(
            labels=MagicMock(return_value=metric)
        )

        worker.WORKER_SOLUTIONS = MagicMock(
            labels=MagicMock(return_value=metric)
        )

        worker.WORKER_TASK_SECONDS = MagicMock(
            labels=MagicMock(return_value=metric)
        )

        worker.HASHES_TOTAL = MagicMock(
            labels=MagicMock(return_value=metric)
        )


        # ==========================
        # Publica tarea como TRP
        # ==========================

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


        # ==========================
        # Simula consumo Worker
        # ==========================

        method, properties, body = channel.basic_get(
            queue="tareas",
            auto_ack=False
        )


        assert method is not None


        worker.callback(
            channel,
            method,
            properties,
            body
        )


        # ==========================
        # Verifica solución
        # ==========================

        method, properties, body = channel.basic_get(
            queue="soluciones",
            auto_ack=True
        )


        assert method is not None


        solucion = json.loads(body)


        assert solucion["task_id"] == "1"
        assert "nonce" in solucion
        assert "hash" in solucion


        # Verificación real del PoW
        assert solucion["hash"].startswith("0")


        connection.close()