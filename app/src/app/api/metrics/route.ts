import { metrics } from "@/lib/observability/metrics";

// GET /api/metrics — endpoint que scrapea Prometheus.
//
// NO va expuesto en el Ingress público (ver ingress.yaml): Prometheus lo
// alcanza por la red interna del cluster vía el Service del frontend. Si más
// adelante se quiere blindar, agregar un check de red/secret acá.
//
// runtime nodejs porque prom-client usa APIs de Node (process, perf_hooks) que
// no existen en el runtime Edge. force-dynamic para que nunca se cachee.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const body = await metrics.registry.metrics();
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": metrics.registry.contentType },
  });
}
