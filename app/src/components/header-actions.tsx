"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearUnlockedKey } from "@/lib/identity-store";

export function HeaderActions({ user }: { user: { email: string; role: string } | null }) {
  const router = useRouter();

  if (!user) {
    return (
      <>
        <Link
          href="/login"
          className="hidden sm:inline-flex items-center h-9 px-3 rounded-full text-[var(--ink-2)] hover:bg-[var(--surface)] transition-colors text-[14px]"
        >
          Ingresar
        </Link>
        <Link href="/register" className="btn btn-primary btn-sm text-[12px] sm:text-[13px] px-3 sm:px-4">
          <span className="sm:hidden">Entrar</span>
          <span className="hidden sm:inline">Crear cuenta</span>
        </Link>
      </>
    );
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    clearUnlockedKey();
    router.push("/");
    router.refresh();
  }

  const initial = user.email.charAt(0).toUpperCase();

  return (
    <button
      onClick={handleLogout}
      className="btn btn-secondary btn-sm text-[12px] sm:text-[13px] px-2.5 sm:px-3"
      title={user.email}
    >
      <span
        aria-hidden
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold text-white"
        style={{ background: "var(--brand)" }}
      >
        {initial}
      </span>
      Salir
    </button>
  );
}
