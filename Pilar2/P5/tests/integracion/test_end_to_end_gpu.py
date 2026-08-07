import json
from unittest.mock import MagicMock

import trp
import worker


def test_end_to_end_gpu(rabbitmq_channel):

    channel = rabbitmq_channel

    channel.queue_declare(queue="tareas_pool")
    channel.queue_declare(queue="tareas")
    channel.queue_declare(queue="soluciones")


    # -------------------------
    # Mock Redis
    # -------------------------

    trp.r = MagicMock()
    trp.r.get.return_value = "00"
    trp.r.rpush.return_value = None

    worker.r = MagicMock()
    worker.r.rpush.return_value = None


    # -------------------------
    # Rabbit compartido
    # -------------------------

    trp.channel = channel
    worker.channel = channel


    # -------------------------
    # Mock tracing
    # -------------------------

    cm = MagicMock()
    span = MagicMock()

    cm.__enter__.return_value = span
    cm.__exit__.return_value = False


    trp.tracer = MagicMock()
    trp.tracer.start_as_current_span.return_value = cm

    worker.tracer = MagicMock()
    worker.tracer.start_as_current_span.return_value = cm


    trp.obs.extract_trace_context = MagicMock(
        return_value=None
    )

    trp.obs.inject_trace_context = MagicMock(
        return_value={}
    )

    worker.obs.extract_trace_context = MagicMock(
        return_value=None
    )


    # -------------------------
    # Mock métricas
    # -------------------------

    metric = MagicMock()

    timer = MagicMock()
    timer.__enter__.return_value = None
    timer.__exit__.return_value = False

    metric.time.return_value = timer


    trp.TRP_TASKS = metric
    trp.TRP_CHUNKS = metric
    trp.TRP_HASHES_ASSIGNED = metric
    trp.TRP_SUBDIVISION_SECONDS = metric


    worker.WORKER_TASKS = MagicMock(
        labels=MagicMock(return_value=metric)
    )

    worker.WORKER_SOLUTIONS = MagicMock(
        labels=MagicMock(return_value=metric)
    )

    worker.WORKER_TASK_SECONDS = MagicMock(
        labels=MagicMock(return_value=metric)
    )

    worker.GPU_REQUEST_ERRORS = MagicMock(
        labels=MagicMock(return_value=metric)
    )


    # -------------------------
    # Mock GPU SERVER HTTP
    # -------------------------

    response = MagicMock()

    response.status_code = 200

    response.raise_for_status.return_value = None

    response.json.return_value = {
        "stdout": (
            "Nonce encontrado: 15\n"
            "Hash resultante: 00abcdef"
        )
    }


    worker.requests.post = MagicMock(
        return_value=response
    )


    # -------------------------
    # Tarea original NCT
    # -------------------------

    tarea = {
        "task_id": "999",
        "difficulty": "00",
        "data": "bloque",
        "start": 0,
        "end": 50000,
    }


    channel.basic_publish(
        exchange="",
        routing_key="tareas_pool",
        body=json.dumps(tarea)
    )


    # -------------------------
    # TRP procesa tarea
    # -------------------------

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


    # -------------------------
    # Worker GPU procesa chunk
    # -------------------------

    solucion = None


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


    # -------------------------
    # Validar solución
    # -------------------------

    method, _, body = channel.basic_get(
        queue="soluciones",
        auto_ack=True
    )


    assert method is not None


    solucion = json.loads(body)


    assert solucion is not None
    assert solucion["task_id"] == "999"
    assert solucion["nonce"] == 15
    assert solucion["hash"].startswith("00")


    worker.requests.post.assert_called_once()

    