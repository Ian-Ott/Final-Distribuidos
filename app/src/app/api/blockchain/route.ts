import { NextResponse } from "next/server";

const NCT_URL = process.env.NCT_URL;

async function nctFetch(path: string) {
  if (!NCT_URL || NCT_URL === "mock") return null;
  try {
    const res = await fetch(`${NCT_URL.replace(/\/$/, "")}${path}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function GET() {
  const [status, blockchain, logs] = await Promise.all([
    nctFetch("/status"),
    nctFetch("/blockchain"),
    nctFetch("/logs"),
  ]);

  return NextResponse.json({
    status,
    blockchain,
    logs,
    timestamp: new Date().toISOString(),
  });
}
