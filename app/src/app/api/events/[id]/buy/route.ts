import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { settleDueOperations, submitTransfer } from "@/lib/nct/client";
import { getSession } from "@/lib/session";

// Mock de compra: encuentra una entrada disponible del organizador y se la transfiere
// al comprador logueado. En producción, este endpoint se dispararía DESPUÉS de confirmar
// el pago en MercadoPago/similar, no como un botón directo.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;
  const session = await getSession();
  if (!session.userId || !session.publicKey) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const buyerPublicKey = session.publicKey;

  await settleDueOperations();

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { organizer: { select: { publicKey: true } } },
  });
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (event.status !== "EMITTED") {
    return NextResponse.json({ error: "event_not_emitted" }, { status: 409 });
  }
  if (event.organizer.publicKey === buyerPublicKey) {
    return NextResponse.json({ error: "cannot_buy_own_event" }, { status: 400 });
  }

  // Los organizadores no pueden comprar entradas (su rol es emitir, no consumir).
  const buyer = await prisma.user.findUnique({ where: { id: session.userId }, select: { role: true } });
  if (buyer?.role === "ORGANIZER") {
    return NextResponse.json({ error: "organizer_cannot_buy" }, { status: 403 });
  }

  // Buscar una entrada que siga siendo del organizador (no vendida) y que
  // no haya sido validada antes (ADR-015: validada = terminal, no re-vendible).
  const available = await prisma.ticket.findFirst({
    where: {
      eventId,
      ownerPublicKey: event.organizer.publicKey,
      validatedAt: null,
    },
    orderBy: { ticketNumber: "asc" },
  });
  if (!available) {
    return NextResponse.json({ error: "sold_out" }, { status: 409 });
  }

  // Disparar la transferencia (escribe la nueva propiedad en la tabla Ticket via mock).
  // El payload firmado lo dejamos vacío en el mock; cuando integremos el NCT real, el
  // organizador tendrá que firmar (o haber pre-firmado) un permiso de venta.
  // Despachamos la transferencia y devolvemos 202 Accepted con el opRef.
  // El cliente polea /api/operations/[opRef] hasta que termine (Sprint 4b).
  // Devolvemos el ticket "tentativo" (id + número) ya — si la op falla, la
  // UI lo descarta. Es OK exponer el número porque ya está "reservado" en la
  // intención de transfer.
  const result = await submitTransfer({
    ticketId: available.id,
    fromPublicKey: event.organizer.publicKey,
    toPublicKey: buyerPublicKey,
    reason: "purchase",
    signedPayload: { type: "purchase_mock", ticketId: available.id },
    signature: "mock-signature-pending-organizer-key-delegation",
  });

  return NextResponse.json(
    {
      opRef: result.opRef,
      status: result.status, // "PENDING" en el mock
      estimatedConfirmAt: result.estimatedConfirmAt,
      ticket: {
        id: available.id,
        eventId,
        ticketNumber: available.ticketNumber,
      },
    },
    { status: 202 },
  );
}
