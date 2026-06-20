"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

type Result =
  | { kind: "ok"; ticketNumber: number; eventName: string; venue: string }
  | { kind: "error"; code: string; message: string };

const READER_ID = "qr-reader";

export function ScannerClient() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const lastSubmittedRef = useRef<string | null>(null);

  const handleScan = useCallback(async (decodedText: string) => {
    if (busy) return;
    // Evitar reenviar el mismo QR mientras se procesa.
    if (lastSubmittedRef.current === decodedText) return;
    lastSubmittedRef.current = decodedText;
    setBusy(true);
    setResult(null);
    try {
      const parsed = JSON.parse(decodedText);
      const res = await fetch("/api/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const body = await res.json();
      if (!res.ok) {
        setResult({
          kind: "error",
          code: body.error ?? "unknown",
          message: translateError(body.error),
        });
      } else {
        setResult({
          kind: "ok",
          ticketNumber: body.ticket.ticketNumber,
          eventName: body.ticket.eventName,
          venue: body.ticket.venue,
        });
      }
    } catch (err) {
      setResult({
        kind: "error",
        code: "parse_error",
        message: err instanceof Error ? err.message : "QR ilegible",
      });
    } finally {
      setBusy(false);
      // Liberar el "lock" después de un ratito para permitir reescanear si hace falta.
      setTimeout(() => {
        lastSubmittedRef.current = null;
      }, 2000);
    }
  }, [busy]);

  async function start() {
    if (running) return;
    const html5Qr = new Html5Qrcode(READER_ID);
    scannerRef.current = html5Qr;
    try {
      await html5Qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => handleScan(decodedText),
        () => {
          // ignoramos errores de "no encontró un QR en este frame"
        },
      );
      setRunning(true);
    } catch (err) {
      setResult({
        kind: "error",
        code: "camera_failed",
        message: err instanceof Error ? err.message : "No pude abrir la cámara",
      });
    }
  }

  async function stop() {
    const s = scannerRef.current;
    if (!s) return;
    try {
      await s.stop();
      s.clear();
    } catch {
      // ignore
    }
    scannerRef.current = null;
    setRunning(false);
  }

  useEffect(() => {
    return () => {
      // cleanup en unmount
      const s = scannerRef.current;
      if (s) {
        s.stop()
          .then(() => s.clear())
          .catch(() => {});
      }
    };
  }, []);

  return (
    <div className="space-y-5">
      <div className="card overflow-hidden">
        <div
          id={READER_ID}
          className="w-full aspect-square bg-[var(--paper-2)] flex items-center justify-center text-[var(--muted)] text-[13px]"
        >
          {!running && "Cámara apagada"}
        </div>
        <div className="border-t border-[var(--line)] p-4 flex items-center justify-between gap-3">
          {running ? (
            <button onClick={stop} className="btn btn-secondary btn-sm">Detener cámara</button>
          ) : (
            <button onClick={start} className="btn btn-primary btn-sm">Iniciar cámara</button>
          )}
          {busy && (
            <span className="text-[12px] text-[var(--muted)] flex items-center gap-2">
              <span className="spinner" />
              Validando…
            </span>
          )}
        </div>
      </div>

      {result?.kind === "ok" && (
        <div
          className="card p-5 space-y-1"
          style={{ borderColor: "var(--success)", background: "var(--success-soft)" }}
        >
          <p className="text-[14px] font-semibold" style={{ color: "var(--success)" }}>
            ✓ Acceso autorizado
          </p>
          <p className="text-[15px]">
            Entrada #{result.ticketNumber} — {result.eventName}
          </p>
          <p className="text-[13px] text-[var(--muted)]">{result.venue}</p>
          <p className="text-[12px] text-[var(--muted)] mt-2">
            La entrada fue devuelta al organizador y ya no puede reutilizarse.
          </p>
        </div>
      )}

      {result?.kind === "error" && (
        <div
          className="card p-5 space-y-1"
          style={{ borderColor: "var(--danger)", background: "var(--danger-soft)" }}
        >
          <p className="text-[14px] font-semibold" style={{ color: "var(--danger)" }}>
            ✗ Rechazado
          </p>
          <p className="text-[13px]">{result.message}</p>
          <p className="text-[11px] mono text-[var(--muted)] mt-1">{result.code}</p>
        </div>
      )}
    </div>
  );
}

function translateError(code: string | undefined): string {
  switch (code) {
    case "invalid_qr":
      return "El QR no tiene el formato esperado.";
    case "invalid_timestamp":
      return "El timestamp del QR es inválido.";
    case "qr_expired":
      return "El QR está vencido. Pedile al asistente que abra de nuevo su entrada.";
    case "qr_from_future":
      return "El reloj del dispositivo está adelantado.";
    case "invalid_signature":
      return "La firma del QR no es válida.";
    case "ticket_not_found":
      return "Esta entrada no existe.";
    case "not_event_organizer":
      return "No sos el organizador del evento de esta entrada.";
    case "not_current_owner":
      return "La entrada ya fue usada o transferida a otro dueño.";
    case "parse_error":
      return "No pude leer el QR.";
    case "camera_failed":
      return "No pude abrir la cámara. Permisos del navegador?";
    default:
      return code ?? "Error desconocido.";
  }
}
