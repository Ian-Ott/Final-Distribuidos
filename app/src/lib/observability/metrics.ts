// Métricas Prometheus del frontend/backend Next.js.
//
// Expone un registry global con:
// - métricas de runtime de Node (default metrics de prom-client: event loop,
//   heap, GC, etc.)
// - métricas HTTP (latencia y conteo por ruta/método/status)
// - métricas de negocio (operaciones NCT emitidas, pagos confirmados)
//
// El registry se cachea en globalThis para sobrevivir al hot-reload de Next en
// dev: sin esto, cada recompilación re-registraría las mismas métricas y
// prom-client tira "metric already registered".
//
// Solo corre en el runtime Node (no Edge): la ruta /api/metrics declara
// `runtime = "nodejs"`.
import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
} from "prom-client";

type MetricsBundle = {
  registry: Registry;
  httpRequests: Counter<"method" | "route" | "status">;
  httpDuration: Histogram<"method" | "route" | "status">;
  nctOperations: Counter<"kind" | "result">;
  paymentsConfirmed: Counter;
};

const GLOBAL_KEY = "__tesera_metrics__";

function build(): MetricsBundle {
  const registry = new Registry();
  registry.setDefaultLabels({ service: "frontend" });
  collectDefaultMetrics({ register: registry });

  const httpRequests = new Counter({
    name: "http_requests_total",
    help: "Requests HTTP atendidas",
    labelNames: ["method", "route", "status"] as const,
    registers: [registry],
  });

  const httpDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "Duración de las requests HTTP",
    labelNames: ["method", "route", "status"] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });

  const nctOperations = new Counter({
    name: "nct_operations_submitted_total",
    help: "Operaciones enviadas al NCT desde la app (mint/transfer)",
    labelNames: ["kind", "result"] as const,
    registers: [registry],
  });

  const paymentsConfirmed = new Counter({
    name: "payments_confirmed_total",
    help: "Pagos de MercadoPago confirmados vía webhook",
    registers: [registry],
  });

  return { registry, httpRequests, httpDuration, nctOperations, paymentsConfirmed };
}

const g = globalThis as unknown as { [GLOBAL_KEY]?: MetricsBundle };
export const metrics: MetricsBundle = g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = build());

// Helper para instrumentar un handler: mide duración y cuenta el resultado.
// Uso en una route: `return observeHttp("/api/events/[id]/emit", "POST", () => handler());`
export async function observeHttp<T extends { status?: number }>(
  route: string,
  method: string,
  fn: () => Promise<T>,
): Promise<T> {
  const end = metrics.httpDuration.startTimer({ route, method });
  let status = 200;
  try {
    const res = await fn();
    status = res.status ?? 200;
    return res;
  } catch (err) {
    status = 500;
    throw err;
  } finally {
    metrics.httpRequests.inc({ route, method, status: String(status) });
    end({ status: String(status) });
  }
}
