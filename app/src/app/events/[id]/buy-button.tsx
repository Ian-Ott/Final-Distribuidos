"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Stage = "idle" | "submitting" | "success";

export function BuyButton({ eventId, disabled, reason }: { eventId: string; disabled?: boolean; reason?: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [ticketNumber, setTicketNumber] = useState<number | null>(null);

  async function handleBuy() {
    setError(null);
    setStage("submitting");
    try {
      const res = await fetch(`/api/events/${eventId}/buy`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "buy_failed");
      }
      const data = await res.json();
      setTicketNumber(data.ticket.ticketNumber);
      setStage("success");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown_error");
      setStage("idle");
    }
  }

  if (disabled) {
    return (
      <>
        <button
          disabled
          className="btn btn-primary w-full btn-lg cursor-not-allowed opacity-60"
          title={reason}
        >
          Comprar pase
        </button>
        {reason && (
          <p className="text-[12px] text-[var(--muted)] text-center mt-2">{reason}</p>
        )}
      </>
    );
  }

  if (stage === "success" && ticketNumber !== null) {
    return (
      <div className="text-center space-y-2">
        <p className="text-[14px] font-semibold" style={{ color: "var(--success)" }}>
          ✓ Pase #{ticketNumber} comprado
        </p>
        <a href="/my-tickets" className="btn btn-secondary w-full btn-sm">
          Ver mis pases
        </a>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={handleBuy}
        disabled={stage === "submitting"}
        className="btn btn-primary w-full btn-lg"
      >
        {stage === "submitting" && <span className="spinner" />}
        {stage === "submitting" ? "Comprando…" : "Comprar pase"}
      </button>
      {error && (
        <p className="text-[12px] text-[var(--danger)] text-center mt-2">{translateError(error)}</p>
      )}
    </>
  );
}

function translateError(err: string) {
  switch (err) {
    case "sold_out":
      return "Agotado, no quedan entradas.";
    case "cannot_buy_own_event":
      return "No podés comprar entradas de tu propio evento.";
    case "event_not_emitted":
      return "El evento todavía no fue emitido a la blockchain.";
    case "unauthorized":
      return "Tenés que iniciar sesión para comprar.";
    default:
      return err;
  }
}
