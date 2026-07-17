"""Observabilidad compartida para los servicios Python de la blockchain.

Un único módulo que importan NCT, TrP, los workers y el gpu-server para tener
los tres pilares de forma consistente:

- **Métricas** (Prometheus): `start_metrics_server()` levanta un endpoint
  `/metrics` en un puerto dedicado para los servicios que NO son HTTP (TrP,
  workers); `metrics_asgi_app()` se monta en los que sí son FastAPI (NCT,
  gpu-server). Las métricas de dominio las define cada servicio con
  prometheus_client directamente — acá solo va el plumbing.
- **Logs** (Loki vía stdout): `setup_logging()` configura logging estructurado
  en JSON, con `trace_id`/`span_id` inyectados cuando hay un span activo, para
  correlacionar logs con trazas en Grafana.
- **Trazas** (Tempo vía OTLP): `setup_tracing()` inicializa OpenTelemetry y
  auto-instrumenta FastAPI/requests/redis. `inject_trace_context()` y
  `extract_trace_context()` propagan el contexto W3C a través de RabbitMQ
  (headers de los mensajes), que es lo que permite seguir UNA operación a lo
  largo de toda la cadena NCT → TrP → worker → NCT aunque cruce colas.

Todo lo de OpenTelemetry está detrás de imports tolerantes a fallo: si las
libs no están instaladas (p.ej. dev local sin extras), las funciones de tracing
se vuelven no-ops y los otros dos pilares siguen funcionando.
"""
from __future__ import annotations

import json
import logging
import os
import socket
import sys
import time
from typing import Optional
from prometheus_client import Gauge

SERVICE_UP = Gauge(
    "service_up",
    "Estado del servicio",
    ["service"]
)

# ---------------------------------------------------------------------------
# Métricas (Prometheus)
# ---------------------------------------------------------------------------
# prometheus_client siempre debe estar disponible (está en requirements). Si por
# algún motivo falta, degradamos a no-op para no tumbar el servicio por telemetría.
try:
    from prometheus_client import start_http_server, make_asgi_app, REGISTRY  # noqa: F401
    _PROM_AVAILABLE = True
except Exception:  # pragma: no cover
    _PROM_AVAILABLE = False

DEFAULT_METRICS_PORT = int(os.getenv("METRICS_PORT", "9000"))


def start_metrics_server(port: int = DEFAULT_METRICS_PORT) -> None:
    """Levanta un servidor HTTP /metrics en un thread aparte.

    Para los servicios que no exponen HTTP propio (TrP, worker, worker_cpu):
    Prometheus scrapea este puerto. Idempotente-ish: si el puerto ya está en
    uso (doble import) lo logueamos y seguimos.
    """
    if not _PROM_AVAILABLE:
        logging.getLogger(__name__).warning("prometheus_client no disponible; /metrics deshabilitado")
        return
    try:
        start_http_server(port)
        logging.getLogger(__name__).info(f"métricas Prometheus en :{port}/metrics")
    except OSError as e:
        logging.getLogger(__name__).warning(f"no se pudo abrir :{port}/metrics: {e}")


def metrics_asgi_app():
    """Devuelve una app ASGI /metrics para montar en FastAPI (NCT, gpu-server).

    Uso: `app.mount("/metrics", metrics_asgi_app())`.
    """
    if not _PROM_AVAILABLE:
        return None
    return make_asgi_app()


# ---------------------------------------------------------------------------
# Logs estructurados (JSON)
# ---------------------------------------------------------------------------
class _JsonFormatter(logging.Formatter):
    """Formatea cada log como una línea JSON que Loki indexa cómodo.

    Incluye `service`, nivel, mensaje, timestamp ISO y — si hay un span OTel
    activo — `trace_id`/`span_id` para saltar de un log a su traza en Grafana.
    """

    def __init__(self, service: str):
        super().__init__()
        self.service = service
        self.host = socket.gethostname()

    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
                  + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "service": self.service,
            "host": self.host,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        # Correlación con trazas si OTel está activo y hay span en curso.
        ctx = _current_trace_ids()
        if ctx:
            entry["trace_id"], entry["span_id"] = ctx
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        # Campos extra que el caller haya pasado vía `logger.info(..., extra={...})`.
        for k, v in getattr(record, "__dict__", {}).items():
            if k.startswith("ctx_"):
                entry[k[4:]] = v
        return json.dumps(entry, ensure_ascii=False)


