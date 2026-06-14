import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET() {
  const events = await prisma.event.findMany({
    where: { status: { in: ["PUBLISHED", "EMITTED"] } },
    orderBy: { datetime: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      datetime: true,
      venue: true,
      imageUrl: true,
      price: true,
      ticketCount: true,
      status: true,
    },
  });
  return NextResponse.json({ events });
}

const Body = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  datetime: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid_date"),
  venue: z.string().min(1).max(200),
  imageUrl: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  price: z.number().nonnegative(),
  ticketCount: z.number().int().positive().max(100_000),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session.userId || session.role !== "ORGANIZER") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const event = await prisma.event.create({
    data: {
      organizerId: session.userId,
      name: data.name,
      description: data.description,
      datetime: new Date(data.datetime),
      venue: data.venue,
      imageUrl: data.imageUrl,
      price: data.price,
      ticketCount: data.ticketCount,
      status: "DRAFT",
    },
  });
  return NextResponse.json({ event });
}
