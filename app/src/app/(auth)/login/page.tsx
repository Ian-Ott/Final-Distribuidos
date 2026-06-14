"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { unlockPrivateKey } from "@/lib/crypto/client";
import { setUnlockedKey } from "@/lib/identity-store";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "login_failed");
      }
      const data = await res.json();
      const key = await unlockPrivateKey(password, data.encryptedPrivateKey, data.kdfSalt, data.kdfIv);
      setUnlockedKey(key);
      router.push(data.role === "ORGANIZER" ? "/dashboard" : "/events");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown_error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded-2xl p-6 shadow-sm">
      <h1 className="text-xl font-semibold">Iniciar sesión</h1>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-black/10 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Contraseña</span>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-black/10 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-black text-white dark:bg-white dark:text-black py-2 text-sm font-medium disabled:opacity-60"
      >
        {loading ? "Ingresando…" : "Ingresar"}
      </button>

      <p className="text-sm text-zinc-600 dark:text-zinc-400 text-center">
        ¿No tenés cuenta? <Link href="/register" className="underline">Crear cuenta</Link>
      </p>
    </form>
  );
}
