import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  publicKey: z.string().min(1),
  encryptedPrivateKey: z.string().min(1),
  kdfSalt: z.string().min(1),
  kdfIv: z.string().min(1),
  role: z.enum(["ORGANIZER", "ATTENDEE"]).default("ATTENDEE"),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }
  const { email, password, publicKey, encryptedPrivateKey, kdfSalt, kdfIv, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ error: "email_taken" }, { status: 409 });

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: { email, passwordHash, publicKey, encryptedPrivateKey, kdfSalt, kdfIv, role },
  });

  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  session.publicKey = user.publicKey;
  session.role = user.role as "ORGANIZER" | "ATTENDEE";
  await session.save();

  return NextResponse.json({
    id: user.id,
    email: user.email,
    publicKey: user.publicKey,
    role: user.role,
  });
}