def setup_logging(service: str, level: str = None) -> logging.Logger:
    """Configura logging JSON a stdout y devuelve el logger del servicio.

    Reemplaza los `logging.basicConfig(format="...")` repetidos en cada archivo.
    El nivel se puede sobreescribir con la env LOG_LEVEL.
    """
    level_name = (level or os.getenv("LOG_LEVEL", "INFO")).upper()
    # Forzar UTF-8 en stdout: los logs JSON usan ensure_ascii=False, así que si
    # el stream queda en una codificación legacy (cp1252 en consolas Windows) un
    # carácter no-ASCII rompería el logging. En contenedores Linux ya es UTF-8.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter(service))
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(getattr(logging, level_name, logging.INFO))
    return logging.getLogger(service)


# ---------------------------------------------------------------------------
# Trazas distribuidas (OpenTelemetry → Tempo)
# ---------------------------------------------------------------------------
_TRACING_ON = False
try:
    from opentelemetry import trace, propagate, context as otel_context
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
    _OTEL_AVAILABLE = True
except Exception:  # pragma: no cover - extras de tracing opcionales
    _OTEL_AVAILABLE = False


def setup_tracing(service: str) -> None:
    """Inicializa el tracer OTLP (exporta a Tempo) y auto-instrumenta libs.

    El endpoint sale de OTEL_EXPORTER_OTLP_ENDPOINT (default al collector Alloy
    del cluster). Si las libs OTel no están o el tracing está deshabilitado
    (OTEL_SDK_DISABLED=true), no hace nada y el resto sigue normal.
    """
    global _TRACING_ON
    if not _OTEL_AVAILABLE:
        return
    if os.getenv("OTEL_SDK_DISABLED", "").lower() == "true":
        return
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://alloy.observability.svc.cluster.local:4317")
    resource = Resource.create({"service.name": service})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint, insecure=True)))
    trace.set_tracer_provider(provider)
    _TRACING_ON = True
    logging.getLogger(__name__).info(f"tracing OTLP -> {endpoint}")


def instrument_fastapi(app) -> None:
    if not (_OTEL_AVAILABLE and _TRACING_ON):
        return
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        FastAPIInstrumentor.instrument_app(app)
    except Exception as e:  # pragma: no cover
        logging.getLogger(__name__).warning(f"no se instrumentó FastAPI: {e}")


def instrument_requests() -> None:
    if not (_OTEL_AVAILABLE and _TRACING_ON):
        return
    try:
        from opentelemetry.instrumentation.requests import RequestsInstrumentor
        RequestsInstrumentor().instrument()
    except Exception as e:  # pragma: no cover
        logging.getLogger(__name__).warning(f"no se instrumentó requests: {e}")


def instrument_redis() -> None:
    if not (_OTEL_AVAILABLE and _TRACING_ON):
        return
    try:
        from opentelemetry.instrumentation.redis import RedisInstrumentor
        RedisInstrumentor().instrument()
    except Exception as e:  # pragma: no cover
        logging.getLogger(__name__).warning(f"no se instrumentó redis: {e}")


def get_tracer(name: str = "blockchain"):
    """Devuelve un tracer; si el tracing está off, devuelve uno no-op de OTel."""
    if _OTEL_AVAILABLE:
        return trace.get_tracer(name)
    return _NoopTracer()


# --- Propagación del contexto a través de RabbitMQ -------------------------
# RabbitMQ no propaga contexto solo: hay que inyectar el `traceparent` W3C en
# los headers del mensaje al publicar y extraerlo al consumir. Sin esto, cada
# salto de cola arranca una traza nueva y se pierde el hilo end-to-end.

def inject_trace_context(headers: Optional[dict] = None) -> dict:
    """Devuelve un dict de headers con el contexto de traza actual inyectado."""
    headers = dict(headers or {})
    if _OTEL_AVAILABLE and _TRACING_ON:
        propagate.inject(headers)
    return headers


def extract_trace_context(headers: Optional[dict]):
    """Extrae un contexto OTel de los headers de un mensaje (o None)."""
    if _OTEL_AVAILABLE and _TRACING_ON and headers:
        return propagate.extract(headers)
    return None


def _current_trace_ids():
    """(trace_id, span_id) en hex del span activo, o None."""
    if not _OTEL_AVAILABLE:
        return None
    try:
        span = trace.get_current_span()
        sc = span.get_span_context()
        if sc and sc.is_valid:
            return (format(sc.trace_id, "032x"), format(sc.span_id, "016x"))
    except Exception:
        pass
    return None


class _NoopSpan:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def set_attribute(self, *a, **k):
        pass


class _NoopTracer:
    def start_as_current_span(self, *a, **k):
        return _NoopSpan()
