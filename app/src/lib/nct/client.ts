import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";

// ============================================================================
// Tipos públicos
// ============================================================================

export interface MintBatchInput {
  eventId: string;
  organizerPublicKey: string;
  ticketCount: number;
  signedPayload: unknown;
  signature: string;
}

export type OpStatus = "PENDING" | "CONFIRMED" | "FAILED";

export interface OperationResult {
  opRef: string;
  status: OpStatus;
  acceptedAt: string;
  estimatedConfirmAt?: string;
  errorCode?: string;
  mock: boolean;
}

export interface TransferInput {
  ticketId: string;
  fromPublicKey: string;
  toPublicKey: string;
  reason: "purchase" | "validation" | "resale";
  signedPayload: unknown;
  signature: string;
}

export interface TicketOwnership {
  ticketId: string;
  eventId: string;
  ticketNumber: number;
  ownerPublicKey: string;
}

// ============================================================================
// Modo mock vs real
// ============================================================================

const NCT_URL = process.env.NCT_URL;

function isMockMode() {
  return !NCT_URL || NCT_URL === "mock";
}

function mockDelayMs(): number {
  const min = Number(process.env.NCT_MOCK_DELAY_MIN_MS ?? "1500");
  const max = Number(process.env.NCT_MOCK_DELAY_MAX_MS ?? "4500");
  if (Number.isNaN(min) || Number.isNaN(max) || max < min) return 2500;
  return Math.floor(min + Math.random() * (max - min));
}

function mockShouldFail(): boolean {
  const rate = Number(process.env.NCT_MOCK_FAILURE_RATE ?? "0");
  if (Number.isNaN(rate) || rate <= 0) return false;
  return Math.random() < rate;
}

function nctUrl(path: string): string {
  return `${NCT_URL!.replace(/\/$/, "")}${path}`;
}

// ============================================================================
// IDs de ticket: en modo real son "{eventId}:{n}" para alinear con el NCT.
// En mock dejamos que Prisma genere cuids — son opacos al consumidor.
// ============================================================================

function nctTicketId(eventId: string, ticketNumber: number): string {
  return `${eventId}:${ticketNumber}`;
}

// ============================================================================
// Submit: en mock crean NctOperation PENDING local. En real hablan al NCT
// y guardan el op_id que devuelve para poder polear.
// ============================================================================

export async function submitMintBatch(input: MintBatchInput): Promise<OperationResult> {
  if (isMockMode()) {
    const scheduledConfirmAt = new Date(Date.now() + mockDelayMs());
    const op = await prisma.nctOperation.create({
      data: {
        type: "mint_batch",
        status: "PENDING",
        eventId: input.eventId,
        organizerPublicKey: input.organizerPublicKey,
        ticketCount: input.ticketCount,
        scheduledConfirmAt,
      },
    });
    console.log(
      `[NCT mock] Submit mint_batch event=${input.eventId} count=${input.ticketCount} op=${op.id} confirmAt=${scheduledConfirmAt.toISOString()}`,
    );
    return {
      opRef: op.id,
      status: "PENDING",
      acceptedAt: op.createdAt.toISOString(),
      estimatedConfirmAt: scheduledConfirmAt.toISOString(),
      mock: true,
    };
  }

  // Modo real: POST /tx/mint al NCT.
  const res = await fetch(nctUrl("/tx/mint"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_id: input.eventId,
      organizer_pubkey: input.organizerPublicKey,
      ticket_count: input.ticketCount,
      signed_payload: input.signedPayload,
      signature: input.signature,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`NCT mint failed: ${res.status} ${body}`);
  }
  const body = (await res.json()) as { op_id: string; status: OpStatus };

  // Guardamos el op en nuestra DB para poder polear y materializar localmente.
  const op = await prisma.nctOperation.create({
    data: {
      id: body.op_id,
      type: "mint_batch",
      status: "PENDING",
      eventId: input.eventId,
      organizerPublicKey: input.organizerPublicKey,
      ticketCount: input.ticketCount,
      scheduledConfirmAt: new Date(Date.now() + 5_000), // referencia, no usado en real
    },
  });
  console.log(`[NCT real] mint event=${input.eventId} count=${input.ticketCount} op=${body.op_id}`);
  return {
    opRef: op.id,
    status: body.status,
    acceptedAt: op.createdAt.toISOString(),
    mock: false,
  };
}

