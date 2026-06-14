"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { generateIdentity, unlockPrivateKey } from "@/lib/crypto/client";
import { setUnlockedKey } from "@/lib/identity-store";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ATTENDEE" | "ORGANIZER">("ATTENDEE");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const identity = await generateIdentity(password);
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          publicKey: identity.publicKeyB64,
          encryptedPrivateKey: identity.encryptedPrivateKeyB64,
          kdfSalt: identity.kdfSaltB64,
          kdfIv: identity.kdfIvB64,
          role,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "register_failed");
      }
      const key = await unlockPrivateKey(
        password,
        identity.encryptedPrivateKeyB64,
        identity.kdfSaltB64,
        identity.kdfIvB64,
      );
      setUnlockedKey(key);
      router.push(role === "ORGANIZER" ? "/dashboard" : "/events");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown_error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded-2xl p-6 shadow-sm">
      <h1 className="text-xl font-semibold">Crear cuenta</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Tu par de claves ECDSA se genera en tu navegador. La clave privada se cifra con tu password antes de viajar al servidor.
      </p>

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
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-black/10 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
        />
      </label>

      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Rol</legend>
        <div className="flex gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={role === "ATTENDEE"}
              onChange={() => setRole("ATTENDEE")}
            />
            Asistente
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={role === "ORGANIZER"}
              onChange={() => setRole("ORGANIZER")}
            />
            Organizador
          </label>
        </div>
      </fieldset>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-black text-white dark:bg-white dark:text-black py-2 text-sm font-medium disabled:opacity-60"
      >
        {loading ? "Creando…" : "Crear cuenta"}
      </button>

      <p className="text-sm text-zinc-600 dark:text-zinc-400 text-center">
        ¿Ya tenés cuenta? <Link href="/login" className="underline">Iniciar sesión</Link>
      </p>
    </form>
  );
}
