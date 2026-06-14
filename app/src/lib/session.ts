import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";

export interface SessionData {
  userId?: string;
  email?: string;
  publicKey?: string;
  role?: "ORGANIZER" | "ATTENDEE";
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_PASSWORD ?? "",
  cookieName: "tx_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}
