import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (event.organizerId !== session.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (event.status === "EMITTED") {
    return NextResponse.json({ error: "already_emitted" }, { status: 409 });
  }

  const payload = {
    type: "mint_batch",
    eventId: event.id,
    organizerPublicKey: session.publicKey,
    ticketCount: event.ticketCount,
    issuedAt: new Date().toISOString(),
  };

  return NextResponse.json({ payload });
}
