import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { submitTransfer } from "@/lib/nct/client";

// Mock de compra: encuentra una entrada disponible del organizador y se la transfiere
// al comprador logueado. En producción, este endpoint se dispararía DESPUÉS de confirmar
// el pago en MercadoPago/similar, no como un botón directo.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;
  const session = await getSession();
  if (!session.userId || !session.publicKey) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { organizer: { select: { publicKey: true } } },
  });
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (event.status !== "EMITTED") {
    return NextResponse.json({ error: "event_not_emitted" }, { status: 409 });
  }
  if (event.organizer.publicKey === session.publicKey) {
    return NextResponse.json({ error: "cannot_buy_own_event" }, { status: 400 });
  }

  // Buscar una entrada que siga siendo del organizador (no vendida).
  const available = await prisma.ticket.findFirst({
    where: { eventId, ownerPublicKey: event.organizer.publicKey },
    orderBy: { ticketNumber: "asc" },
  });
  if (!available) {
    return NextResponse.json({ error: "sold_out" }, { status: 409 });
  }

  // Disparar la transferencia (escribe la nueva propiedad en la tabla Ticket via mock).
  // El payload firmado lo dejamos vacío en el mock; cuando integremos el NCT real, el
  // organizador tendrá que firmar (o haber pre-firmado) un permiso de venta.
  const result = await submitTransfer({
    ticketId: available.id,
    fromPublicKey: event.organizer.publicKey,
    toPublicKey: session.publicKey,
    reason: "purchase",
    signedPayload: { type: "purchase_mock", ticketId: available.id },
    signature: "mock-signature-pending-organizer-key-delegation",
  });

  return NextResponse.json({
    ticket: {
      id: available.id,
      eventId,
      ticketNumber: available.ticketNumber,
    },
    tx: result,
  });
}
