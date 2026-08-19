import os
import random
import time
import threading

from locust import (
    HttpUser,
    task,
    between,
    LoadTestShape,
    events,
)

from prometheus_client import (
    Counter,
    Histogram,
    Gauge,
    start_http_server,
)


# ============================================================================
# CONFIGURACIÓN
# ============================================================================

TRANSACTION_ENDPOINT = os.getenv(
    "TRANSACTION_ENDPOINT",
    "/transaction"
)

SCENARIO = os.getenv(
    "LOCUST_SCENARIO",
    "baseline"
).lower()

# Puerto interno utilizado para exponer las métricas Prometheus.
#
# No es el puerto HTTP del NCT.
# Es exclusivamente el endpoint /metrics del proceso Locust.
METRICS_PORT = int(
    os.getenv(
        "LOCUST_METRICS_PORT",
        "9646"
    )
)


# ============================================================================
# MÉTRICAS PROMETHEUS
# ============================================================================

# --------------------------------------------------------------------------
# Requests totales
# --------------------------------------------------------------------------

LOCUST_REQUESTS_TOTAL = Counter(
    "locust_performance_requests_total",
    "Cantidad total de requests ejecutadas por Locust",
    [
        "scenario",
        "method",
        "endpoint",
    ],
)


# --------------------------------------------------------------------------
# Requests exitosas
# --------------------------------------------------------------------------

LOCUST_REQUESTS_SUCCESS_TOTAL = Counter(
    "locust_performance_requests_success_total",
    "Cantidad total de requests exitosas",
    [
        "scenario",
        "method",
        "endpoint",
    ],
)


# --------------------------------------------------------------------------
# Requests fallidas
# --------------------------------------------------------------------------

LOCUST_REQUESTS_FAILURE_TOTAL = Counter(
    "locust_performance_requests_failure_total",
    "Cantidad total de requests fallidas",
    [
        "scenario",
        "method",
        "endpoint",
    ],
)


# --------------------------------------------------------------------------
# Latencia
# --------------------------------------------------------------------------

LOCUST_REQUEST_LATENCY_SECONDS = Histogram(
    "locust_performance_request_latency_seconds",
    "Latencia de requests HTTP contra el sistema bajo prueba",
    [
        "scenario",
        "method",
        "endpoint",
    ],
    buckets=[
        0.005,
        0.01,
        0.025,
        0.05,
        0.1,
        0.25,
        0.5,
        1.0,
        2.0,
        5.0,
        10.0,
        30.0,
        60.0,
    ],
)


# --------------------------------------------------------------------------
# Usuarios concurrentes
# --------------------------------------------------------------------------

LOCUST_USERS = Gauge(
    "locust_performance_users",
    "Cantidad de usuarios concurrentes de Locust",
    [
        "scenario",
    ],
)


# --------------------------------------------------------------------------
# Estado del test
#
# 0 = no iniciado
# 1 = ejecutando
# 2 = terminado
# --------------------------------------------------------------------------

LOCUST_TEST_STATUS = Gauge(
    "locust_performance_test_status",
    "Estado de la ejecución de performance",
    [
        "scenario",
    ],
)


# --------------------------------------------------------------------------
# Timestamp de inicio
# --------------------------------------------------------------------------

LOCUST_TEST_START_TIMESTAMP = Gauge(
    "locust_performance_test_start_timestamp",
    "Unix timestamp del inicio del test",
    [
        "scenario",
    ],
)


# --------------------------------------------------------------------------
# Timestamp de finalización
# --------------------------------------------------------------------------

LOCUST_TEST_END_TIMESTAMP = Gauge(
    "locust_performance_test_end_timestamp",
    "Unix timestamp de finalización del test",
    [
        "scenario",
    ],
)


# ============================================================================
# ESTADO INTERNO
# ============================================================================

_metrics_started = False
_metrics_lock = threading.Lock()


# ============================================================================
# SERVIDOR DE MÉTRICAS
# ============================================================================

def start_metrics_server():
    """
    Levanta el endpoint HTTP:

        http://<locust-pod>:9646/metrics

    Prometheus puede scrapear este endpoint.
    """

    global _metrics_started

    with _metrics_lock:

        if _metrics_started:
            return

        start_http_server(
            METRICS_PORT
        )

        _metrics_started = True

        print(
            f"[LOCUST] Prometheus metrics disponibles "
            f"en puerto {METRICS_PORT}"
        )


# ============================================================================
# EVENTOS LOCUST
# ============================================================================

@events.init.add_listener
def on_locust_init(environment, **kwargs):
    """
    Se ejecuta cuando Locust inicializa el proceso.

    Levanta el endpoint /metrics.
    """

    start_metrics_server()

    LOCUST_TEST_STATUS.labels(
        scenario=SCENARIO
    ).set(0)

    LOCUST_USERS.labels(
        scenario=SCENARIO
    ).set(0)


