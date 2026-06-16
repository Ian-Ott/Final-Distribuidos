import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await prisma.event.findMany({
    where: { status: { in: ["PUBLISHED", "EMITTED"] } },
    orderBy: { datetime: "asc" },
  });

  return (
    <div className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-10 sm:py-14 space-y-8 sm:space-y-10">
      <header className="space-y-3 max-w-2xl">
        <p className="eyebrow">Cartelera</p>
        <h1 className="text-[32px] sm:text-[44px] lg:text-[56px] leading-[1.05] tracking-[-0.025em] font-semibold">
          Próximos eventos
        </h1>
        <p className="text-[14px] sm:text-[16px] text-[var(--muted)] leading-relaxed">
          Cada entrada se emite en blockchain como un activo único. Tocá un evento para ver los detalles.
        </p>
      </header>

      {events.length === 0 ? (
        <div className="card p-16 text-center">
          <div
            className="mx-auto w-14 h-14 rounded-2xl grid place-items-center mb-5"
            style={{ background: "var(--surface)" }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="6" width="18" height="14" rx="2" stroke="var(--muted)" strokeWidth="1.6" />
              <path d="M8 3v4M16 3v4M3 11h18" stroke="var(--muted)" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
          <h3 className="text-[22px] font-semibold mb-2">Sin eventos por ahora</h3>
          <p className="text-[14px] text-[var(--muted)]">Volvé pronto, algo se viene.</p>
        </div>
      ) : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {events.map((e, i) => {
            const d = new Date(e.datetime);
            return (
              <li key={e.id} className={`rise rise-${(i % 5) + 1}`}>
                <Link
                  href={`/events/${e.id}`}
                  className="card overflow-hidden hover:-translate-y-0.5 hover:shadow-[var(--shadow)] transition-all duration-300 block group"
                >
                  <div
                    className="h-[140px] relative overflow-hidden"
                    style={{
                      background: e.imageUrl
                        ? `url(${e.imageUrl}) center/cover`
                        : "linear-gradient(135deg, #0a3aff 0%, #0066ff 60%, #4d8bff 100%)",
                    }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                    <div className="absolute top-4 left-4 right-4 flex items-start justify-between">
                      <div
                        className="flex flex-col items-center justify-center w-14 h-14 rounded-xl bg-white/95 backdrop-blur"
                      >
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                          {d.toLocaleDateString("es-AR", { month: "short" }).replace(".", "")}
                        </span>
                        <span className="text-[19px] font-semibold text-[var(--ink)] leading-none">
                          {d.toLocaleDateString("es-AR", { day: "2-digit" })}
                        </span>
                      </div>
                      {e.status === "EMITTED" && (
                        <span className="badge is-success" style={{ background: "rgba(255,255,255,0.95)" }}>
                          On-chain
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="p-5">
                    <h3 className="text-[18px] font-semibold leading-tight mb-1.5 group-hover:text-[var(--brand)] transition-colors">
                      {e.name}
                    </h3>
                    <p className="text-[13px] text-[var(--muted)]">{e.venue}</p>
                    <div className="flex items-center justify-between mt-5 pt-4 border-t border-[var(--line)]">
                      <span className="text-[16px] font-semibold">${e.price.toFixed(2)}</span>
                      <span className="text-[12px] text-[var(--muted)] mono">
                        {d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} hs
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
