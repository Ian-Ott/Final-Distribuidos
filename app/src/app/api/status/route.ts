import { NextResponse } from "next/server";

async function checkService(url: string, timeoutMs = 3000): Promise<"healthy" | "unreachable"> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res.ok ? "healthy" : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function GET() {
  const nctUrl = process.env.NCT_URL;
  const isNctMock = !nctUrl || nctUrl === "mock";

  const [nctStatus] = await Promise.all([
    isNctMock
      ? Promise.resolve("mock" as const)
      : checkService(`${nctUrl}/status`),
  ]);

  return NextResponse.json({
    frontend: "healthy",
    nct: nctStatus,
    gpu_workers: "cluster externo (profesor)",
    timestamp: new Date().toISOString(),
  });
}