@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    """
    Marca el comienzo real de una ejecución.
    """

    now = time.time()

    LOCUST_TEST_STATUS.labels(
        scenario=SCENARIO
    ).set(1)

    LOCUST_TEST_START_TIMESTAMP.labels(
        scenario=SCENARIO
    ).set(now)

    LOCUST_TEST_END_TIMESTAMP.labels(
        scenario=SCENARIO
    ).set(0)

    print(
        f"[LOCUST] Test iniciado: scenario={SCENARIO}"
    )


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """
    Marca la finalización del escenario.
    """

    now = time.time()

    LOCUST_TEST_STATUS.labels(
        scenario=SCENARIO
    ).set(2)

    LOCUST_TEST_END_TIMESTAMP.labels(
        scenario=SCENARIO
    ).set(now)

    print(
        f"[LOCUST] Test finalizado: scenario={SCENARIO}"
    )


# ============================================================================
# MÉTRICAS DE REQUEST
# ============================================================================

@events.request.add_listener
def on_request(
    request_type,
    name,
    response_time,
    response_length,
    response,
    context,
    exception,
    start_time,
    url,
    **kwargs,
):
    """
    Captura cada request ejecutada por Locust.

    Esto permite llevar las métricas de performance a Prometheus
    independientemente del resumen que imprime Locust.
    """

    method = request_type
    endpoint = name or TRANSACTION_ENDPOINT

    LOCUST_REQUESTS_TOTAL.labels(
        scenario=SCENARIO,
        method=method,
        endpoint=endpoint,
    ).inc()

    LOCUST_REQUEST_LATENCY_SECONDS.labels(
        scenario=SCENARIO,
        method=method,
        endpoint=endpoint,
    ).observe(
        response_time / 1000.0
    )

    if exception is None:

        LOCUST_REQUESTS_SUCCESS_TOTAL.labels(
            scenario=SCENARIO,
            method=method,
            endpoint=endpoint,
        ).inc()

    else:

        LOCUST_REQUESTS_FAILURE_TOTAL.labels(
            scenario=SCENARIO,
            method=method,
            endpoint=endpoint,
        ).inc()


# ============================================================================
# USUARIO
# ============================================================================

class BlockchainUser(HttpUser):

    wait_time = between(
        0.1,
        0.5
    )

    def on_start(self):

        self.user_id = random.randint(
            1,
            1_000_000_000
        )

    @task
    def create_transaction(self):

        payload = {
            "sender": f"locust-{self.user_id}",

            "receiver": (
                f"miner-"
                f"{random.randint(1, 1000)}"
            ),

            "amount": random.randint(
                1,
                100
            ),
        }

        with self.client.post(
            TRANSACTION_ENDPOINT,

            json=payload,

            name="POST /transaction",

            catch_response=True,

        ) as response:

            if response.status_code not in (
                200,
                201,
                202,
            ):

                response.failure(
                    f"HTTP {response.status_code}: "
                    f"{response.text[:200]}"
                )


# ============================================================================
# SHAPE DE PERFORMANCE
# ============================================================================

class PerformanceShape(LoadTestShape):

    SCENARIOS = {

        # ------------------------------------------------------------------
        # BASELINE
        #
        # Carga mínima y estable.
        # Sirve como referencia del comportamiento normal.
        # ------------------------------------------------------------------

        "baseline": [
            (60, 2, 2),
        ],


        # ------------------------------------------------------------------
        # LOAD
        #
        # Incremento progresivo de carga.
        # ------------------------------------------------------------------

        "load": [
            (60, 2, 2),
            (120, 5, 3),
            (180, 10, 5),
            (240, 20, 10),
        ],


        # ------------------------------------------------------------------
        # STRESS
        #
        # Incremento hasta una carga elevada.
        # ------------------------------------------------------------------

        "stress": [
            (60, 10, 5),
            (120, 25, 10),
            (180, 50, 25),
            (240, 75, 25),
            (300, 100, 25),
        ],


        # ------------------------------------------------------------------
        # SPIKE
        #
        # Salto brusco de carga.
        # ------------------------------------------------------------------

        "spike": [
            (30, 5, 5),
            (60, 100, 100),
            (120, 100, 100),
            (150, 5, 100),
            (210, 5, 5),
        ],


        # ------------------------------------------------------------------
        # SOAK
        #
        # Carga sostenida.
        # ------------------------------------------------------------------

        "soak": [
            (300, 10, 5),
        ],
    }


    def tick(self):

        stages = self.SCENARIOS.get(
            SCENARIO,
            self.SCENARIOS["baseline"]
        )

        run_time = self.get_run_time()

        for duration, users, spawn_rate in stages:

            if run_time < duration:

                LOCUST_USERS.labels(
                    scenario=SCENARIO
                ).set(users)

                return (
                    users,
                    spawn_rate,
                )

        LOCUST_USERS.labels(
            scenario=SCENARIO
        ).set(0)

        return None
        