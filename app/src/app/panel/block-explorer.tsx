"use client";

interface Transaction {
  op_id?: string;
  tx_type?: string;
  sender?: string;
  receiver?: string;
  amount?: number;
  to_pubkey?: string;
  ticket_count?: number;
  event_id?: string;
}

interface Block {
  index: number;
  timestamp: number;
  transactions: Transaction[];
  previous_hash: string;
  nonce: number;
  block_hash: string;
}

function truncate(s: string, n = 16) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function formatTime(ts: number) {
  try {
    return new Date(ts * 1000).toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return String(ts);
  }
}

export function BlockExplorer({ blocks }: { blocks: Block[] | null }) {
  if (!blocks || blocks.length === 0) {
    return (
      <section>
        <h2 className="text-[20px] font-semibold mb-5">Bloques</h2>
        <div className="card p-10 text-center text-[var(--muted)] text-[14px]">
          No hay bloques en la cadena todavía.
        </div>
      </section>
    );
  }

  const sorted = [...blocks].reverse();

  return (
    <section>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-[20px] font-semibold">Bloques</h2>
        <p className="text-[13px] text-[var(--muted)]">{blocks.length} bloques</p>
      </div>
      <ul className="space-y-2">
        {sorted.map((block) => (
          <li key={block.index}>
            <details className="card group">
              <summary className="flex items-center gap-3 sm:gap-4 p-4 sm:p-5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <div
                  className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex-shrink-0 text-[14px] sm:text-[16px] font-semibold"
                  style={{
                    background: block.index === 0 ? "var(--surface)" : "var(--brand-soft)",
                    color: block.index === 0 ? "var(--muted)" : "var(--brand)",
                  }}
                >
                  #{block.index}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="mono text-[13px] sm:text-[14px] truncate">
                      {block.block_hash === "GENESIS" ? "GENESIS" : truncate(block.block_hash)}
                    </span>
                    {block.transactions.length > 0 && (
                      <span className="badge is-success flex-shrink-0">
                        {block.transactions.length} tx
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] sm:text-[12px] text-[var(--muted)]">
                    {formatTime(block.timestamp)}
                    {block.index > 0 && <> · nonce: <span className="mono">{block.nonce.toLocaleString()}</span></>}
                  </p>
                </div>
                <svg
                  width="16" height="16" viewBox="0 0 24 24" fill="none"
                  className="flex-shrink-0 text-[var(--muted)] transition-transform group-open:rotate-180"
                >
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </summary>

              <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-0 border-t border-[var(--line)]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 text-[12px] sm:text-[13px]">
                  <div>
                    <span className="text-[var(--muted)]">Hash: </span>
                    <span className="mono break-all">{block.block_hash}</span>
                  </div>
                  <div>
                    <span className="text-[var(--muted)]">Hash anterior: </span>
                    <span className="mono break-all">{block.previous_hash}</span>
                  </div>
                </div>

                {block.transactions.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-[12px] font-medium text-[var(--muted)] uppercase tracking-wider">
                      Transacciones
                    </p>
                    {block.transactions.map((tx, i) => (
                      <div
                        key={tx.op_id ?? i}
                        className="rounded-lg p-3"
                        style={{ background: "var(--surface)" }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="badge"
                            style={{
                              color: tx.tx_type === "mint" ? "var(--success)" : "var(--brand)",
                              background: tx.tx_type === "mint" ? "var(--success-soft)" : "var(--brand-soft)",
                            }}
                          >
                            {tx.tx_type ?? "tx"}
                          </span>
                          {tx.op_id && <span className="mono text-[11px] text-[var(--muted)]">{tx.op_id}</span>}
                        </div>
                        <div className="text-[12px] space-y-0.5">
                          {tx.ticket_count != null && (
                            <p><span className="text-[var(--muted)]">Tickets: </span><span className="font-medium">{tx.ticket_count}</span></p>
                          )}
                          {tx.event_id && (
                            <p><span className="text-[var(--muted)]">Evento: </span><span className="mono">{truncate(tx.event_id, 24)}</span></p>
                          )}
                          {tx.to_pubkey && (
                            <p><span className="text-[var(--muted)]">Destino: </span><span className="mono">{truncate(tx.to_pubkey, 24)}</span></p>
                          )}
                          {tx.sender && (
                            <p><span className="text-[var(--muted)]">De: </span><span className="mono">{truncate(tx.sender, 24)}</span></p>
                          )}
                          {tx.receiver && (
                            <p><span className="text-[var(--muted)]">Para: </span><span className="mono">{truncate(tx.receiver, 24)}</span></p>
                          )}
                          {tx.amount != null && (
                            <p><span className="text-[var(--muted)]">Monto: </span><span className="font-medium">{tx.amount}</span></p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {block.transactions.length === 0 && (
                  <p className="mt-3 text-[12px] text-[var(--muted)] italic">Bloque génesis — sin transacciones.</p>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
