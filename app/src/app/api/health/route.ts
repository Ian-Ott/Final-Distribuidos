import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/health
// Liveness/readiness para Kubernetes. Hace un SELECT 1 a Postgres para
// confirmar que el pod puede servir requests reales. Si la DB no responde,
// devolvemos 503 y K8s nos saca del balanceador.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      service: "frontend",
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[health] DB unreachable:", err);
    return NextResponse.json(
      { service: "frontend", status: "unhealthy", error: "database_unreachable" },
      { status: 503 },
    );
  }
}
