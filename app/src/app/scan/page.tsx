import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ScannerClient } from "./scanner-client";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  if (session.role !== "ORGANIZER") redirect("/events");

  return (
    <div className="mx-auto max-w-2xl w-full px-4 sm:px-6 py-8 sm:py-12 space-y-6">
      <header className="space-y-2">
        <p className="eyebrow">Validación en puerta</p>
        <h1 className="text-[28px] sm:text-[36px] leading-[1.05] tracking-[-0.025em] font-semibold">
          Escanear pase
        </h1>
        <p className="text-[14px] text-[var(--muted)] max-w-lg">
          Apuntá la cámara al QR del asistente. Al validarse, la entrada se transfiere de
          vuelta al organizador y no puede usarse de nuevo.
        </p>
      </header>

      <ScannerClient />
    </div>
  );
}