export async function submitTransfer(input: TransferInput): Promise<OperationResult> {
  if (isMockMode()) {
    const ticket = await prisma.ticket.findUnique({ where: { id: input.ticketId } });
    if (!ticket) throw new Error("ticket_not_found");
    if (ticket.ownerPublicKey !== input.fromPublicKey) {
      throw new Error("not_current_owner");
    }
    const scheduledConfirmAt = new Date(Date.now() + mockDelayMs());
    const op = await prisma.nctOperation.create({
      data: {
        type: "transfer",
        status: "PENDING",
        ticketId: input.ticketId,
        fromPublicKey: input.fromPublicKey,
        toPublicKey: input.toPublicKey,
        reason: input.reason,
        scheduledConfirmAt,
      },
    });
    console.log(
      `[NCT mock] Submit transfer ticket=${input.ticketId} reason=${input.reason} op=${op.id} confirmAt=${scheduledConfirmAt.toISOString()}`,
    );
    return {
      opRef: op.id,
      status: "PENDING",
      acceptedAt: op.createdAt.toISOString(),
      estimatedConfirmAt: scheduledConfirmAt.toISOString(),
      mock: true,
    };
  }

  // Modo real: POST /tx/transfer.
  // En real, el ticketId que le mandamos al NCT es el mismo string que vive
  // en nuestra DB — ya lo materializamos con formato "{eventId}:{n}".
  const ticket = await prisma.ticket.findUnique({ where: { id: input.ticketId } });
  if (!ticket) throw new Error("ticket_not_found");

  const res = await fetch(nctUrl("/tx/transfer"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_id: ticket.eventId,
      ticket_id: input.ticketId,
      from_pubkey: input.fromPublicKey,
      to_pubkey: input.toPublicKey,
      reason: input.reason,
      signed_payload: input.signedPayload,
      signature: input.signature,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`NCT transfer failed: ${res.status} ${body}`);
  }
  const body = (await res.json()) as { op_id: string; status: OpStatus };

  const op = await prisma.nctOperation.create({
    data: {
      id: body.op_id,
      type: "transfer",
      status: "PENDING",
      ticketId: input.ticketId,
      fromPublicKey: input.fromPublicKey,
      toPublicKey: input.toPublicKey,
      reason: input.reason,
      scheduledConfirmAt: new Date(Date.now() + 5_000),
    },
  });
  console.log(`[NCT real] transfer ticket=${input.ticketId} reason=${input.reason} op=${body.op_id}`);
  return {
    opRef: op.id,
    status: body.status,
    acceptedAt: op.createdAt.toISOString(),
    mock: false,
  };
}

// ============================================================================
// Settlement: en mock usa scheduledConfirmAt + mockShouldFail. En real
// poléa el NCT por cada op pending y aplica efectos localmente cuando confirma.
// ============================================================================

export async function settleDueOperations(): Promise<void> {
  if (isMockMode()) {
    const due = await prisma.nctOperation.findMany({
      where: { status: "PENDING", scheduledConfirmAt: { lte: new Date() } },
      orderBy: { scheduledConfirmAt: "asc" },
      take: 50,
    });
    for (const op of due) {
      await settleOneMock(op.id);
    }
    return;
  }

  // Real: traer todas las pending y polear al NCT.
  const pending = await prisma.nctOperation.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  for (const op of pending) {
    await settleOneReal(op.id);
  }
}

async function settleOneReal(opId: string): Promise<void> {
  const op = await prisma.nctOperation.findUnique({ where: { id: opId } });
  if (!op || op.status !== "PENDING") return;

  let info: { status: OpStatus; error_code?: string; block_index?: number; confirmed_at?: string } | null = null;
  try {
    const res = await fetch(nctUrl(`/ops/${opId}`));
    if (res.status === 404) {
      // El NCT no la conoce — lo dejamos PENDING (puede haberse perdido o aún no procesado)
      return;
    }
    if (!res.ok) return;
    info = (await res.json()) as { status: OpStatus; error_code?: string; block_index?: number; confirmed_at?: string };
  } catch (err) {
    console.warn(`[NCT real] poll ${opId} error:`, err);
    return;
  }

  if (info.status === "PENDING") return;
  if (info.status === "FAILED") {
    await markFailed(opId, info.error_code ?? "nct_rejected");
    return;
  }

  // CONFIRMED — aplicar efectos locales.
  try {
    if (op.type === "mint_batch") {
      if (!op.eventId || !op.organizerPublicKey || !op.ticketCount) {
        await markFailed(opId, "invalid_mint_payload");
        return;
      }
      await prisma.$transaction(async (tx) => {
        await tx.ticket.createMany({
          data: Array.from({ length: op.ticketCount! }, (_, i) => ({
            id: nctTicketId(op.eventId!, i + 1),
            eventId: op.eventId!,
            ticketNumber: i + 1,
            ownerPublicKey: op.organizerPublicKey!,
          })),
        });
        await tx.event.update({
          where: { id: op.eventId! },
          data: { status: "EMITTED", ncTBatchRef: op.id },
        });
        await tx.nctOperation.update({
          where: { id: opId },
          data: { status: "CONFIRMED", confirmedAt: new Date() },
        });
      });
      console.log(`[NCT real] Op ${opId} CONFIRMED mint event=${op.eventId} block=${info.block_index}`);
      return;
    }
    if (op.type === "transfer") {
      const isValidation = op.reason === "validation";
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.ticket.update({
          where: { id: op.ticketId! },
          data: {
            ownerPublicKey: op.toPublicKey!,
            lastTransferAt: now,
            ...(isValidation ? { validatedAt: now } : {}),
          },
        });
        await tx.nctOperation.update({
          where: { id: opId },
          data: { status: "CONFIRMED", confirmedAt: now },
        });
      });
      console.log(`[NCT real] Op ${opId} CONFIRMED transfer ticket=${op.ticketId} block=${info.block_index}${isValidation ? " (validated)" : ""}`);
    }
  } catch (err) {
    console.error(`[NCT real] settle ${opId} error:`, err);
    await markFailed(opId, "settlement_error");
  }
}

