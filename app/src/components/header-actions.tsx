"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearUnlockedKey } from "@/lib/identity-store";

export function HeaderActions({ user }: { user: { email: string; role: string } | null }) {
  const router = useRouter();
  if (!user) {
    return (
      <>
        <Link href="/login" className="hover:underline">Ingresar</Link>
        <Link
          href="/register"
          className="rounded-md bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-sm font-medium"
        >
          Crear cuenta
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
  return (
    <>
      <span className="text-zinc-500 hidden sm:inline">{user.email}</span>
      <button onClick={handleLogout} className="hover:underline">Salir</button>
    </>
  );
}
