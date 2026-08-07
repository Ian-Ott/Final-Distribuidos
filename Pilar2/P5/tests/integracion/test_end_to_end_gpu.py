import json

import pika

import trp
import worker
from unittest.mock import MagicMock




def test_end_to_end_cpu(rabbitmq_channel):

    channel = rabbitmq_channel

    channel.queue_declare(queue="tareas_pool")
    channel.queue_declare(queue="tareas")
    channel.queue_declare(queue="soluciones")

    trp.r = MagicMock()
    trp.r.get.return_value = "00"
    trp.r.rpush.return_value = None

    worker.r = MagicMock()
    worker.r.rpush.return_value = None

    # Inyectamos el canal a ambos módulos
    trp.channel = channel
    worker.channel = channel

    #mockeamos dependencias irrelevantes para el test
    cm = MagicMock()
    span = MagicMock()

    cm.__enter__.return_value = span
    cm.__exit__.return_value = False

    trp.tracer = MagicMock()
    trp.tracer.start_as_current_span.return_value = cm

    worker.tracer = MagicMock()
    worker.tracer.start_as_current_span.return_value = cm
    trp.obs.extract_trace_context = MagicMock(return_value=None)
    trp.obs.inject_trace_context = MagicMock(return_value={})

    worker.obs.extract_trace_context = MagicMock(return_value=None)

    metric = MagicMock()

    metric.inc.return_value = None
    metric.set.return_value = None

    timer = MagicMock()
    timer.__enter__.return_value = None
    timer.__exit__.return_value = False

    metric.time.return_value = timer

    trp.TRP_TASKS = metric
    trp.TRP_CHUNKS = metric
    trp.TRP_HASHES_ASSIGNED = metric
    trp.TRP_SUBDIVISION_SECONDS = metric

    worker.WORKER_TASKS = MagicMock(labels=MagicMock(return_value=metric))
    worker.WORKER_SOLUTIONS = MagicMock(labels=MagicMock(return_value=metric))
    worker.WORKER_TASK_SECONDS = MagicMock(labels=MagicMock(return_value=metric))
    worker.GPU_REQUEST_ERRORS = MagicMock(labels=MagicMock(return_value=metric))

    tarea = {
        "task_id": "999",
        "difficulty": "00",
        "data": "bloque",
        "start": 0,
        "end": 50000,
    }



    #
    # Simula que el NCT publica la tarea
    #
    channel.basic_publish(
        exchange="",
        routing_key="tareas_pool",
        body=json.dumps(tarea),
    )

    #
    # TrP consume UNA tarea
    #
    method, properties, body = channel.basic_get(
        queue="tareas_pool",
        auto_ack=True,
    )

    assert method is not None

    trp.on_task(channel, method, properties, body)

    #
    # Worker consume subtareas hasta encontrar solución
    #
    solucion = None

    while True:

        method, properties, body = channel.basic_get(
            queue="tareas",
            auto_ack=False,
        )

        if method is None:
            break

        worker.callback(
            channel,
            method,
            properties,
            body,
        )

        method2, _, body2 = channel.basic_get(
            queue="soluciones",
            auto_ack=True,
        )

        if method2 is not None:
            solucion = json.loads(body2)
            break

    assert solucion is not None
    assert solucion["task_id"] == "999"
    assert solucion["nonce"] >= 0
    assert solucion["hash"].startswith("00")