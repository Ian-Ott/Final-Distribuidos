type Props = {
  name?: string;
  venue?: string;
  date?: string;
  holder?: string;
  className?: string;
};

export function PaseMockup({
  name = "Festival Distribuido",
  venue = "Auditorio UTN — Buenos Aires",
  date = "14 OCT · 21:00",
  holder = "Tu nombre",
  className = "",
}: Props) {
  return (
    <div className={`pase-card w-full max-w-[380px] ${className}`} aria-hidden>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-white/70">
            Pase
          </p>
          <p className="text-[22px] font-semibold leading-tight mt-1.5 text-white">
            {name}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-white/70">
            On-chain
          </p>
          <span className="inline-flex items-center gap-1.5 mt-1.5 text-white/95 text-[12px] font-medium">
            <span
              className="inline-block w-2 h-2 rounded-full bg-emerald-300"
              style={{ boxShadow: "0 0 0 3px rgba(110, 231, 183, 0.25)" }}
            />
            Emitido
          </span>
        </div>
      </div>

      <div className="mt-9 grid grid-cols-2 gap-5">
        <div>
          <p className="text-[10.5px] font-semibold tracking-[0.14em] uppercase text-white/60">
            Cuando
          </p>
          <p className="text-white text-[15px] font-medium mt-1.5 font-mono">{date}</p>
        </div>
        <div>
          <p className="text-[10.5px] font-semibold tracking-[0.14em] uppercase text-white/60">
            Donde
          </p>
          <p className="text-white text-[14px] mt-1.5">{venue}</p>
        </div>
      </div>

      <div className="mt-6 pt-5 border-t border-white/15 flex items-end justify-between">
        <div>
          <p className="text-[10.5px] font-semibold tracking-[0.14em] uppercase text-white/60">
            Titular
          </p>
          <p className="text-white text-[14px] font-medium mt-1">{holder}</p>
        </div>
        <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden>
          <rect width="44" height="44" rx="6" fill="rgba(255,255,255,0.1)" />
          {/* tiny QR-ish pattern */}
          {[
            [4, 4], [10, 4], [16, 4], [22, 4], [28, 4],
            [4, 10], [16, 10], [22, 10], [34, 10],
            [4, 16], [10, 16], [28, 16],
            [10, 22], [22, 22], [34, 22],
            [4, 28], [16, 28], [28, 28], [34, 28],
            [4, 34], [10, 34], [22, 34], [28, 34], [34, 34],
          ].map(([x, y], i) => (
            <rect key={i} x={x} y={y} width="6" height="6" fill="#fff" />
          ))}
        </svg>
      </div>
    </div>
  );
}
