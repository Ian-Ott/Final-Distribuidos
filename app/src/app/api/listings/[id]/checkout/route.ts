import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isMpConfigured, createPreference } from "@/lib/payments/mercadopago";
import { settleDueOperations, submitTransfer } from "@/lib/nct/client";

// POST /api/listings/[id]/checkout — el comprador inicia el pago de una reventa.
// Igual al /events/[id]/checkout pero apuntando a un listing en lugar del
// stock del organizador. Ver ADR-017.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: listingId } = await params;
  const session = await getSession();
  if (!session.userId || !session.publicKey) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const buyerUserId = session.userId;
  const buyerPublicKey = session.publicKey;

  await settleDueOperations();
  await prisma.payment.updateMany({
    where: {
      status: "PENDING",
      listingId: { not: null },
      reservedUntil: {
        lt: new Date(),
      },
    },
    data: {
      status: "EXPIRED",
    },
  });
  const listing = await prisma.ticketListing.findUnique({
    where: { id: listingId },
    include: {
      ticket: {
        include: {
          event: { select: { id: true, name: true, status: true } },
        },
      },
      seller: { select: { id: true, publicKey: true } },
    },
  });
  if (!listing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (listing.status !== "ACTIVE") {
    return NextResponse.json(
      { error: "listing_not_active", message: "Esta reventa ya no está disponible." },
      { status: 409 },
    );
  }
  if (listing.sellerId === buyerUserId) {
    return NextResponse.json(
      { error: "cannot_buy_own_listing", message: "No podés comprar tu propia reventa." },
      { status: 400 },
    );
  }
  if (listing.ticket.validatedAt) {
    return NextResponse.json(
      { error: "ticket_already_validated", message: "Esta entrada ya fue usada." },
      { status: 409 },
    );
  }
  if (listing.ticket.ownerPublicKey !== listing.seller.publicKey) {
    return NextResponse.json(
      { error: "stale_listing", message: "La reventa ya no es válida (cambió el dueño)." },
      { status: 409 },
    );
  }

  const user = await prisma.user.findUnique({ where: { id: buyerUserId } });
  if (!user) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const payment = await prisma.$transaction(async (tx) => {
      const activePayment = await tx.payment.findFirst({
        where: {
          listingId: listing.id,
          OR: [
            {
              status: "APPROVED",
            },
            {
              status: "PENDING",
              reservedUntil: {
                gt: new Date(),
              },
            },
          ],
        },
        select: { id: true },
      });
      if (activePayment) {
        return null;
      }
      const reservationExpires = new Date(Date.now() + 10 * 60 * 1000);
      return tx.payment.create({
        data: {
          userId: buyerUserId,
          eventId: listing.ticket.eventId,
          ticketId: listing.ticket.id,
          listingId: listing.id,
          amount: listing.price,
          currency: listing.currency,
          status: "PENDING",
          reservedUntil: reservationExpires,
        },
      });
    });

  if (!payment) {
    return NextResponse.json(
      { error: "listing_checkout_in_progress", message: "Esta reventa ya estÃ¡ siendo procesada por otra compra." },
      { status: 409 },
    );
  }

  // Fallback mock: si MP no configurado, transferir directo sin pago.
  if (!isMpConfigured()) {
    const result = await submitTransfer({
      ticketId: listing.ticket.id,
      fromPublicKey: listing.seller.publicKey,
      toPublicKey: buyerPublicKey,
      reason: "resale",
      signedPayload: { type: "resale_mock", listingId: listing.id },
      signature: "mock-signature-resale",
    });
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "APPROVED",
          nctOpRef: result.opRef,
          nctStatus: result.status,
        },
      }),
      prisma.ticketListing.update({
        where: { id: listing.id },
        data: {
          status: "SOLD",
          buyerId: buyerUserId,
          paymentId: payment.id,
          resolvedAt: new Date(),
        },
      }),
    ]);
    return NextResponse.json({
      mock: true,
      paymentId: payment.id,
      opRef: result.opRef,
    });
  }

  // MP configurado: crear preferencia.
  try {
    const pref = await createPreference({
      paymentId: payment.id,
      eventName: `Reventa: ${listing.ticket.event.name}`,
      ticketNumber: listing.ticket.ticketNumber,
      amount: listing.price,
      eventId: listing.ticket.eventId,
      buyerEmail: user.email,
      reservedUntil: payment.reservedUntil!,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { mpPreferenceId: pref.preferenceId },
    });

    return NextResponse.json({
      mock: false,
      paymentId: payment.id,
      checkoutUrl: pref.checkoutUrl,
      initPoint: pref.initPoint,
      sandboxInitPoint: pref.sandboxInitPoint,
    });
  } catch (err) {
    console.error("[listing checkout] Error creando preferencia MP:", err);
    await prisma.payment.delete({ where: { id: payment.id } });
    return NextResponse.json(
      { error: "mp_error", message: "Error al crear el pago en MercadoPago." },
      { status: 502 },
    );
  }
}
