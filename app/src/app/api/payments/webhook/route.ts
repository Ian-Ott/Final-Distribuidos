import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPaymentInfo } from "@/lib/payments/mercadopago";
import { submitTransfer } from "@/lib/nct/client";
import { metrics } from "@/lib/observability/metrics";

function classifyTransferError(err: unknown): "terminal" | "retryable" {
  const message = err instanceof Error ? err.message : String(err);

  if (
    message.includes("ticket_not_found") ||
    message.includes("not_current_owner") ||
    message.includes("listing_not_active") ||
    message.includes("no_ticket_reserved") ||
    message.includes("invalid_signature")
  ) {
    return "terminal";
  }

  return "retryable";
}

// POST /api/payments/webhook
// MercadoPago envía notificaciones aquí cada vez que cambia el estado de un pago.
// Doc: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
//
// Flujo:
// 1. MP manda { type: "payment", data: { id: "12345" } }
// 2. Llamamos a la API de MP con ese ID para obtener el estado real (no confiar
//    en el body del webhook — siempre verificar contra la API).
// 3. Si approved → disparar submitTransfer para mover la entrada al comprador.
// 4. Si rejected/cancelled → liberar el ticket reservado.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // MP manda distintos tipos de notificación. Solo nos interesan las de pago.
  const type = body.type ?? body.topic;
  if (type !== "payment") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const mpPaymentId = String(
    (body.data as Record<string, unknown>)?.id ?? body.resource ?? "",
  );
  if (!mpPaymentId || mpPaymentId === "undefined") {
    return NextResponse.json({ error: "missing_payment_id" }, { status: 400 });
  }

  console.log(`[webhook] Recibida notificación de pago MP: ${mpPaymentId}`);

  let info;
  try {
    info = await getPaymentInfo(mpPaymentId);
  } catch (err) {
    console.error(`[webhook] Error consultando pago ${mpPaymentId}:`, err);
    return NextResponse.json({ error: "mp_api_error" }, { status: 502 });
  }

  // external_reference es nuestro payment.id
  const paymentId = info.externalReference;
  if (!paymentId) {
    console.warn(`[webhook] Pago ${mpPaymentId} sin external_reference, ignorando.`);
    return NextResponse.json({ ok: true, ignored: true });
  }

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      event: { include: { organizer: { select: { publicKey: true } } } },
      user: { select: { publicKey: true } },
    },
  });
  // Si es una reventa (listingId presente), buscamos el listing + seller.
  const listing = payment?.listingId
    ? await prisma.ticketListing.findUnique({
        where: { id: payment.listingId },
        include: { seller: { select: { id: true, publicKey: true } } },
      })
    : null;
  if (!payment) {
    console.warn(`[webhook] Payment ${paymentId} no existe en DB.`);
    return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  }

  // Idempotencia: si ya lo procesamos, no hacer nada. Excepción importante:
  // si el pago quedó APPROVED pero nunca llegamos a guardar nctOpRef, un webhook
  // duplicado tiene que reintentar la transferencia en blockchain.
  if (payment.mpPaymentId === mpPaymentId && payment.status !== "PENDING") {
    const shouldRetryMissingNctOp =
      payment.status === "APPROVED" &&
      payment.nctStatus === "PENDING" &&
      payment.nctOpRef === null;

    if (!shouldRetryMissingNctOp) {
      console.log(`[webhook] Payment ${paymentId} ya procesado (${payment.status}), ignorando.`);
      return NextResponse.json({ ok: true, already_processed: true });
    }

    console.warn(`[webhook] Payment ${paymentId} aprobado sin nctOpRef; reintentando transferencia.`);
  }

  // Actualizar datos de MP.
  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      mpPaymentId,
      mpStatus: info.status,
      mpStatusDetail: info.statusDetail,
    },
  });

  if (info.status === "approved") {
    return handleApproved(payment, info, listing);
  }

  if (info.status === "rejected" || info.status === "cancelled" || info.status === "refunded") {
    return handleRejected(paymentId, info.status);
  }

  // in_process, pending, etc. — dejamos como PENDING y esperamos otro webhook.
  console.log(`[webhook] Payment ${paymentId} estado MP: ${info.status}, esperando.`);
  return NextResponse.json({ ok: true, waiting: true });
}

