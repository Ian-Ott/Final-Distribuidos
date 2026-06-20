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
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const lastSubmittedRef = useRef<string | null>(null);

  const handleScan = useCallback(
    async (decodedText: string) => {
      if (busy) return;
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
          beep("error");
        } else {
          setResult({
            kind: "ok",
            ticketNumber: body.ticket.ticketNumber,
            eventName: body.ticket.eventName,
            venue: body.ticket.venue,
          });
          beep("ok");
        }
      } catch (err) {
        setResult({
          kind: "error",
          code: "parse_error",
          message: err instanceof Error ? err.message : "QR ilegible",
        });
        beep("error");
      } finally {
        setBusy(false);
        // Liberar el lock después de un ratito para permitir reescanear.
        setTimeout(() => {
          lastSubmittedRef.current = null;
        }, 2000);
      }
    },
    [busy],
  );

  async function start() {
    if (running || starting) return;
    setCameraError(null);
    setStarting(true);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "Tu navegador no expone la cámara. Si entraste por http://, en celulares se requiere HTTPS.",
      );
      setStarting(false);
      return;
    }

    const html5Qr = new Html5Qrcode(READER_ID);
    scannerRef.current = html5Qr;
    try {
      await html5Qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => handleScan(decodedText),
        () => {},
      );
      setRunning(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCameraError(humanCameraError(msg));
      scannerRef.current = null;
    } finally {
      setStarting(false);
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
        <div className="relative w-full bg-black" style={{ aspectRatio: "1 / 1" }}>
          <div
            id={READER_ID}
            className="absolute inset-0 w-full h-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover"
          />

          {!running && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/70 gap-3 pointer-events-none">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 7a2 2 0 0 1 2-2h2l1.5-2h5L16 5h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <p className="text-[13px]">{starting ? "Abriendo cámara…" : "Cámara apagada"}</p>
            </div>
          )}

          {running && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div
                className="border-2 border-white/80 rounded-2xl"
                style={{ width: 240, height: 240, boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)" }}
              />
            </div>
          )}

          {busy && (
            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3 text-white">
              <span className="spinner" style={{ width: 28, height: 28 }} />
              <p className="text-[14px] font-semibold">Validando…</p>
            </div>
          )}

          {/* Overlay grande de resultado — encima de la cámara, ocupa todo el visor */}
          {result && (
            <ResultOverlay result={result} onClose={() => setResult(null)} />
          )}
        </div>

        <div className="border-t border-[var(--line)] p-4 flex items-center justify-between gap-3">
          {running ? (
            <button onClick={stop} className="btn btn-secondary btn-sm">
              Detener cámara
            </button>
          ) : (
            <button onClick={start} disabled={starting} className="btn btn-primary btn-sm">
              {starting && <span className="spinner" />}
              {starting ? "Iniciando…" : "Iniciar cámara"}
            </button>
          )}
        </div>
      </div>

      {cameraError && (
        <div
          className="card p-4 text-[13px]"
          style={{
            borderColor: "var(--danger)",
            background: "var(--danger-soft)",
            color: "var(--danger)",
          }}
        >
          <p className="font-semibold mb-1">No pude abrir la cámara</p>
          <p>{cameraError}</p>
        </div>
      )}
    </div>
  );
}

function ResultOverlay({ result, onClose }: { result: Result; onClose: () => void }) {
  // Auto-dismiss para permitir escanear el siguiente sin tocar nada.
  useEffect(() => {
    const t = setTimeout(onClose, result.kind === "ok" ? 3500 : 4500);
    return () => clearTimeout(t);
  }, [result, onClose]);

  const isOk = result.kind === "ok";
  const bg = isOk ? "#16a34a" : "#dc2626"; // verde / rojo intensos
  const accent = isOk ? "#bbf7d0" : "#fecaca";

  return (
    <button
      type="button"
      onClick={onClose}
      className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white text-center px-6 cursor-pointer"
      style={{ background: bg }}
    >
      {/* Ícono enorme */}
      <div className="rounded-full p-5" style={{ background: "rgba(255,255,255,0.18)" }}>
        {isOk ? (
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12l5 5L20 7"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 6l12 12M18 6l-12 12"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>

      <p className="text-[28px] font-bold leading-tight" style={{ color: "white" }}>
        {isOk ? "Acceso autorizado" : "Rechazado"}
      </p>

      {result.kind === "ok" ? (
        <div className="space-y-1">
          <p className="text-[18px] font-semibold">Entrada #{result.ticketNumber}</p>
          <p className="text-[15px]" style={{ color: accent }}>
            {result.eventName}
          </p>
          <p className="text-[13px] opacity-80">{result.venue}</p>
        </div>
      ) : (
        <div className="space-y-1 max-w-xs">
          <p className="text-[15px]" style={{ color: accent }}>
            {result.message}
          </p>
          <p className="text-[11px] font-mono opacity-70">{result.code}</p>
        </div>
      )}

      <p className="text-[12px] opacity-70 mt-2">Tocá para continuar</p>
    </button>
  );
}

function beep(kind: "ok" | "error") {
  try {
    const W = window as unknown as { AudioContext?: typeof AudioContext };
    const Ctor = W.AudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    if (kind === "ok") {
      osc.frequency.value = 880; // A5
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } else {
      osc.frequency.value = 220; // A3
      gain.gain.setValueAtTime(0.16, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch {
    // Audio bloqueado por el browser, no es crítico.
  }
}

function humanCameraError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("permission") || m.includes("notallowed")) {
    return "Permiso denegado. Habilitá la cámara en el menú de candado del navegador.";
  }
  if (m.includes("notfound") || m.includes("devicesnotfound")) {
    return "No encontré una cámara en este dispositivo.";
  }
  if (m.includes("notreadable") || m.includes("trackstart")) {
    return "Otra app está usando la cámara. Cerrá videollamadas o el visor de cámara.";
  }
  if (m.includes("secure")) {
    return "La cámara requiere HTTPS en móviles. Probá con un túnel (cloudflared/ngrok).";
  }
  return msg;
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
