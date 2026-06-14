import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await prisma.event.findMany({
    where: { status: { in: ["PUBLISHED", "EMITTED"] } },
    orderBy: { datetime: "asc" },
  });

  return (
    <div className="mx-auto max-w-5xl w-full px-4 py-10 space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Eventos disponibles</h1>
          <p className="text-sm text-zinc-500">
            Entradas emitidas en blockchain. Hacé click para ver detalle.
          </p>
        </div>
      </header>

      {events.length === 0 ? (
        <p className="text-sm text-zinc-500 border border-dashed border-black/10 dark:border-white/10 rounded-xl p-8 text-center">
          Todavía no hay eventos publicados.
        </p>
      ) : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map((e) => (
            <li key={e.id}>
              <Link
                href={`/events/${e.id}`}
                className="block bg-white dark:bg-zinc-950 border border-black/10 dark:border-white/10 rounded-xl p-4 hover:shadow-sm transition"
              >
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  {new Date(e.datetime).toLocaleString()}
                </p>
                <h2 className="text-lg font-medium mt-1">{e.name}</h2>
                <p className="text-sm text-zinc-500">{e.venue}</p>
                <p className="mt-3 text-sm">
                  ${e.price.toFixed(2)} ·{" "}
                  <span className="text-zinc-500">{e.ticketCount} entradas</span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
