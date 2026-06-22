"use client";

interface LogEntry {
  timestamp?: number;
  type?: string;
  message?: string;
  [key: string]: unknown;
}

const TYPE_COLORS: Record<string, { dot: string; label: string }> = {
  bloque_creado: { dot: "var(--success)", label: "Bloque creado" },
  transaccion_recibida: { dot: "var(--brand)", label: "TX recibida" },
  trp_subdividio_tarea: { dot: "var(--muted)", label: "TrP subdividió" },
  solucion_invalida: { dot: "var(--error)", label: "Solución inválida" },
  dificultad_cambiada: { dot: "var(--warn)", label: "Dificultad" },
};

function formatTime(ts: number) {
  try {
    return new Date(ts * 1000).toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return String(ts);
  }
}

export function EventLog({ logs }: { logs: LogEntry[] | null }) {
  if (!logs || logs.length === 0) {
    return (
      <section>
        <h2 className="text-[20px] font-semibold mb-5">Eventos</h2>
        <div className="card p-10 text-center text-[var(--muted)] text-[14px]">
          Sin eventos registrados.
        </div>
      </section>
    );
  }

  const recent = [...logs].reverse().slice(0, 50);

  return (
    <section>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-[20px] font-semibold">Eventos</h2>
        <p className="text-[13px] text-[var(--muted)]">{logs.length} totales</p>
      </div>
      <div className="card p-4 sm:p-6">
        <ul className="space-y-3">
          {recent.map((entry, i) => {
            const cfg = TYPE_COLORS[entry.type ?? ""] ?? { dot: "var(--muted)", label: entry.type ?? "evento" };
            return (
              <li key={i} className="flex gap-3 items-start text-[13px]">
                <span
                  className="mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: cfg.dot }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{cfg.label}</span>
                    {entry.timestamp && (
                      <span className="mono text-[11px] text-[var(--muted)]">
                        {formatTime(entry.timestamp)}
                      </span>
                    )}
                  </div>
                  {entry.message && (
                    <p className="text-[12px] text-[var(--muted)] mt-0.5 truncate">{entry.message}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
