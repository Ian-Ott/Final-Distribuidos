import { BlockchainPanel } from "./blockchain-panel";

export const dynamic = "force-dynamic";

export default function PanelPage() {
  return (
    <div className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-10 sm:py-14 space-y-8 sm:space-y-10">
      <header className="space-y-2">
        <p className="eyebrow">Blockchain</p>
        <h1 className="text-[30px] sm:text-[40px] lg:text-[48px] leading-[1.05] tracking-[-0.025em] font-semibold">
          Panel de la cadena
        </h1>
        <p className="text-[14px] sm:text-[15px] text-[var(--muted)] max-w-lg">
          Estado en tiempo real de la blockchain, bloques minados y eventos del sistema.
        </p>
      </header>
      <BlockchainPanel />
    </div>
  );
}
