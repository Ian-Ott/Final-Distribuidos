import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { verifySignature } from "@/lib/crypto/server";
import { getTicketOwner, submitTransfer } from "@/lib/nct/client";

// Ventana de tolerancia para el timestamp del QR firmado (ver ADR-014).
// El QR se renueva cada 30s en el cliente; aceptamos hasta 90s de antigüedad
// para tolerar latencia y skew de reloj entre dispositivos.
const MAX_QR_AGE_MS = 90_000;

const Body = z.object({
  payload: z.object({
    v: z.literal(1),
    type: z.literal("ticket_proof"),
    ticketId: z.string().min(1),
    publicKey: z.string().min(1),
    issuedAt: z.string(),
  }),
  signature: z.string().min(1),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_qr" }, { status: 400 });
  }
  const { payload, signature } = parsed.data;

  // 1. Frescura del timestamp.
  const issuedAt = Date.parse(payload.issuedAt);
  if (Number.isNaN(issuedAt)) {
    return NextResponse.json({ error: "invalid_timestamp" }, { status: 400 });
  }
  const age = Date.now() - issuedAt;
  if (age > MAX_QR_AGE_MS) {
    return NextResponse.json(
      { error: "qr_expired", ageMs: age, maxAgeMs: MAX_QR_AGE_MS },
      { status: 400 },
    );
  }
  if (age < -MAX_QR_AGE_MS) {
    return NextResponse.json({ error: "qr_from_future" }, { status: 400 });
  }

  // 2. Firma válida con la pubkey que dice ser.
  const validSig = await verifySignature(payload.publicKey, payload, signature);
  if (!validSig) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  // 3. Existencia del ticket + dueño actual on-chain.
  const ticket = await prisma.ticket.findUnique({
    where: { id: payload.ticketId },
    include: {
      event: {
        select: {
          id: true,
          name: true,
          datetime: true,
          venue: true,
          organizerId: true,
          organizer: { select: { publicKey: true } },
        },
      },
    },
  });
  if (!ticket) {
    return NextResponse.json({ error: "ticket_not_found" }, { status: 404 });
  }

  // 4. Solo el organizador del evento puede operar este validador.
  if (ticket.event.organizerId !== session.userId) {
    return NextResponse.json({ error: "not_event_organizer" }, { status: 403 });
  }

  // 5. Dueño actual debe coincidir con quien firmó el QR.
  const currentOwner = await getTicketOwner(payload.ticketId);
  if (!currentOwner) {
    return NextResponse.json({ error: "ticket_not_found" }, { status: 404 });
  }
  if (currentOwner !== payload.publicKey) {
    return NextResponse.json(
      { error: "not_current_owner", currentOwner: currentOwner.slice(0, 16) + "…" },
      { status: 409 },
    );
  }

  // 6. Disparar la transferencia de vuelta al organizador.
  // En el modelo, esto "invalida" el QR porque el dueño cambia (ver ADR-005).
  const tx = await submitTransfer({
    ticketId: ticket.id,
    fromPublicKey: payload.publicKey,
    toPublicKey: ticket.event.organizer.publicKey,
    reason: "validation",
    signedPayload: payload,
    signature,
  });

  return NextResponse.json({
    ok: true,
    ticket: {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      eventName: ticket.event.name,
      venue: ticket.event.venue,
      datetime: ticket.event.datetime,
    },
    tx,
  });
}
