"use client";

interface LogEntry {
  timestamp?: number;
  event?: string;
  type?: string;
  message?: string;
  worker_id?: string;
  nonce?: number;
  hash?: string;
  index?: number;
  chunks?: number;
  difficulty?: string;
  difficulty_anterior?: string;
  difficulty_nueva?: string;
  difficulty_restaurada?: string;
  [key: string]: unknown;
}

const TYPE_COLORS: Record<string, { dot: string; label: string }> = {
  bloque_creado: { dot: "var(--success)", label: "Bloque creado" },
  solucion_encontrada: { dot: "var(--brand)", label: "Solucion encontrada" },
  transaccion_recibida: { dot: "var(--brand)", label: "TX recibida" },
  trp_subdividio_tarea: { dot: "var(--muted)", label: "TrP subdividió" },
  solucion_invalida: { dot: "var(--danger)", label: "Solución inválida" },
  dificultad_cambiada: { dot: "var(--warn)", label: "Dificultad" },
  fallback_cpu_activado: { dot: "var(--warn)", label: "Fallback CPU" },
  fallback_cpu_restaurado: { dot: "var(--success)", label: "GPU restaurada" },
  minado_timeout: { dot: "var(--danger)", label: "Timeout de minado" },
  solucion_descartada: { dot: "var(--warn)", label: "Solucion descartada" },
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

function getEventType(entry: LogEntry) {
  return entry.event ?? entry.type ?? "evento";
}

function buildDetails(entry: LogEntry) {
  const eventType = getEventType(entry);

  if (entry.message) return entry.message;

  if (eventType === "solucion_encontrada") {
    const parts = [];
    if (entry.worker_id) parts.push(`worker ${entry.worker_id}`);
    if (typeof entry.nonce === "number") parts.push(`nonce ${entry.nonce.toLocaleString("es-AR")}`);
    if (typeof entry.hash === "string") parts.push(`hash ${entry.hash.slice(0, 12)}`);
    return parts.join(" · ");
  }

  if (eventType === "bloque_creado") {
    const parts = [];
    if (typeof entry.index === "number") parts.push(`bloque #${entry.index}`);
    if (typeof entry.hash === "string") parts.push(`hash ${entry.hash.slice(0, 12)}`);
    return parts.join(" · ");
  }

  if (eventType === "trp_subdividio_tarea") {
    const parts = [];
    if (typeof entry.chunks === "number") parts.push(`${entry.chunks} chunks`);
    if (typeof entry.difficulty === "string") parts.push(`dificultad ${entry.difficulty}`);
    return parts.join(" · ");
  }

  if (eventType === "fallback_cpu_activado") {
    return `dificultad ${entry.difficulty_anterior ?? "?"} -> ${entry.difficulty_nueva ?? "?"}`;
  }

  if (eventType === "fallback_cpu_restaurado") {
    return `restaurada a ${entry.difficulty_restaurada ?? "?"}`;
  }

  return "";
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
            const eventType = getEventType(entry);
            const cfg = TYPE_COLORS[eventType] ?? { dot: "var(--muted)", label: eventType };
            const details = buildDetails(entry);
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
                  {details && (
                    <p className="text-[12px] text-[var(--muted)] mt-0.5 break-words">{details}</p>
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
