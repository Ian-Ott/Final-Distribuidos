// Logging estructurado en JSON para el backend del frontend.
//
// Loki indexa estas líneas igual que las de los servicios Python (mismo shape:
// ts/level/service/msg). Reemplaza gradualmente los `console.log("[feature] ...")`
// sueltos por algo parseable y correlacionable con trazas.
//
// Si hay un span OTel activo (ver instrumentation.ts), se inyecta trace_id para
// poder saltar del log a la traza en Grafana.
import { trace } from "@opentelemetry/api";

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level: level.toUpperCase(),
    service: "frontend",
    msg,
    ...fields,
  };

  // Correlación con la traza activa, si la hay.
  const span = trace.getActiveSpan();
  if (span) {
    const ctx = span.spanContext();
    entry.trace_id = ctx.traceId;
    entry.span_id = ctx.spanId;
  }

  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
