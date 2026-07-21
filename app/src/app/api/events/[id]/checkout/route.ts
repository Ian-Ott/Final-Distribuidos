import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { settleDueOperations } from "@/lib/nct/client";
import { getSession } from "@/lib/session";
import { isMpConfigured, createPreference } from "@/lib/payments/mercadopago";

// POST /api/events/[id]/checkout
// Crea una preferencia de pago en MercadoPago y devuelve la URL de checkout.
// Si MP no está configurado (MP_ACCESS_TOKEN vacío), cae en el flujo mock
// (compra directa sin pago real, como antes del Sprint C5).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;
  const session = await getSession();
  if (!session.userId || !session.publicKey) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const buyerUserId = session.userId;
  const buyerPublicKey = session.publicKey;

  await settleDueOperations();
  //funcion que libera reservas vencidas
  await prisma.payment.updateMany({
    where: {
        status: "PENDING",
        ticketId: { not: null },
        reservedUntil: {
            lt: new Date(),
        },
    },
    data: {
        status: "EXPIRED",
    },
});

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { organizer: { select: { publicKey: true } } },
  });
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (event.status !== "EMITTED") {
    return NextResponse.json({ error: "event_not_emitted", message: "El evento no está emitido." }, { status: 409 });
  }
  if (event.organizer.publicKey === buyerPublicKey) {
    return NextResponse.json({ error: "cannot_buy_own_event", message: "No podés comprar entradas de tu propio evento." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: buyerUserId } });
  if (!user) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  // Los organizadores no pueden comprar entradas: su rol es emitir, no
  // consumir. Permitirlo además dispara un caso con divergencia de hash en el
  // worker que no logramos reproducir desde acá; bloquearlo en frontend cierra
  // la UX prolijamente.
  if (user.role === "ORGANIZER") {
    return NextResponse.json(
      { error: "organizer_cannot_buy", message: "Los organizadores no pueden comprar entradas." },
      { status: 403 },
    );
  }

  const reservation = await prisma.$transaction(async (tx) => {
    const activeReservations = await tx.payment.findMany({
        where: {
          eventId,
          listingId: null,
          ticketId: { not: null },
          OR: [
            {
                status: "APPROVED",
            },
            {
              //los pagos pendientes bloquean la entrada y los pagos pendientes vencidos deja de bloquear
                status: "PENDING",
                reservedUntil: {
                    gt: new Date(),
                },
            },
          ],
        },
        select: { ticketId: true },
      });

    const reservedTicketIds = activeReservations
      .map((row) => row.ticketId)
      .filter((ticketId): ticketId is string => Boolean(ticketId));

    const ticket = await tx.ticket.findFirst({
      where: {
        eventId,
        ownerPublicKey: event.organizer.publicKey,
        validatedAt: null,
        ...(reservedTicketIds.length > 0 ? { id: { notIn: reservedTicketIds } } : {}),
      },
      orderBy: { ticketNumber: "asc" },
    });
    if (!ticket) return null;
    //se agrega un tiempo de expiracion del pago en caso que no se complete
    const reservationExpires = new Date(Date.now() + 10 * 60 * 1000);
    const payment = await tx.payment.create({
      data: {
        userId: buyerUserId,
        eventId,
        ticketId: ticket.id,
        amount: event.price,
        status: "PENDING",
        reservedUntil: reservationExpires,
      },
    });

    return { payment, ticket };
  });

  if (!reservation) {
    return NextResponse.json({ error: "sold_out", message: "Agotado, no quedan entradas." }, { status: 409 });
  }

  const { payment, ticket: available } = reservation;

  // Si MP no está configurado, devolvemos un flag para que el cliente
  // haga el flujo mock (POST /api/events/[id]/buy como antes).
  if (!isMpConfigured()) {
    return NextResponse.json({
      mock: true,
      paymentId: payment.id,
      ticketId: available.id,
      ticketNumber: available.ticketNumber,
      message: "MP no configurado. Usá el botón mock.",
    });
  }

  // Crear preferencia en MP.
  try {
    const pref = await createPreference({
      paymentId: payment.id,
      eventName: event.name,
      ticketNumber: available.ticketNumber,
      amount: event.price,
      eventId,
      buyerEmail: user.email,
      reservedUntil: payment.reservedUntil,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { mpPreferenceId: pref.preferenceId },
    });

    return NextResponse.json({
      mock: false,
      paymentId: payment.id,
      ticketNumber: available.ticketNumber,
      checkoutUrl: pref.checkoutUrl,
      initPoint: pref.initPoint,
      sandboxInitPoint: pref.sandboxInitPoint,
    });
  } catch (err) {
    console.error("[checkout] Error creando preferencia MP:", err);
    // Si falla la creación de preferencia, limpiamos el payment.
    await prisma.payment.delete({ where: { id: payment.id } });
    return NextResponse.json(
      { error: "mp_error", message: "Error al crear el pago en MercadoPago." },
      { status: 502 },
    );
  }
}
