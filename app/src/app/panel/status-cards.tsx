"use client";

interface Status {
  difficulty: string;
  total_bloques: number;
  pending_tx: number;
  minando: boolean;
}

export function StatusCards({ status }: { status: Status | null }) {
  const cards = [
    {
      k: "Bloques totales",
      v: status?.total_bloques ?? "—",
      soft: "var(--brand-soft)",
      ink: "var(--brand)",
    },
    {
      k: "Dificultad",
      v: status?.difficulty ? `${"0".repeat(status.difficulty.length)} (${status.difficulty.length})` : "—",
      soft: "var(--surface)",
      ink: "var(--ink)",
    },
    {
      k: "TX pendientes",
      v: status?.pending_tx ?? "—",
      soft: status?.pending_tx ? "var(--warn-soft)" : "var(--surface)",
      ink: status?.pending_tx ? "var(--warn)" : "var(--ink)",
    },
    {
      k: "Minando",
      v: status?.minando ? "Sí" : "No",
      soft: status?.minando ? "var(--success-soft)" : "var(--surface)",
      ink: status?.minando ? "var(--success)" : "var(--muted)",
    },
  ];

  return (
    <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
      {cards.map((s) => (
        <div key={s.k} className="card p-4 sm:p-6">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <p className="text-[12px] sm:text-[13px] font-medium text-[var(--muted)]">{s.k}</p>
            <span
              className="inline-block w-6 h-6 sm:w-8 sm:h-8 rounded-full flex-shrink-0"
              style={{ background: s.soft }}
            />
          </div>
          <p
            className="text-[24px] sm:text-[36px] leading-none font-semibold tracking-[-0.02em]"
            style={{ color: s.ink }}
          >
            {s.v}
          </p>
        </div>
      ))}
    </section>
  );
}
