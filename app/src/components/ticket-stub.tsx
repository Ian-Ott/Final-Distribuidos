import Link from "next/link";

type Props = {
  id: string;
  name: string;
  venue: string;
  datetime: Date | string;
  price: number;
  ticketCount: number;
  status?: string;
  href?: string;
};

export function TicketStub({ id, name, venue, datetime, price, ticketCount, status, href }: Props) {
  const date = new Date(datetime);
  const day = date.toLocaleDateString("es-AR", { day: "2-digit" });
  const month = date.toLocaleDateString("es-AR", { month: "short" }).replace(".", "");
  const time = date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  const year = date.getFullYear();

  const inner = (
    <article className="ticket group hover:-translate-y-0.5 transition-transform duration-300">
      {/* main */}
      <div className="p-5 sm:p-6 flex flex-col gap-4 min-h-[200px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="label">Pase / {id.slice(0, 6)}</p>
            <h3 className="italic-display text-[28px] sm:text-[32px] leading-[1.05] mt-1 text-[var(--ink)]">
              {name}
            </h3>
          </div>
          {status && (
            <span
              className={
                "pill " +
                (status === "EMITTED" ? "is-good" : status === "DRAFT" ? "is-warn" : "")
              }
            >
              {status === "EMITTED" ? "Emitido" : status === "DRAFT" ? "Borrador" : status}
            </span>
          )}
        </div>

        <p className="text-[var(--ink-soft)] text-[14px]">
          {venue} · <span className="font-mono">{time} hs</span>
        </p>

        <div className="mt-auto flex items-end justify-between">
          <div>
            <p className="label">Precio</p>
            <p className="font-mono text-[20px] tracking-tight text-[var(--ink)]">
              ${price.toFixed(2)}
            </p>
          </div>
          <div className="text-right">
            <p className="label">Emisión</p>
            <p className="font-mono text-[14px] text-[var(--ink-soft)]">{ticketCount} unidades</p>
          </div>
        </div>
      </div>

      {/* stub */}
      <aside className="ticket-stub flex flex-col items-center justify-center py-4">
        <div
          className="rotate-180 [writing-mode:vertical-rl] font-mono uppercase tracking-[0.22em] text-[10px] text-[var(--muted)]"
          style={{ writingMode: "vertical-rl" }}
        >
          <span className="font-display not-italic text-[26px] text-[var(--ink)] leading-none">
            {day}
          </span>
          <span className="mx-1">{month}</span>
          <span>{year}</span>
        </div>
      </aside>
    </article>
  );

  if (!href) return inner;
  return (
    <Link href={href} className="block focus:outline-none focus:ring-2 focus:ring-[var(--accent)] rounded-[var(--radius)]">
      {inner}
    </Link>
  );
}
