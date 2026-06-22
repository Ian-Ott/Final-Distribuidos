"use client";

import { useEffect, useState } from "react";
import { StatusCards } from "./status-cards";
import { BlockExplorer } from "./block-explorer";
import { EventLog } from "./event-log";

interface PanelData {
  status: { difficulty: string; total_bloques: number; pending_tx: number; minando: boolean } | null;
  blockchain: unknown[] | null;
  logs: unknown[] | null;
  timestamp: string;
}

export function BlockchainPanel() {
  const [data, setData] = useState<PanelData | null>(null);
  const [ago, setAgo] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/blockchain", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setAgo(0);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    poll();
    const id = setInterval(poll, 5_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setAgo((p) => p + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-8 sm:space-y-10">
      <div className="flex items-center gap-2 text-[13px] text-[var(--muted)]">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{
            background: error ? "var(--error)" : "var(--success)",
            animation: error ? "none" : "pulse 2s infinite",
          }}
        />
        {error
          ? "NCT no disponible"
          : data
            ? `Actualizado hace ${ago}s`
            : "Conectando…"}
      </div>

      <StatusCards status={data?.status ?? null} />

      <BlockExplorer blocks={(data?.blockchain as never[]) ?? null} />

      <EventLog logs={(data?.logs as never[]) ?? null} />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: .4; }
        }
      `}</style>
    </div>
  );
}
