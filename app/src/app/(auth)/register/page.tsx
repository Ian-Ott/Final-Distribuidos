"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { generateIdentity, unlockPrivateKey } from "@/lib/crypto/client";
import { setUnlockedKey } from "@/lib/identity-store";

type Stage = "idle" | "generating" | "encrypting" | "submitting" | "unlocking";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ATTENDEE" | "ORGANIZER">("ATTENDEE");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      setStage("generating");
      await new Promise((r) => setTimeout(r, 150));
      setStage("encrypting");
      const identity = await generateIdentity(password);
      setStage("submitting");
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
      setStage("unlocking");
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
      setStage("idle");
    }
  }

  const stageCopy: Record<Stage, string> = {
    idle: "Crear cuenta",
    generating: "Generando claves…",
    encrypting: "Cifrando…",
    submitting: "Registrando…",
    unlocking: "Desbloqueando…",
  };

  return (
    <div className="rise space-y-6 sm:space-y-8">
      <header className="text-center space-y-2 sm:space-y-3">
        <h1 className="text-[28px] sm:text-[36px] leading-[1.1] tracking-[-0.025em] font-semibold">
          Crear tu cuenta
        </h1>
        <p className="text-[14px] sm:text-[15px] text-[var(--muted)]">
          Tu par de claves se genera en tu navegador. No hay recuperación de password.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="card p-6 sm:p-8 space-y-5">
        <fieldset className="space-y-2.5">
          <legend className="field-label">Tipo de cuenta</legend>
          <div className="grid grid-cols-2 gap-2.5">
            {(["ATTENDEE", "ORGANIZER"] as const).map((r) => {
              const active = role === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className="text-left p-4 rounded-[var(--radius-sm)] transition-all"
                  style={{
                    border: active ? "1.5px solid var(--brand)" : "1.5px solid var(--line)",
                    background: active ? "var(--brand-soft)" : "transparent",
                  }}
                >
                  <p className="font-semibold text-[15px]" style={{ color: active ? "var(--brand)" : "var(--ink)" }}>
                    {r === "ATTENDEE" ? "Asistente" : "Organizador"}
                  </p>
                  <p className="text-[12px] text-[var(--muted)] mt-1 leading-snug">
                    {r === "ATTENDEE" ? "Comprás y portás pases" : "Creás eventos y emitís"}
                  </p>
                </button>
              );
            })}
          </div>
        </fieldset>

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
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
            placeholder="al menos 6 caracteres"
            autoComplete="new-password"
          />
          <span className="block text-[12px] text-[var(--muted)] mt-1.5">
            Esta password cifra tu clave privada. Si la olvidás, no hay recuperación.
          </span>
        </label>

        {error && (
          <div className="text-[13px] text-[var(--danger)] bg-[var(--danger-soft)] rounded-[var(--radius-sm)] px-3 py-2.5">
            {error}
          </div>
        )}

        <button type="submit" disabled={loading} className="btn btn-primary w-full btn-lg">
          {loading && <span className="spinner" />}
          {stageCopy[stage]}
        </button>
      </form>

      <p className="text-center text-[14px] text-[var(--muted)]">
        ¿Ya tenés cuenta?{" "}
        <Link href="/login" className="text-[var(--brand)] font-medium hover:underline">
          Ingresar
        </Link>
      </p>
    </div>
  );
}
