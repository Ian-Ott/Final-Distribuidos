"use client";

// Los logs vienen del NCT (GET /logs). Cada entrada tiene la forma:
//   { timestamp: number, event: string, ...campos según el tipo }
// Ej: { event: "bloque_creado", task_id, index, hash, tx_count }
//     { event: "solucion_tomada", task_id, nonce, hash }
//     { event: "trp_subdividio_tarea", task_id, chunks, difficulty }
interface LogEntry {
  timestamp?: number;
  event?: string;
  [key: string]: unknown;
}

interface TypeConfig {
  dot: string;
  label: string;
  // Construye una línea de detalle legible a partir de los campos del evento.
  detail?: (e: LogEntry) => string | null;
}

const TYPE_CONFIG: Record<string, TypeConfig> = {
  bloque_creado: {
    dot: "var(--success)",
    label: "Bloque minado",
    detail: (e) =>
      `#${e.index ?? "?"} · ${shortHash(e.hash)} · ${e.tx_count ?? 0} tx`,
  },
  transaccion_recibida: {
    dot: "var(--brand)",
    label: "TX recibida",
    detail: () => null,
  },
  trp_subdividio_tarea: {
    dot: "var(--muted)",
    label: "TrP subdividió tarea",
    detail: (e) => `${e.chunks ?? "?"} chunks · dificultad ${e.difficulty ?? "?"}`,
  },
  tarea_enviada_a_trp: {
    dot: "var(--muted)",
    label: "Tarea enviada al TrP",
    detail: (e) => `dificultad ${e.difficulty ?? "?"}`,
  },
  solucion_tomada: {
    dot: "var(--brand)",
    label: "Solución encontrada",
    detail: (e) => `nonce ${e.nonce ?? "?"} · ${shortHash(e.hash)}`,
  },
  soluciones_sobrantes_purgadas: {
    dot: "var(--muted-2)",
    label: "Soluciones purgadas",
    detail: (e) => `${e.count ?? 0} descartadas`,
  },
  solucion_descartada: {
    dot: "var(--warn)",
    label: "Solución descartada",
    detail: (e) => (e.received_task_id ? `task ajeno ${shortTask(e.received_task_id)}` : "fuera de tiempo"),
  },
  solucion_invalida: {
    dot: "var(--danger)",
    label: "Solución inválida",
    detail: (e) => shortHash(e.hash),
  },
  minado_timeout: {
    dot: "var(--danger)",
    label: "Timeout de minado",
    detail: (e) => `tras ${e.timeout_seconds ?? "?"}s`,
  },
  dificultad_cambiada: {
    dot: "var(--warn)",
    label: "Dificultad cambiada",
    detail: (e) => `→ ${e.difficulty ?? "?"}`,
  },
  fallback_cpu_activado: {
    dot: "var(--warn)",
    label: "Fallback CPU activado",
    detail: (e) => `dificultad → ${e.difficulty_nueva ?? "?"}`,
  },
  fallback_cpu_restaurado: {
    dot: "var(--success)",
    label: "GPU restaurada",
    detail: (e) => `dificultad → ${e.difficulty_restaurada ?? "?"}`,
  },
  auto_miner_error: {
    dot: "var(--danger)",
    label: "Error del auto-miner",
    detail: (e) => truncate(String(e.error ?? "")),
  },
};

function shortHash(h: unknown): string {
  const s = typeof h === "string" ? h : "";
  return s ? s.slice(0, 10) + "…" : "—";
}

function shortTask(t: unknown): string {
  const s = typeof t === "string" ? t : "";
  return s ? s.slice(0, 8) : "—";
}

function truncate(s: string, n = 48): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function formatTime(ts: number) {
  try {
    return new Date(ts * 1000).toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
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

  // Más recientes primero, máximo 50.
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
            const type = entry.event ?? "";
            const cfg = TYPE_CONFIG[type] ?? {
              dot: "var(--muted)",
              label: type || "evento",
            };
            const detail = cfg.detail?.(entry) ?? null;
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
                  {detail && (
                    <p className="text-[12px] text-[var(--muted)] mt-0.5 truncate mono">
                      {detail}
                    </p>
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
