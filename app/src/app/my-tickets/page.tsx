import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getTicketsByOwner } from "@/lib/nct/client";
import { MyTicketsList } from "./my-tickets-list";

export const dynamic = "force-dynamic";

export default async function MyTicketsPage() {
  const session = await getSession();
  if (!session.userId || !session.publicKey) redirect("/login");

  const ownership = await getTicketsByOwner(session.publicKey);

  if (ownership.length === 0) {
    return (
      <div className="mx-auto max-w-4xl w-full px-4 sm:px-6 py-10 sm:py-14 space-y-8">
        <header className="space-y-2">
          <p className="eyebrow">Mis pases</p>
          <h1 className="text-[30px] sm:text-[40px] lg:text-[44px] leading-[1.05] tracking-[-0.025em] font-semibold">
            Todavía no tenés entradas
          </h1>
          <p className="text-[14px] sm:text-[15px] text-[var(--muted)] max-w-lg">
            Comprá una entrada en cualquier evento publicado y va a aparecer acá con su QR firmado.
          </p>
        </header>
      </div>
    );
  }

  const eventIds = [...new Set(ownership.map((o) => o.eventId))];
  const events = await prisma.event.findMany({
    where: { id: { in: eventIds } },
    select: { id: true, name: true, datetime: true, venue: true, imageUrl: true },
  });
  const eventById = new Map(events.map((e) => [e.id, e]));

  const tickets = ownership.map((o) => ({
    ticketId: o.ticketId,
    ticketNumber: o.ticketNumber,
    event: eventById.get(o.eventId),
  }));

  return (
    <div className="mx-auto max-w-4xl w-full px-4 sm:px-6 py-10 sm:py-14 space-y-8">
      <header className="space-y-2">
        <p className="eyebrow">Mis pases</p>
        <h1 className="text-[30px] sm:text-[40px] lg:text-[44px] leading-[1.05] tracking-[-0.025em] font-semibold">
          Tus entradas
        </h1>
        <p className="text-[14px] sm:text-[15px] text-[var(--muted)] max-w-lg">
          Mostrá el QR en la puerta. Se firma con tu clave privada y se renueva cada 30 segundos.
        </p>
      </header>

      <MyTicketsList tickets={tickets} publicKey={session.publicKey} />
    </div>
  );
}