async function handleApproved(
  payment: {
    id: string;
    ticketId: string | null;
    listingId: string | null;
    nctOpRef: string | null;
    event: { organizer: { publicKey: string } };
    user: { publicKey: string };
  },
  _info: { id: string },
  listing: { id: string; status: string; seller: { id: string; publicKey: string } } | null,
) {
  if (!payment.ticketId) {
    console.error(`[webhook] Payment ${payment.id} approved pero no tiene ticketId.`);
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "APPROVED", nctStatus: "FAILED" },
    });
    return NextResponse.json({ error: "no_ticket_reserved" }, { status: 500 });
  }

  // Reventa: validamos que el listing siga ACTIVE (race contra cancelación
  // o otra compra simultánea).
  const isResale = payment.listingId !== null;
  if (isResale && (!listing || listing.status !== "ACTIVE")) {
    console.warn(`[webhook] Payment ${payment.id} es reventa pero listing ${payment.listingId} no está ACTIVE.`);
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "APPROVED", nctStatus: "FAILED" },
    });
    return NextResponse.json({ error: "listing_not_active" }, { status: 409 });
  }

  // Idempotencia atómica: MP a veces manda el webhook dos veces casi en
  // paralelo. Cerramos la ventana entre claim y "set opRef real" poniendo un
  // placeholder en nctOpRef. Sin esto, ambos webhooks ven nctOpRef=null
  // mientras el primero está esperando la respuesta de submitTransfer
  // (50-500ms de network), y los dos pasan el check → doble transferencia
  // por el mismo pago → el bloque va con 2 txs de las cuales una siempre
  // falla con not_current_owner.
  const CLAIM_SENTINEL = "CLAIMING";
  const claim = await prisma.payment.updateMany({
    where: { id: payment.id, nctOpRef: null },
    data: { status: "APPROVED", nctStatus: "PENDING", nctOpRef: CLAIM_SENTINEL },
  });
  if (claim.count === 0) {
    console.log(`[webhook] Payment ${payment.id} ya tenía nctOpRef, ignorando webhook duplicado.`);
    return NextResponse.json({ ok: true, already_processed: true });
  }

  // En reventa, transferimos seller→buyer. En compra normal, organizer→buyer.
  const fromPublicKey = isResale && listing
    ? listing.seller.publicKey
    : payment.event.organizer.publicKey;
  const reason: "purchase" | "resale" = isResale ? "resale" : "purchase";

  try {
    const result = await submitTransfer({
      ticketId: payment.ticketId,
      fromPublicKey,
      toPublicKey: payment.user.publicKey,
      reason,
      signedPayload: { type: isResale ? "mp_resale" : "mp_purchase", paymentId: payment.id },
      signature: "mp-webhook-authorized",
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        nctOpRef: result.opRef,
        nctStatus: result.status,
      },
    });

    // Si es reventa, marcar el listing como SOLD.
    if (isResale && listing) {
      await prisma.ticketListing.updateMany({
        where: { id: listing.id, status: "ACTIVE" },
        data: {
          status: "SOLD",
          buyerId: payment.user.publicKey
            ? (await prisma.user.findFirst({ where: { publicKey: payment.user.publicKey } }))?.id ?? null
            : null,
          paymentId: payment.id,
          resolvedAt: new Date(),
        },
      });
    }

    metrics.paymentsConfirmed.inc();
    console.log(`[webhook] Payment ${payment.id} APPROVED (${reason}) → NCT op ${result.opRef}`);
    return NextResponse.json({ ok: true, nctOpRef: result.opRef });
  } catch (err) {
    // Resetear el sentinel para que un reintento futuro pueda volver a
    // claim (ver shouldRetryMissingNctOp arriba). Si dejáramos "CLAIMING"
    // permanente, el payment quedaría huérfano sin poder reprocesarse.
    await prisma.payment.updateMany({
      where: { id: payment.id, nctOpRef: CLAIM_SENTINEL },
      data: { nctOpRef: null },
    });
    console.error(`[webhook] Error disparando transfer para payment ${payment.id}:`, err);
    const failureType = classifyTransferError(err);

    await prisma.payment.update({
      where: { id: payment.id },
      data: { nctStatus: failureType === "terminal" ? "FAILED" : "PENDING" },
    });

    return NextResponse.json(
      { error: failureType === "terminal" ? "nct_transfer_failed_terminal" : "nct_transfer_retryable" },
      { status: failureType === "terminal" ? 409 : 502 },
    );
  }
}

async function handleRejected(paymentId: string, status: string) {
  const mapped = status === "rejected" ? "REJECTED" : status === "cancelled" ? "CANCELLED" : "REFUNDED";
  await prisma.payment.update({
    where: { id: paymentId },
    data: { status: mapped },
  });
  console.log(`[webhook] Payment ${paymentId} → ${mapped}`);
  return NextResponse.json({ ok: true, status: mapped });
}
