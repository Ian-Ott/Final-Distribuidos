import json
from unittest.mock import MagicMock

import worker


def test_worker_cpu_publica_solucion(rabbitmq_channel):

    channel = rabbitmq_channel

    channel.queue_declare(queue="tareas")
    channel.queue_declare(queue="soluciones")

    #
    # Dependencias del worker
    #

    worker.channel = channel
    worker.r = MagicMock()
    worker.r.rpush.return_value = None


    #
    # Mock tracing
    #

    cm = MagicMock()
    span = MagicMock()

    cm.__enter__.return_value = span
    cm.__exit__.return_value = False

    worker.tracer = MagicMock()
    worker.tracer.start_as_current_span.return_value = cm

    worker.obs.extract_trace_context = MagicMock(
        return_value=None
    )


    #
    # Mock métricas
    #

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


    #
    # Publicamos una tarea
    #

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


    #
    # Consumimos manualmente
    #

    method, properties, body = channel.basic_get(
        queue="tareas",
        auto_ack=False
    )


    assert method is not None


    #
    # Ejecutamos callback real
    #

    worker.callback(
        channel,
        method,
        properties,
        body
    )


    #
    # Validamos solución
    #

    method, _, body = channel.basic_get(
        queue="soluciones",
        auto_ack=True
    )


    assert method is not None


    solucion = json.loads(body)


    assert solucion["task_id"] == "1"
    assert solucion["nonce"] >= 0
    assert "hash" in solucion