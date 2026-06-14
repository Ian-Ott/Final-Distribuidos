"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
    <div className="mx-auto max-w-xl w-full px-4 py-10">
      <h1 className="text-2xl font-semibold mb-1">Nuevo evento</h1>
      <p className="text-sm text-zinc-500 mb-6">
        Tras crear el evento, podés emitir sus entradas a la blockchain firmando con tu clave.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4 bg-white dark:bg-zinc-950 border border-black/10 dark:border-white/10 rounded-2xl p-6">
        <Field label="Nombre">
          <input required value={form.name} onChange={(e) => update("name", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Descripción">
          <textarea value={form.description} onChange={(e) => update("description", e.target.value)} rows={3} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha y hora">
            <input
              type="datetime-local"
              required
              value={form.datetime}
              onChange={(e) => update("datetime", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Lugar">
            <input required value={form.venue} onChange={(e) => update("venue", e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="URL de imagen (opcional)">
          <input value={form.imageUrl} onChange={(e) => update("imageUrl", e.target.value)} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Precio">
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={form.price}
              onChange={(e) => update("price", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Cantidad de entradas">
            <input
              type="number"
              min="1"
              required
              value={form.ticketCount}
              onChange={(e) => update("ticketCount", e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm rounded-md border border-black/10 dark:border-white/10"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-sm rounded-md bg-black text-white dark:bg-white dark:text-black disabled:opacity-60"
          >
            {loading ? "Creando…" : "Crear evento"}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-black/10 dark:border-white/10 bg-transparent px-3 py-2 text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
