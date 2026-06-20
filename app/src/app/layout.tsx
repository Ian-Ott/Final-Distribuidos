import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { HeaderActions } from "@/components/header-actions";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Pase · Entradas en blockchain",
  description: "Cada entrada, un activo único. Una sola vez.",
};

const themeBootstrap = `
(function(){try{
  var t=localStorage.getItem('pase-theme');
  if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
  document.documentElement.setAttribute('data-theme',t);
}catch(e){}
})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const user = session.userId
    ? { email: session.email ?? "", role: (session.role ?? "ATTENDEE") as "ATTENDEE" | "ORGANIZER" }
    : null;

  return (
    <html
      lang="es"
      className={`${dmSans.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-30 backdrop-blur-xl bg-[color-mix(in_srgb,var(--bg)_80%,transparent)] border-b border-[var(--line)]">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2">
            <Link href="/" className="flex items-center gap-2 group flex-shrink-0">
              <span
                aria-hidden
                className="inline-block w-7 h-7 rounded-[8px] grid place-items-center"
                style={{
                  background:
                    "linear-gradient(135deg, #0a3aff 0%, #0066ff 60%, #4d8bff 100%)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M6 4h8a4 4 0 0 1 0 8h-4v8H6V4Z" fill="#fff" />
                </svg>
              </span>
              <span className="font-semibold tracking-tight text-[16px] sm:text-[17px]">Pase</span>
            </Link>

            <nav className="flex items-center gap-0.5 sm:gap-1 text-[13px] sm:text-[14px]">
              <Link
                href="/events"
                className="inline-flex items-center h-8 sm:h-9 px-2.5 sm:px-3 rounded-full text-[var(--ink-2)] hover:bg-[var(--surface)] transition-colors"
              >
                Eventos
              </Link>
              {user?.role === "ORGANIZER" && (
                <Link
                  href="/dashboard"
                  className="inline-flex items-center h-8 sm:h-9 px-2.5 sm:px-3 rounded-full text-[var(--ink-2)] hover:bg-[var(--surface)] transition-colors"
                >
                  Panel
                </Link>
              )}
              {user && (
                <Link
                  href="/my-tickets"
                  className="inline-flex items-center h-8 sm:h-9 px-2.5 sm:px-3 rounded-full text-[var(--ink-2)] hover:bg-[var(--surface)] transition-colors"
                >
                  Mis pases
                </Link>
              )}
              <ThemeToggle />
              <HeaderActions user={user} />
            </nav>
          </div>
        </header>

        <main className="flex-1 flex flex-col">{children}</main>

        <footer className="border-t border-[var(--line)] mt-16 sm:mt-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-12 grid sm:grid-cols-2 gap-8 items-start">
            <div>
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="inline-block w-6 h-6 rounded-[7px]"
                  style={{
                    background: "linear-gradient(135deg, #0a3aff, #4d8bff)",
                  }}
                />
                <span className="font-semibold">Pase</span>
              </div>
              <p className="text-[14px] text-[var(--muted)] mt-3 max-w-sm">
                Capa web del TP de Sistemas Distribuidos. Entradas como activos únicos en blockchain.
              </p>
            </div>
            <div className="flex flex-wrap gap-x-12 gap-y-6 justify-start sm:justify-end text-[13px]">
              <div>
                <p className="font-semibold text-[var(--ink)] mb-2">Producto</p>
                <ul className="space-y-1.5 text-[var(--muted)]">
                  <li><Link href="/events" className="hover:text-[var(--ink)] transition-colors">Eventos</Link></li>
                  <li><Link href="/register" className="hover:text-[var(--ink)] transition-colors">Crear cuenta</Link></li>
                  <li><Link href="/login" className="hover:text-[var(--ink)] transition-colors">Ingresar</Link></li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-[var(--ink)] mb-2">Stack</p>
                <ul className="space-y-1.5 text-[var(--muted)] mono">
                  <li>Next.js 16</li>
                  <li>ECDSA P-256</li>
                  <li>Prisma 7 · Postgres</li>
                </ul>
              </div>
            </div>
          </div>
          <div className="border-t border-[var(--line)]">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 h-12 flex items-center justify-between text-[11px] sm:text-[12px] text-[var(--muted)]">
              <span>SDyPP · 2026</span>
              <span>© Pase</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
