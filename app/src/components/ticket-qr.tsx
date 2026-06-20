"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { signPayload } from "@/lib/crypto/client";
import { getUnlockedKey } from "@/lib/identity-store";

interface Props {
  ticketId: string;
  publicKey: string;
  size?: number;
  refreshMs?: number;
}

interface QRPayload {
  v: 1;
  type: "ticket_proof";
  ticketId: string;
  publicKey: string;
  issuedAt: string;
}

export function TicketQR({ ticketId, publicKey, size = 320, refreshMs = 30_000 }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issuedAt, setIssuedAt] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

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

        // Renderizamos a un tamaño grande (520) y dejamos que la UI lo escale.
        // QRs grandes se escanean mucho más rápido y desde más lejos.
        const url = await QRCode.toDataURL(encoded, {
          width: 520,
          margin: 2,
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
  }, [ticketId, publicKey, refreshMs]);

  // ESC para cerrar fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

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
    <>
      <div className="inline-flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          className="block rounded-lg overflow-hidden ring-1 ring-black/5 hover:ring-2 hover:ring-[var(--brand)] transition"
          title="Tocar para pantalla completa"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dataUrl}
            width={size}
            height={size}
            alt={`QR entrada ${ticketId}`}
            className="block"
            style={{ imageRendering: "pixelated" }}
          />
        </button>
        {issuedAt && (
          <p className="text-[11px] font-mono text-[var(--muted)]">
            Firmado {new Date(issuedAt).toLocaleTimeString()} · tocá para agrandar
          </p>
        )}
      </div>

      {fullscreen && (
        <div
          className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center p-6 gap-4"
          onClick={() => setFullscreen(false)}
          role="dialog"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dataUrl}
            alt={`QR entrada ${ticketId}`}
            className="max-w-[90vmin] max-h-[80vh] w-auto h-auto"
            style={{ imageRendering: "pixelated" }}
          />
          {issuedAt && (
            <p className="text-[13px] font-mono text-zinc-600">
              Firmado {new Date(issuedAt).toLocaleTimeString()}
            </p>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={(e) => {
              e.stopPropagation();
              setFullscreen(false);
            }}
          >
            Cerrar
          </button>
        </div>
      )}
    </>
  );
}
