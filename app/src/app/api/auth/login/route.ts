import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

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
    encryptedPrivateKey: user.encryptedPrivateKey,
    kdfSalt: user.kdfSalt,
    kdfIv: user.kdfIv,
  });
}
