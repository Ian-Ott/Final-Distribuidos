import { randomUUID } from "node:crypto";

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

export async function submitMintBatch(input: MintBatchInput): Promise<MintBatchResult> {
  if (!NCT_URL || NCT_URL === "mock") {
    const batchRef = `mock-${randomUUID()}`;
    console.log(
      `[NCT mock] Mint batch eventId=${input.eventId} count=${input.ticketCount} batchRef=${batchRef}`,
    );
    return { batchRef, acceptedAt: new Date().toISOString(), mock: true };
  }

  const res = await fetch(`${NCT_URL.replace(/\/$/, "")}/transactions/mint`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`NCT mint failed: ${res.status}`);
  }
  const body = (await res.json()) as { batchRef: string; acceptedAt?: string };
  return { batchRef: body.batchRef, acceptedAt: body.acceptedAt ?? new Date().toISOString(), mock: false };
}
