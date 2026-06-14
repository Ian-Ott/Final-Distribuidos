"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signPayload } from "@/lib/crypto/client";
import { getUnlockedKey } from "@/lib/identity-store";

export function EmitButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEmit() {
    setLoading(true);
    setError(null);
    try {
      const key = getUnlockedKey();
      if (!key) {
        throw new Error("Clave bloqueada. Cerrá sesión e ingresá de nuevo para desbloquearla.");
      }
      const prep = await fetch(`/api/events/${eventId}/emit/prepare`, { method: "POST" });
      if (!prep.ok) throw new Error((await prep.json()).error ?? "prepare_failed");
      const { payload } = await prep.json();

      const signature = await signPayload(key, payload);

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
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleEmit}
        disabled={loading}
        className="rounded-md bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-sm font-medium disabled:opacity-60"
      >
        {loading ? "Emitiendo…" : "Emitir entradas"}
      </button>
      {error && <p className="text-xs text-red-600 max-w-xs text-right">{error}</p>}
    </div>
  );
}
