import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function EventDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) notFound();

  return (
    <div className="mx-auto max-w-3xl w-full px-4 py-10 space-y-6">
      <p className="text-xs uppercase tracking-wide text-zinc-500">
        {new Date(event.datetime).toLocaleString()}
      </p>
      <h1 className="text-3xl font-semibold">{event.name}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">{event.venue}</p>

      {event.description && (
        <p className="text-base leading-relaxed whitespace-pre-wrap">{event.description}</p>
      )}

      <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 bg-white dark:bg-zinc-950 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-zinc-500">Precio</span>
          <span>${event.price.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Entradas emitidas</span>
          <span>{event.ticketCount}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Estado</span>
          <span>{event.status}</span>
        </div>
        {event.ncTBatchRef && (
          <div className="flex justify-between">
            <span className="text-zinc-500">Batch BC</span>
            <span className="font-mono text-xs">{event.ncTBatchRef}</span>
          </div>
        )}
      </div>

      <p className="text-sm text-zinc-500 italic">
        La compra de entradas se habilita en la próxima iteración.
      </p>
    </div>
  );
}
