import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { EmitButton } from "./emit-button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  if (session.role !== "ORGANIZER") redirect("/events");

  const events = await prisma.event.findMany({
    where: { organizerId: session.userId },
    orderBy: { createdAt: "desc" },
  });

  const emitted = events.filter((e) => e.status === "EMITTED").length;
  const totalTickets = events.reduce((acc, e) => acc + e.ticketCount, 0);

  return (
    <div className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-10 sm:py-14 space-y-8 sm:space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4 sm:gap-6">
        <div className="space-y-2 flex-1 min-w-[200px]">
          <p className="eyebrow">Panel del organizador</p>
          <h1 className="text-[30px] sm:text-[40px] lg:text-[48px] leading-[1.05] tracking-[-0.025em] font-semibold">
            Tus eventos
          </h1>
          <p className="text-[14px] sm:text-[15px] text-[var(--muted)] max-w-lg">
            Creá un evento, firmalo con tu clave y emitilo a la blockchain.
          </p>
        </div>
        <Link href="/dashboard/events/new" className="btn btn-primary w-full sm:w-auto">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          Nuevo evento
        </Link>
      </header>

      <section className="grid grid-cols-3 gap-3 sm:gap-4">
        {[
          { k: "Eventos creados", v: events.length, soft: "var(--brand-soft)", ink: "var(--brand)" },
          { k: "Emitidos en BC", v: emitted, soft: "var(--success-soft)", ink: "var(--success)" },
          { k: "Entradas totales", v: totalTickets, soft: "var(--surface)", ink: "var(--ink)" },
        ].map((s) => (
          <div key={s.k} className="card p-4 sm:p-6">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <p className="text-[12px] sm:text-[13px] font-medium text-[var(--muted)]">{s.k}</p>
              <span
                className="inline-block w-6 h-6 sm:w-8 sm:h-8 rounded-full flex-shrink-0"
                style={{ background: s.soft as string }}
              />
            </div>
            <p className="text-[28px] sm:text-[40px] leading-none font-semibold tracking-[-0.02em]" style={{ color: s.ink as string }}>
              {s.v}
            </p>
          </div>
        ))}
      </section>

      <section>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[20px] font-semibold">Tus eventos</h2>
          <p className="text-[13px] text-[var(--muted)]">{events.length} {events.length === 1 ? "evento" : "eventos"}</p>
        </div>

        {events.length === 0 ? (
          <div className="card p-14 text-center">
            <div
              className="mx-auto w-14 h-14 rounded-2xl grid place-items-center mb-5"
              style={{ background: "var(--brand-soft)" }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 5v14M5 12h14" stroke="var(--brand)" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </div>
            <h3 className="text-[22px] font-semibold mb-2">Todavía sin eventos</h3>
            <p className="text-[14px] text-[var(--muted)] mb-6 max-w-sm mx-auto">
              Creá tu primer evento en menos de un minuto. Después lo firmás y lo emitís a la cadena.
            </p>
            <Link href="/dashboard/events/new" className="btn btn-primary">Crear primer evento</Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {events.map((e) => {
              const date = new Date(e.datetime);
              return (
                <li
                  key={e.id}
                  className="card p-4 sm:p-5 hover:shadow-[var(--shadow)] transition-shadow"
                >
                  <div className="flex items-start gap-3 sm:gap-5">
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

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="text-[15px] sm:text-[17px] font-semibold leading-tight truncate">
                          {e.name}
                        </h3>
                        <span
                          className={
                            "badge flex-shrink-0 " +
                            (e.status === "EMITTED" ? "is-success" : e.status === "DRAFT" ? "is-warn" : "")
                          }
                        >
                          {e.status === "EMITTED" ? "Emitido" : e.status === "DRAFT" ? "Borrador" : e.status}
                        </span>
                      </div>
                      <p className="text-[12px] sm:text-[13px] text-[var(--muted)] truncate">
                        {e.venue} · {date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} hs
                      </p>
                      <p className="text-[12px] sm:text-[13px] text-[var(--muted)] mt-0.5">
                        <span className="text-[var(--ink)] font-medium mono">${e.price.toFixed(2)}</span>
                        {" · "}{e.ticketCount} entradas
                      </p>
                      {e.ncTBatchRef && (
                        <p className="text-[11px] mono text-[var(--muted)] mt-1 truncate">
                          batch {e.ncTBatchRef}
                        </p>
                      )}
                    </div>
                  </div>

                  {e.status !== "EMITTED" && (
                    <div className="flex justify-end pt-3 mt-3 border-t border-[var(--line)]">
                      <EmitButton eventId={e.id} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
