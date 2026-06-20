"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { signPayload } from "@/lib/crypto/client";
import { getUnlockedKey } from "@/lib/identity-store";

interface Props {
  ticketId: string;
  publicKey: string;
  size?: number;
  refreshMs?: number; // re-firmar cada X ms para limitar ventana de replay
}

interface QRPayload {
  v: 1;
  type: "ticket_proof";
  ticketId: string;
  publicKey: string;
  issuedAt: string;
}

export function TicketQR({ ticketId, publicKey, size = 240, refreshMs = 30_000 }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issuedAt, setIssuedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function generate() {
      setError(null);
      try {
        const key = getUnlockedKey();
        if (!key) {
          setError("Clave bloqueada. Salí e ingresá de nuevo para firmar el QR.");
          setDataUrl(null);
          return;
        }
        const payload: QRPayload = {
          v: 1,
          type: "ticket_proof",
          ticketId,
          publicKey,
          issuedAt: new Date().toISOString(),
        };
        const signature = await signPayload(key, payload);
        const encoded = JSON.stringify({ payload, signature });
        const url = await QRCode.toDataURL(encoded, {
          width: size,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#0a0a0a", light: "#ffffff" },
        });
        if (!cancelled) {
          setDataUrl(url);
          setIssuedAt(payload.issuedAt);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "qr_generation_failed");
        }
      }
    }

    generate();
    const interval = setInterval(generate, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ticketId, publicKey, size, refreshMs]);

  if (error) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center text-[12px] text-[var(--danger)] bg-[var(--paper-2)] rounded-lg p-4 text-center"
      >
        {error}
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center text-[12px] text-[var(--muted)] bg-[var(--paper-2)] rounded-lg"
      >
        Firmando…
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={dataUrl} width={size} height={size} alt={`QR entrada ${ticketId}`} className="rounded-lg" />
      {issuedAt && (
        <p className="text-[11px] font-mono text-[var(--muted)]">
          Firmado {new Date(issuedAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
