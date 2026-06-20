import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";

export interface MintBatchInput {
  eventId: string;
  organizerPublicKey: string;
  ticketCount: number;
  signedPayload: unknown;
  signature: string;
}

export interface MintBatchResult {
  batchRef: string;
  acceptedAt: string;
  mock: boolean;
}

const NCT_URL = process.env.NCT_URL;

function isMockMode() {
  return !NCT_URL || NCT_URL === "mock";
}

export async function submitMintBatch(input: MintBatchInput): Promise<MintBatchResult> {
  if (isMockMode()) {
    const batchRef = `mock-${randomUUID()}`;

    // Materializar las entradas en la DB con dueño = organizador.
    // Esto simula el estado on-chain hasta que el NCT real esté disponible.
    await prisma.ticket.createMany({
      data: Array.from({ length: input.ticketCount }, (_, i) => ({
        eventId: input.eventId,
        ticketNumber: i + 1,
        ownerPublicKey: input.organizerPublicKey,
      })),
    });

    console.log(
      `[NCT mock] Mint batch eventId=${input.eventId} count=${input.ticketCount} batchRef=${batchRef}`,
    );
    return { batchRef, acceptedAt: new Date().toISOString(), mock: true };
  }

  const res = await fetch(`${NCT_URL!.replace(/\/$/, "")}/transactions/mint`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`NCT mint failed: ${res.status}`);
  }
  const body = (await res.json()) as { batchRef: string; acceptedAt?: string };
  return {
    batchRef: body.batchRef,
    acceptedAt: body.acceptedAt ?? new Date().toISOString(),
    mock: false,
  };
}

export interface TransferInput {
  ticketId: string;
  fromPublicKey: string;
  toPublicKey: string;
  reason: "purchase" | "validation" | "resale";
  signedPayload: unknown;
  signature: string;
}

export interface TransferResult {
  txRef: string;
  acceptedAt: string;
  mock: boolean;
}

export async function submitTransfer(input: TransferInput): Promise<TransferResult> {
  if (isMockMode()) {
    const txRef = `mock-tx-${randomUUID()}`;

    // Verificar dueño actual y mover.
    const ticket = await prisma.ticket.findUnique({ where: { id: input.ticketId } });
    if (!ticket) throw new Error("ticket_not_found");
    if (ticket.ownerPublicKey !== input.fromPublicKey) {
      throw new Error("not_current_owner");
    }

    await prisma.ticket.update({
      where: { id: input.ticketId },
      data: {
        ownerPublicKey: input.toPublicKey,
        lastTransferAt: new Date(),
      },
    });

    console.log(
      `[NCT mock] Transfer ticket=${input.ticketId} from=${input.fromPublicKey.slice(0, 12)}… to=${input.toPublicKey.slice(0, 12)}… reason=${input.reason} txRef=${txRef}`,
    );
    return { txRef, acceptedAt: new Date().toISOString(), mock: true };
  }

  const res = await fetch(`${NCT_URL!.replace(/\/$/, "")}/transactions/transfer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`NCT transfer failed: ${res.status}`);
  }
  const body = (await res.json()) as { txRef: string; acceptedAt?: string };
  return {
    txRef: body.txRef,
    acceptedAt: body.acceptedAt ?? new Date().toISOString(),
    mock: false,
  };
}

export interface TicketOwnership {
  ticketId: string;
  eventId: string;
  ticketNumber: number;
  ownerPublicKey: string;
}

export async function getTicketsByOwner(publicKey: string): Promise<TicketOwnership[]> {
  if (isMockMode()) {
    const tickets = await prisma.ticket.findMany({
      where: { ownerPublicKey: publicKey },
      orderBy: [{ eventId: "asc" }, { ticketNumber: "asc" }],
    });
    return tickets.map((t) => ({
      ticketId: t.id,
      eventId: t.eventId,
      ticketNumber: t.ticketNumber,
      ownerPublicKey: t.ownerPublicKey,
    }));
  }
  // En el NCT real: consultar a su endpoint read-only de tickets por owner.
  throw new Error("not_implemented_for_real_nct");
}

export async function getTicketOwner(ticketId: string): Promise<string | null> {
  if (isMockMode()) {
    const t = await prisma.ticket.findUnique({ where: { id: ticketId } });
    return t?.ownerPublicKey ?? null;
  }
  throw new Error("not_implemented_for_real_nct");
}
