import Link from "next/link";
import { prisma } from "@/lib/db";
import { PaseMockup } from "@/components/pase-mockup";

export const dynamic = "force-dynamic";

export default async function Home() {
  const upcoming = await prisma.event.findMany({
    where: { status: { in: ["PUBLISHED", "EMITTED"] } },
    orderBy: { datetime: "asc" },
    take: 3,
  });

  return (
    <div>
      {/* HERO */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-12 sm:pt-20 lg:pt-28 pb-16 sm:pb-20 lg:pb-28">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          <div className="lg:col-span-7 space-y-5 sm:space-y-7">
            <span className="rise rise-1 badge is-brand">On-chain · MVP</span>

            <h1 className="rise rise-2 text-[36px] sm:text-[48px] lg:text-[64px] leading-[1.04] tracking-[-0.025em] font-semibold">
              Entradas que <span className="text-[var(--brand)]">no se duplican</span>.
            </h1>

            <p className="rise rise-3 max-w-xl text-[15px] sm:text-[17px] leading-relaxed text-[var(--muted)]">
              Cada entrada es un activo único en blockchain. La firmás en tu navegador con
              tu clave privada, y al validarla en la puerta vuelve al organizador —
              imposible de usar dos veces.
            </p>

            <div className="rise rise-4 flex flex-col sm:flex-row gap-3">
              <Link href="/events" className="btn btn-primary btn-lg w-full sm:w-auto">
                Ver eventos
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <Link href="/register" className="btn btn-secondary btn-lg w-full sm:w-auto">
                Soy organizador
              </Link>
            </div>

            <div className="rise rise-5 flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-[13px] text-[var(--muted)]">
              <span className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="m5 12 5 5L20 7" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Sin custodia de claves
              </span>
              <span className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="m5 12 5 5L20 7" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                ECDSA P-256
              </span>
            </div>
          </div>

          <div className="lg:col-span-5 flex justify-center lg:justify-end rise rise-3">
            <div className="relative w-full max-w-[380px]">
              <div
                aria-hidden
                className="absolute -inset-8 sm:-inset-10 -z-10 rounded-full opacity-40"
                style={{
                  background: "radial-gradient(circle, rgba(0,102,255,0.35), transparent 60%)",
                  filter: "blur(40px)",
                }}
              />
              <PaseMockup />
            </div>
          </div>
        </div>
      </section>

      {/* TRUST STRIP */}
      <section className="border-y border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10 grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8">
          {[
            { k: "Curva", v: "ECDSA / P-256" },
            { k: "Hash", v: "SHA-256" },
            { k: "Cifrado", v: "AES-GCM 256" },
            { k: "Derivación", v: "PBKDF2 / 250k" },
          ].map((s) => (
            <div key={s.k}>
              <p className="text-[11px] sm:text-[12px] font-semibold text-[var(--muted)] uppercase tracking-wider">{s.k}</p>
              <p className="mono text-[13px] sm:text-[15px] mt-1 text-[var(--ink)]">{s.v}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HOW */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-24 lg:py-32">
        <div className="max-w-2xl mb-10 sm:mb-14">
          <p className="eyebrow mb-3">Cómo funciona</p>
          <h2 className="text-[30px] sm:text-[40px] lg:text-[52px] leading-[1.05] tracking-[-0.025em] font-semibold">
            Tres pasos. Sin secretos en el servidor.
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
          {[
            {
              n: "01",
              title: "Generá tu identidad",
              body: "Tu navegador crea un par ECDSA con WebCrypto. La privada se cifra con tu password y nunca viaja en claro.",
              icon: (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M5 20c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              ),
            },
            {
              n: "02",
              title: "Creá y emití",
              body: "Cargás el evento, firmás el lote con tu clave y la app dispara el mint contra el coordinador de la cadena.",
              icon: (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              ),
            },
            {
              n: "03",
              title: "Validá en puerta",
              body: "El asistente firma su pase, el validador escanea, y la entrada se transfiere de vuelta al organizador.",
              icon: (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="m5 12 5 5L20 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ),
            },
          ].map((s) => (
            <article
              key={s.n}
              className="card p-6 sm:p-7 hover:-translate-y-0.5 hover:shadow-[var(--shadow)] transition-all duration-300"
            >
              <div className="flex items-center justify-between mb-6">
                <span
                  className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-[var(--brand)]"
                  style={{ background: "var(--brand-soft)" }}
                >
                  {s.icon}
                </span>
                <span className="mono text-[12px] text-[var(--muted)]">{s.n}</span>
              </div>
              <h3 className="text-[20px] font-semibold mb-2">{s.title}</h3>
              <p className="text-[14.5px] text-[var(--muted)] leading-relaxed">{s.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* FEATURES SPLIT */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-16 sm:pb-24 lg:pb-32">
        <div className="card overflow-hidden">
          <div className="grid lg:grid-cols-2 items-stretch">
            <div
              className="p-8 sm:p-12 lg:p-14 flex items-center justify-center min-h-[280px] sm:min-h-[360px]"
              style={{
                background:
                  "radial-gradient(120% 80% at 0% 0%, rgba(0,102,255,0.06), transparent 60%), var(--surface)",
              }}
            >
              <PaseMockup />
            </div>
            <div className="p-8 sm:p-12 lg:p-14 flex flex-col justify-center">
              <p className="eyebrow mb-3">Validar = transferir</p>
              <h3 className="text-[26px] sm:text-[34px] lg:text-[40px] leading-[1.05] tracking-[-0.025em] font-semibold mb-4 sm:mb-5">
                Una sola vez. Por diseño.
              </h3>
              <p className="text-[15px] sm:text-[16px] text-[var(--muted)] leading-relaxed mb-6">
                Cuando se escanea el QR en la puerta, la entrada se transfiere de vuelta al
                organizador. La unicidad surge de la propiedad on-chain — no hay un flag
                "usada" que se pueda corromper.
              </p>
              <ul className="space-y-3 text-[14px] sm:text-[15px]">
                {[
                  "Firmas IEEE-P1363 (raw 64B) — compatibles Node ↔ WebCrypto",
                  "Olvido de password = pérdida de clave (intencional)",
                  "Mint en lote — una tx por evento, no N transacciones",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-3 text-[var(--ink-2)]">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="flex-shrink-0 mt-0.5">
                      <circle cx="12" cy="12" r="10" fill="var(--brand-soft)" />
                      <path d="m7.5 12 3 3 6-6" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* UPCOMING */}
      {upcoming.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-16 sm:pb-24 lg:pb-32">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-6 sm:mb-8">
            <div>
              <p className="eyebrow mb-2 sm:mb-3">Cartelera</p>
              <h2 className="text-[26px] sm:text-[34px] lg:text-[40px] leading-[1.05] tracking-[-0.025em] font-semibold">
                Próximos eventos
              </h2>
            </div>
            <Link href="/events" className="btn btn-ghost text-[var(--brand)] text-[13px] sm:text-[14px] h-9 px-3">
              Ver todos
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {upcoming.map((e) => {
              const d = new Date(e.datetime);
              return (
                <Link
                  key={e.id}
                  href={`/events/${e.id}`}
                  className="card p-6 hover:-translate-y-0.5 hover:shadow-[var(--shadow)] transition-all duration-300"
                >
                  <div className="flex items-center justify-between mb-4">
                    <span className="badge is-brand">
                      {d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
                    </span>
                    <span className="mono text-[12px] text-[var(--muted)]">
                      {d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <h3 className="text-[20px] font-semibold leading-tight mb-1.5">{e.name}</h3>
                  <p className="text-[14px] text-[var(--muted)]">{e.venue}</p>
                  <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--line)]">
                    <span className="text-[15px] font-semibold">${e.price.toFixed(2)}</span>
                    <span className="text-[13px] text-[var(--brand)] font-medium">Ver detalle →</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-20 sm:pb-32">
        <div
          className="rounded-[24px] sm:rounded-[32px] p-8 sm:p-12 lg:p-16 text-center text-white relative overflow-hidden"
          style={{
            background:
              "radial-gradient(80% 100% at 50% 0%, #4d8bff 0%, #0066ff 40%, #0a3aff 100%)",
          }}
        >
          <div
            aria-hidden
            className="absolute inset-0 opacity-20"
            style={{
              background:
                "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.5), transparent 30%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.3), transparent 40%)",
            }}
          />
          <div className="relative">
            <h2 className="text-[28px] sm:text-[40px] lg:text-[56px] leading-[1.05] tracking-[-0.025em] font-semibold mb-3 sm:mb-4 max-w-2xl mx-auto">
              Tu próximo evento, sin reventa.
            </h2>
            <p className="text-[15px] sm:text-[17px] text-white/80 max-w-xl mx-auto mb-6 sm:mb-8">
              Creá tu cuenta como organizador en 30 segundos y emití tu primer lote.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/register"
                className="btn btn-lg w-full sm:w-auto"
                style={{ background: "#fff", color: "#0a3aff" }}
              >
                Crear cuenta gratis
              </Link>
              <Link
                href="/events"
                className="btn btn-lg w-full sm:w-auto"
                style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)" }}
              >
                Ver demo
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
