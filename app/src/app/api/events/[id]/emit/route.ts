import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { verifySignature } from "@/lib/crypto/server";
import { submitMintBatch } from "@/lib/nct/client";

const Body = z.object({
  payload: z.object({
    type: z.literal("mint_batch"),
    eventId: z.string(),
    organizerPublicKey: z.string(),
    ticketCount: z.number().int().positive(),
    issuedAt: z.string(),
  }),
  signature: z.string().min(1),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session.userId || !session.publicKey) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }
  const { payload, signature } = parsed.data;

  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (event.organizerId !== session.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (event.status === "EMITTED" || event.status === "MINTING") {
    return NextResponse.json(
      { error: event.status === "EMITTED" ? "already_emitted" : "already_minting" },
      { status: 409 },
    );
  }
  if (
    payload.eventId !== event.id ||
    payload.ticketCount !== event.ticketCount ||
    payload.organizerPublicKey !== session.publicKey
  ) {
    return NextResponse.json({ error: "payload_mismatch" }, { status: 400 });
  }

  const valid = await verifySignature(session.publicKey, payload, signature);
  if (!valid) return NextResponse.json({ error: "invalid_signature" }, { status: 400 });

  // Reclamo ATÓMICO del evento: la transición a MINTING se hace con un
  // updateMany condicional (status NOT IN EMITTED/MINTING) en una sola
  // operación. El chequeo de status de arriba es solo un fast-path; este claim
  // es el que cierra el race: si dos requests concurrentes llegan juntas, solo
  // una obtiene count===1 y emite — la otra ve count===0 y aborta. Sin esto,
  // ambas pasaban el chequeo leyendo DRAFT y emitían dos veces (bug M2; el fix
  // previo cd02421 solo cubría el doble-submit del form en el cliente).
  const claim = await prisma.event.updateMany({
    where: { id: event.id, status: { notIn: ["EMITTED", "MINTING"] } },
    data: { status: "MINTING" },
  });
  if (claim.count === 0) {
    const fresh = await prisma.event.findUnique({ where: { id: event.id } });
    return NextResponse.json(
      { error: fresh?.status === "EMITTED" ? "already_emitted" : "already_minting" },
      { status: 409 },
    );
  }

  // Ya somos los dueños del claim. Despachar la operación al mock/NCT real.
  // El status pasa a EMITTED cuando la op se confirme (lo hace el settle).
  let result;
  try {
    result = await submitMintBatch({
      eventId: event.id,
      organizerPublicKey: session.publicKey,
      ticketCount: event.ticketCount,
      signedPayload: payload,
      signature,
    });
  } catch (err) {
    // Revertir el claim para no dejar el evento trabado en MINTING sin op.
    await prisma.event.updateMany({
      where: { id: event.id, status: "MINTING" },
      data: { status: "DRAFT", ncTBatchRef: null },
    });
    console.error("[emit] submitMintBatch failed:", err);
    return NextResponse.json(
      {
        error: "nct_unavailable",
        message: err instanceof Error ? err.message : "Error desconocido al hablar con el NCT.",
      },
      { status: 502 },
    );
  }

  const updated = await prisma.event.update({
    where: { id: event.id },
    data: { ncTBatchRef: result.opRef },
  });

  return NextResponse.json({ event: updated, nct: result });
}
