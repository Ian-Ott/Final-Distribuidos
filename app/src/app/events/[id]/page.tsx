import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PaseMockup } from "@/components/pase-mockup";

export const dynamic = "force-dynamic";

export default async function EventDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) notFound();

  const date = new Date(event.datetime);
  const isEmitted = event.status === "EMITTED";

  return (
    <div className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-10 sm:py-14">
      <Link
        href="/events"
        className="inline-flex items-center gap-1.5 text-[13px] sm:text-[14px] text-[var(--muted)] hover:text-[var(--ink)] transition-colors mb-6 sm:mb-8"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Volver a la cartelera
      </Link>

      <div className="grid lg:grid-cols-12 gap-8 lg:gap-10">
        <div className="lg:col-span-7 space-y-6 sm:space-y-8 rise rise-1">
          <header className="space-y-3 sm:space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              {isEmitted ? (
                <span className="badge is-success">On-chain · Emitido</span>
              ) : (
                <span className="badge is-warn">Borrador</span>
              )}
              <span className="mono text-[11px] sm:text-[12px] text-[var(--muted)]">
                ID {event.id.slice(0, 8)}
              </span>
            </div>
            <h1 className="text-[32px] sm:text-[44px] lg:text-[60px] leading-[1.04] tracking-[-0.025em] font-semibold">
              {event.name}
            </h1>
          </header>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
            <Stat
              label="Fecha"
              value={date.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
              hint={String(date.getFullYear())}
            />
            <Stat
              label="Hora"
              value={date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
              hint="hs"
              mono
            />
            <Stat label="Lugar" value={event.venue} span2 />
          </div>

          {event.description && (
            <div>
              <h2 className="text-[18px] sm:text-[20px] font-semibold mb-3">Sobre el evento</h2>
              <p className="text-[14px] sm:text-[15.5px] leading-relaxed text-[var(--ink-2)] whitespace-pre-wrap">
                {event.description}
              </p>
            </div>
          )}

          <div className="card p-5 sm:p-6 space-y-4">
            <h2 className="text-[15px] sm:text-[16px] font-semibold">Cómo funciona tu pase</h2>
            <ol className="space-y-3 text-[13px] sm:text-[14px] text-[var(--ink-2)]">
              {[
                "Al comprar, tu pase se emite a tu clave pública.",
                "El día del evento, firmás un challenge con tu privada (queda en tu dispositivo).",
                "El validador escanea el QR; la entrada se transfiere de vuelta al organizador.",
                "No puede usarse dos veces — la propiedad ya cambió on-chain.",
              ].map((t, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span
                    className="flex-shrink-0 w-6 h-6 rounded-full grid place-items-center text-[12px] font-semibold"
                    style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
                  >
                    {i + 1}
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <aside className="lg:col-span-5 space-y-4 sm:space-y-5 rise rise-2">
          <div className="flex justify-center pt-2">
            <PaseMockup
              name={event.name}
              venue={event.venue}
              date={`${date.toLocaleDateString("es-AR", { day: "2-digit", month: "short" }).toUpperCase().replace(".", "")} · ${date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`}
              holder="Tu nombre"
            />
          </div>

          <div className="card p-5 sm:p-6 space-y-1">
            <div className="flex items-baseline justify-between mb-4">
              <p className="text-[13px] text-[var(--muted)]">Precio del pase</p>
              <p className="text-[26px] sm:text-[32px] font-semibold leading-none tracking-[-0.02em]">
                ${event.price.toFixed(2)}
              </p>
            </div>
            <button
              disabled
              className="btn btn-primary w-full btn-lg cursor-not-allowed opacity-60"
              title="Disponible en próxima iteración"
            >
              Comprar pase
            </button>
            <p className="text-[12px] text-[var(--muted)] text-center mt-2">
              Disponible en próxima iteración
            </p>
          </div>

          <div className="card p-5 sm:p-6 space-y-3">
            <p className="text-[13px] font-semibold text-[var(--muted)] uppercase tracking-wider">
              On-chain
            </p>
            <dl className="space-y-2.5 text-[13px]">
              <Row k="Entradas" v={`${event.ticketCount} unidades`} />
              <Row k="Estado" v={event.status} mono />
              {event.ncTBatchRef ? (
                <Row k="Batch" v={event.ncTBatchRef} mono break />
              ) : (
                <Row k="Batch" v="pendiente" mono />
              )}
              <Row k="Curva" v="secp256r1" mono />
              <Row k="Firma" v="ECDSA / IEEE-P1363" mono />
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  mono,
  span2,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
  span2?: boolean;
}) {
  return (
    <div className={"card p-3 sm:p-4 " + (span2 ? "col-span-2 sm:col-span-1" : "")}>
      <p className="text-[11px] sm:text-[12px] font-semibold text-[var(--muted)] uppercase tracking-wider">{label}</p>
      <p className={"text-[18px] sm:text-[24px] font-semibold leading-tight mt-1 sm:mt-1.5 " + (mono ? "mono" : "")}>
        {value}
      </p>
      {hint && <p className="text-[11px] sm:text-[12px] text-[var(--muted)] mt-0.5">{hint}</p>}
    </div>
  );
}

function Row({ k, v, mono, break: br }: { k: string; v: string; mono?: boolean; break?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[var(--muted)]">{k}</dt>
      <dd
        className={
          "text-right text-[var(--ink)] " +
          (mono ? "mono " : "") +
          (br ? "text-[11px] break-all max-w-[60%]" : "")
        }
      >
        {v}
      </dd>
    </div>
  );
}
