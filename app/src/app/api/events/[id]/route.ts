import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ event });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (event.organizerId !== session.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (event.status === "EMITTED") {
    return NextResponse.json({ error: "cannot_delete_emitted" }, { status: 409 });
  }
  await prisma.event.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
