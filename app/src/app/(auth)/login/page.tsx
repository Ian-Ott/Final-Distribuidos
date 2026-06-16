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
  const [stage, setStage] = useState<"idle" | "auth" | "unlocking">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      setStage("auth");
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
      setStage("unlocking");
      const key = await unlockPrivateKey(password, data.encryptedPrivateKey, data.kdfSalt, data.kdfIv);
      setUnlockedKey(key);
      router.push(data.role === "ORGANIZER" ? "/dashboard" : "/events");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown_error");
    } finally {
      setLoading(false);
      setStage("idle");
    }
  }

  return (
    <div className="rise space-y-6 sm:space-y-8">
      <header className="text-center space-y-2 sm:space-y-3">
        <h1 className="text-[28px] sm:text-[36px] leading-[1.1] tracking-[-0.025em] font-semibold">
          Bienvenido de vuelta
        </h1>
        <p className="text-[14px] sm:text-[15px] text-[var(--muted)]">
          Ingresá con tu email y password.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="card p-6 sm:p-8 space-y-5">
        <label className="field">
          <span className="field-label">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
            placeholder="vos@dominio.com"
            autoComplete="email"
          />
        </label>

        <label className="field">
          <span className="field-label">Contraseña</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </label>

        {error && (
          <div className="text-[13px] text-[var(--danger)] bg-[var(--danger-soft)] rounded-[var(--radius-sm)] px-3 py-2.5">
            {error}
          </div>
        )}

        <button type="submit" disabled={loading} className="btn btn-primary w-full btn-lg">
          {loading && <span className="spinner" />}
          {stage === "auth" && "Verificando…"}
          {stage === "unlocking" && "Desbloqueando…"}
          {stage === "idle" && "Ingresar"}
        </button>
      </form>

      <p className="text-center text-[14px] text-[var(--muted)]">
        ¿No tenés cuenta?{" "}
        <Link href="/register" className="text-[var(--brand)] font-medium hover:underline">
          Crear cuenta
        </Link>
      </p>
    </div>
  );
}
