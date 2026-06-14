import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { EmitButton } from "./emit-button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  if (session.role !== "ORGANIZER") redirect("/events");

  const events = await prisma.event.findMany({
    where: { organizerId: session.userId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-5xl w-full px-4 py-10 space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Mis eventos</h1>
          <p className="text-sm text-zinc-500">Creá un evento y emití sus entradas a la blockchain.</p>
        </div>
        <Link
          href="/dashboard/events/new"
          className="rounded-md bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm font-medium"
        >
          Nuevo evento
        </Link>
      </header>

      {events.length === 0 ? (
        <p className="text-sm text-zinc-500 border border-dashed border-black/10 dark:border-white/10 rounded-xl p-8 text-center">
          Todavía no creaste eventos.
        </p>
      ) : (
        <ul className="space-y-3">
          {events.map((e) => (
            <li
              key={e.id}
              className="bg-white dark:bg-zinc-950 border border-black/10 dark:border-white/10 rounded-xl p-4 flex items-center justify-between gap-4"
            >
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  {new Date(e.datetime).toLocaleString()}
                </p>
                <h2 className="text-lg font-medium">{e.name}</h2>
                <p className="text-sm text-zinc-500">
                  {e.venue} · {e.ticketCount} entradas · ${e.price.toFixed(2)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={
                    "text-xs px-2 py-1 rounded-full " +
                    (e.status === "EMITTED"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300")
                  }
                >
                  {e.status}
                </span>
                {e.status !== "EMITTED" && <EmitButton eventId={e.id} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
