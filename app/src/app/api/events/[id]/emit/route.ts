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
  if (event.status === "EMITTED") {
    return NextResponse.json({ error: "already_emitted" }, { status: 409 });
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

  const result = await submitMintBatch({
    eventId: event.id,
    organizerPublicKey: session.publicKey,
    ticketCount: event.ticketCount,
    signedPayload: payload,
    signature,
  });

  const updated = await prisma.event.update({
    where: { id: event.id },
    data: { status: "EMITTED", ncTBatchRef: result.batchRef },
  });

  return NextResponse.json({ event: updated, nct: result });
}
