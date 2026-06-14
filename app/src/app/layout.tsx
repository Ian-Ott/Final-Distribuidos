import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { HeaderActions } from "@/components/header-actions";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Entradas BC",
  description: "Gestión y validación de entradas en blockchain",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const user = session.userId
    ? { email: session.email ?? "", role: (session.role ?? "ATTENDEE") as "ATTENDEE" | "ORGANIZER" }
    : null;

  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100">
        <header className="border-b border-black/10 dark:border-white/10 bg-white dark:bg-zinc-950">
          <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
            <Link href="/" className="font-semibold text-base tracking-tight">
              Entradas<span className="text-zinc-400">BC</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/events" className="hover:underline">Eventos</Link>
              {user?.role === "ORGANIZER" && (
                <Link href="/dashboard" className="hover:underline">Dashboard</Link>
              )}
              <HeaderActions user={user} />
            </nav>
          </div>
        </header>
        <main className="flex-1 flex flex-col">{children}</main>
      </body>
    </html>
  );
}
