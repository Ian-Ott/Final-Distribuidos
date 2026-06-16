"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signPayload } from "@/lib/crypto/client";
import { getUnlockedKey } from "@/lib/identity-store";

type Stage = "idle" | "preparing" | "signing" | "submitting";

export function EmitButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);

  const loading = stage !== "idle";

  async function handleEmit() {
    setError(null);
    try {
      const key = getUnlockedKey();
      if (!key) {
        throw new Error("Clave bloqueada. Cerrá sesión e ingresá de nuevo para desbloquearla.");
      }
      setStage("preparing");
      const prep = await fetch(`/api/events/${eventId}/emit/prepare`, { method: "POST" });
      if (!prep.ok) throw new Error((await prep.json()).error ?? "prepare_failed");
      const { payload } = await prep.json();

      setStage("signing");
      const signature = await signPayload(key, payload);

      setStage("submitting");
      const res = await fetch(`/api/events/${eventId}/emit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload, signature }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "emit_failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown_error");
    } finally {
      setStage("idle");
    }
  }

  const copy: Record<Stage, string> = {
    idle: "Emitir",
    preparing: "Preparando…",
    signing: "Firmando…",
    submitting: "Enviando…",
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button onClick={handleEmit} disabled={loading} className="btn btn-primary btn-sm">
        {loading && <span className="spinner" />}
        {copy[stage]}
      </button>
      {error && <p className="text-[11px] text-[var(--danger)] max-w-[240px] text-right">{error}</p>}
    </div>
  );
}
