"use client";

import { useState } from "react";
import { TicketQR } from "@/components/ticket-qr";

interface TicketRow {
  ticketId: string;
  ticketNumber: number;
  event:
    | {
        id: string;
        name: string;
        datetime: Date;
        venue: string;
        imageUrl: string | null;
      }
    | undefined;
}

export function MyTicketsList({
  tickets,
  publicKey,
}: {
  tickets: TicketRow[];
  publicKey: string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <ul className="space-y-3">
      {tickets.map((t) => {
        const isOpen = open === t.ticketId;
        const date = t.event ? new Date(t.event.datetime) : null;
        return (
          <li key={t.ticketId} className="card overflow-hidden">
            <div className="flex items-start gap-3 sm:gap-5 p-4 sm:p-5">
              {date && (
                <div
                  className="flex flex-col items-center justify-center w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl flex-shrink-0"
                  style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
                >
                  <span className="text-[9px] sm:text-[11px] font-semibold uppercase tracking-wider opacity-80 leading-none">
                    {date.toLocaleDateString("es-AR", { month: "short" }).replace(".", "")}
                  </span>
                  <span className="text-[18px] sm:text-[22px] font-semibold leading-none mt-1">
                    {date.toLocaleDateString("es-AR", { day: "2-digit" })}
                  </span>
                </div>
              )}

              <div className="flex-1 min-w-0">
                <h3 className="text-[15px] sm:text-[17px] font-semibold leading-tight">
                  {t.event?.name ?? "Evento desconocido"}
                </h3>
                <p className="text-[12px] sm:text-[13px] text-[var(--muted)] truncate">
                  {t.event?.venue ?? "—"}
                  {date && ` · ${date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} hs`}
                </p>
                <p className="text-[11px] mono text-[var(--muted)] mt-1">
                  Entrada #{t.ticketNumber}
                </p>
              </div>

              <button
                onClick={() => setOpen(isOpen ? null : t.ticketId)}
                className="btn btn-primary btn-sm flex-shrink-0"
              >
                {isOpen ? "Ocultar" : "Mostrar QR"}
              </button>
            </div>

            {isOpen && (
              <div className="border-t border-[var(--line)] p-5 flex flex-col items-center gap-3 bg-[var(--paper-2)]">
                <TicketQR ticketId={t.ticketId} publicKey={publicKey} size={240} />
                <p className="text-[12px] text-[var(--muted)] max-w-xs text-center">
                  Mostrá este QR en la puerta. Se renueva cada 30 segundos para evitar capturas.
                </p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
