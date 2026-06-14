import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const events = await prisma.event.findMany({
    where: { organizerId: session.userId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ events });
}
