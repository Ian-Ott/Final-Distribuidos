"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewEventPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    description: "",
    datetime: "",
    venue: "",
    imageUrl: "",
    price: "0",
    ticketCount: "100",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          datetime: new Date(form.datetime).toISOString(),
          venue: form.venue,
          imageUrl: form.imageUrl || undefined,
          price: Number(form.price),
          ticketCount: Number(form.ticketCount),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "create_failed");
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown_error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl w-full px-4 sm:px-6 py-10 sm:py-14">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-[13px] sm:text-[14px] text-[var(--muted)] hover:text-[var(--ink)] transition-colors mb-5 sm:mb-6"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Volver al panel
      </Link>

      <header className="mb-6 sm:mb-8 space-y-2">
        <p className="eyebrow">Crear evento</p>
        <h1 className="text-[30px] sm:text-[40px] lg:text-[44px] leading-[1.05] tracking-[-0.025em] font-semibold">
          Nuevo evento
        </h1>
        <p className="text-[14px] sm:text-[15px] text-[var(--muted)] max-w-xl">
          Cargá los datos básicos. Después firmás la emisión con tu clave para mintar el lote.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="card p-5 sm:p-8 space-y-5 sm:space-y-6">
        <Field label="Nombre del evento">
          <input
            required
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className="input"
            placeholder="Ej. Festival Distribuido 2026"
          />
        </Field>

        <Field label="Descripción">
          <textarea
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            rows={3}
            className="textarea"
            placeholder="Lo que el asistente debe saber sobre el evento."
          />
        </Field>

        <div className="grid sm:grid-cols-2 gap-5">
          <Field label="Fecha y hora">
            <input
              type="datetime-local"
              required
              value={form.datetime}
              onChange={(e) => update("datetime", e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Lugar">
            <input
              required
              value={form.venue}
              onChange={(e) => update("venue", e.target.value)}
              className="input"
              placeholder="Auditorio, sala, dirección…"
            />
          </Field>
        </div>

        <Field label="Imagen (URL opcional)">
          <input
            value={form.imageUrl}
            onChange={(e) => update("imageUrl", e.target.value)}
            className="input"
            placeholder="https://…"
          />
        </Field>

        <div className="grid sm:grid-cols-2 gap-5">
          <Field label="Precio ($AR)">
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={form.price}
              onChange={(e) => update("price", e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Cantidad de entradas">
            <input
              type="number"
              min="1"
              required
              value={form.ticketCount}
              onChange={(e) => update("ticketCount", e.target.value)}
              className="input"
            />
          </Field>
        </div>

        <div
          className="rounded-[var(--radius-sm)] px-4 py-3 text-[13px] flex items-start gap-3"
          style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="flex-shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 8v5M12 16.5v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span>
            La cantidad de entradas se materializa al emitir. Una vez emitido, el lote es inmutable —
            la firma cubre el conjunto completo.
          </span>
        </div>

        {error && (
          <div className="text-[13px] text-[var(--danger)] bg-[var(--danger-soft)] rounded-[var(--radius-sm)] px-3 py-2.5">
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-3 sm:pt-2 border-t border-[var(--line)]">
          <button type="button" onClick={() => router.back()} className="btn btn-secondary w-full sm:w-auto">
            Cancelar
          </button>
          <button type="submit" disabled={loading} className="btn btn-primary w-full sm:w-auto">
            {loading && <span className="spinner" />}
            {loading ? "Creando…" : "Crear evento"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
