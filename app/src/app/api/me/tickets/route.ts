import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getTicketsByOwner } from "@/lib/nct/client";

export async function GET() {
  const session = await getSession();
  if (!session.userId || !session.publicKey) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ownership = await getTicketsByOwner(session.publicKey);
  if (ownership.length === 0) return NextResponse.json({ tickets: [] });

  const eventIds = [...new Set(ownership.map((o) => o.eventId))];
  const events = await prisma.event.findMany({
    where: { id: { in: eventIds } },
    select: {
      id: true,
      name: true,
      datetime: true,
      venue: true,
      imageUrl: true,
      organizerId: true,
    },
  });
  const eventById = new Map(events.map((e) => [e.id, e]));

  const tickets = ownership.map((o) => ({
    ticketId: o.ticketId,
    ticketNumber: o.ticketNumber,
    event: eventById.get(o.eventId) ?? null,
  }));

  return NextResponse.json({ tickets });
}
