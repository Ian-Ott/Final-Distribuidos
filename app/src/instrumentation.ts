// Hook de instrumentación de Next.js: se ejecuta una vez al arrancar el server.
// @vercel/otel configura el SDK de OpenTelemetry, instrumenta automáticamente
// las requests entrantes y las llamadas `fetch` salientes (propagando el header
// W3C `traceparent`), de modo que un fetch a NCT_URL continúa la misma traza que
// luego siguen NCT → TrP → workers.
//
// El endpoint OTLP sale de OTEL_EXPORTER_OTLP_ENDPOINT (apunta al Alloy del
// cluster, ver app-config). Sin esa env, los spans simplemente no se exportan.
import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({ serviceName: process.env.OTEL_SERVICE_NAME ?? "frontend" });
}