async function settleOneMock(opId: string): Promise<void> {
  const op = await prisma.nctOperation.findUnique({ where: { id: opId } });
  if (!op || op.status !== "PENDING") return;

  const fail = mockShouldFail();
  try {
    if (fail) {
      const updated = await prisma.nctOperation.updateMany({
        where: { id: opId, status: "PENDING" },
        data: { status: "FAILED", failedAt: new Date(), errorCode: "mock_random_failure" },
      });
      if (updated.count === 0) return;
      if (op.type === "mint_batch" && op.eventId) {
        await prisma.event.updateMany({
          where: { id: op.eventId, status: "MINTING" },
          data: { status: "DRAFT", ncTBatchRef: null },
        });
      }
      console.log(`[NCT mock] Op ${opId} FAILED (random)`);
      return;
    }

    if (op.type === "mint_batch") {
      if (!op.eventId || !op.organizerPublicKey || !op.ticketCount) {
        await markFailed(opId, "invalid_mint_payload");
        return;
      }
      await prisma.$transaction(async (tx) => {
        await tx.ticket.createMany({
          data: Array.from({ length: op.ticketCount! }, (_, i) => ({
            eventId: op.eventId!,
            ticketNumber: i + 1,
            ownerPublicKey: op.organizerPublicKey!,
          })),
        });
        await tx.event.update({
          where: { id: op.eventId! },
          data: { status: "EMITTED", ncTBatchRef: op.id },
        });
        await tx.nctOperation.update({
          where: { id: opId },
          data: { status: "CONFIRMED", confirmedAt: new Date() },
        });
      });
      console.log(`[NCT mock] Op ${opId} CONFIRMED mint_batch event=${op.eventId}`);
      return;
    }

    if (op.type === "transfer") {
      if (!op.ticketId || !op.toPublicKey || !op.fromPublicKey) {
        await markFailed(opId, "invalid_transfer_payload");
        return;
      }
      const ticket = await prisma.ticket.findUnique({ where: { id: op.ticketId } });
      if (!ticket || ticket.ownerPublicKey !== op.fromPublicKey) {
        await markFailed(opId, "not_current_owner_at_settlement");
        return;
      }
      const isValidation = op.reason === "validation";
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.ticket.update({
          where: { id: op.ticketId! },
          data: {
            ownerPublicKey: op.toPublicKey!,
            lastTransferAt: now,
            ...(isValidation ? { validatedAt: now } : {}),
          },
        });
        await tx.nctOperation.update({
          where: { id: opId },
          data: { status: "CONFIRMED", confirmedAt: now },
        });
      });
      console.log(`[NCT mock] Op ${opId} CONFIRMED transfer ticket=${op.ticketId}${isValidation ? " (validated)" : ""}`);
      return;
    }

    await markFailed(opId, "unknown_op_type");
  } catch (err) {
    console.error(`[NCT mock] Op ${opId} error:`, err);
    await markFailed(opId, "settlement_error");
  }
}

async function markFailed(opId: string, code: string) {
  const op = await prisma.nctOperation.findUnique({ where: { id: opId } });
  await prisma.nctOperation.updateMany({
    where: { id: opId, status: "PENDING" },
    data: { status: "FAILED", failedAt: new Date(), errorCode: code },
  });
  if (op?.type === "mint_batch" && op.eventId) {
    await prisma.event.updateMany({
      where: { id: op.eventId, status: "MINTING" },
      data: { status: "DRAFT", ncTBatchRef: null },
    });
  }
}

export async function getOperationStatus(opId: string): Promise<{
  status: OpStatus;
  errorCode?: string;
  confirmedAt?: string;
  failedAt?: string;
  estimatedConfirmAt?: string;
} | null> {
  await settleDueOperations();
  const op = await prisma.nctOperation.findUnique({ where: { id: opId } });
  if (!op) return null;
  return {
    status: op.status as OpStatus,
    errorCode: op.errorCode ?? undefined,
    confirmedAt: op.confirmedAt?.toISOString(),
    failedAt: op.failedAt?.toISOString(),
    estimatedConfirmAt: op.scheduledConfirmAt.toISOString(),
  };
}

// ============================================================================
// Queries read-only: en ambos modos leemos del espejo local (tabla Ticket)
// que se mantiene consistente via settleDueOperations.
// ============================================================================

export async function getTicketsByOwner(publicKey: string): Promise<TicketOwnership[]> {
  await settleDueOperations();
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

export async function getTicketOwner(ticketId: string): Promise<string | null> {
  await settleDueOperations();
  const t = await prisma.ticket.findUnique({ where: { id: ticketId } });
  return t?.ownerPublicKey ?? null;
}

export async function getAvailableTicketsCount(eventId: string, organizerPublicKey: string): Promise<number> {
  await settleDueOperations();
  return prisma.ticket.count({
    where: { eventId, ownerPublicKey: organizerPublicKey, validatedAt: null },
  });
}
