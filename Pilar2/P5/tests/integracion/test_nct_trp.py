import json
import pika
import pytest
from unittest.mock import MagicMock
from testcontainers.rabbitmq import RabbitMqContainer

import sys
sys.path.append("Pilar2/P5")

import trp


@pytest.mark.integration
def test_nct_envia_tarea_y_trp_la_fragmenta():

    with RabbitMqContainer("rabbitmq:3-management") as rabbit:

        params = pika.URLParameters(
            rabbit.get_connection_url()
        )

        conn = pika.BlockingConnection(params)
        channel = conn.channel()

        channel.queue_declare(queue="tareas_pool")
        channel.queue_declare(queue="tareas")


        # ==========================
        # Mock dependencias TRP
        # ==========================

        trp.r = MagicMock()

        trp.r.get.return_value = "00"
        trp.r.rpush.return_value = None


        trp.channel = channel


        # tracer mock
        cm = MagicMock()
        span = MagicMock()

        cm.__enter__.return_value = span
        cm.__exit__.return_value = False

        trp.tracer = MagicMock()
        trp.tracer.start_as_current_span.return_value = cm


        # tracing
        trp.obs.extract_trace_context = MagicMock(
            return_value=None
        )

        trp.obs.inject_trace_context = MagicMock(
            return_value={}
        )


        # metrics
        metric = MagicMock()

        timer = MagicMock()
        timer.__enter__.return_value = None
        timer.__exit__.return_value = False

        metric.time.return_value = timer


        trp.TRP_TASKS = metric
        trp.TRP_CHUNKS = metric
        trp.TRP_HASHES_ASSIGNED = metric
        trp.TRP_SUBDIVISION_SECONDS = metric


        # ==========================
        # Simula NCT
        # ==========================

        tarea = {
            "task_id": "123",
            "difficulty": "00",
            "data": "hola",
            "start": 0,
            "end": 5000000,
        }


        channel.basic_publish(
            exchange="",
            routing_key="tareas_pool",
            body=json.dumps(tarea)
        )


        # ==========================
        # Simula TRP consumer
        # ==========================

        method, properties, body = channel.basic_get(
            queue="tareas_pool",
            auto_ack=True
        )

        assert method is not None


        trp.on_task(
            channel,
            method,
            properties,
            body
        )


        # ==========================
        # Verifica fragmentación
        # ==========================

        chunks = []

        while True:

            method, properties, body = channel.basic_get(
                queue="tareas",
                auto_ack=True
            )

            if method is None:
                break

            chunks.append(
                json.loads(body)
            )


        assert len(chunks) > 0


        for chunk in chunks:

            assert chunk["task_id"] == "123"
            assert chunk["difficulty"] == "00"
            assert chunk["data"] == "hola"

            assert "start" in chunk
            assert "end" in chunk


        # verifica que realmente dividió
        assert chunks[0]["start"] == 0

        assert chunks[-1]["end"] <= 5000000


        conn.close()