"use client";

import { useRef, useEffect, useState } from "react";

type Props = {
  name?: string;
  email?: string;
  publicKey?: string;
  role?: "ORGANIZER" | "ATTENDEE" | string;
  /** big = hero size; default = compact */
  size?: "default" | "big";
  /** auto-tilt subtly on mount so the holo is alive even without mouse */
  autoFloat?: boolean;
};

export function HoloCard({
  name = "Identidad",
  email = "pase://anon",
  publicKey,
  role = "ATTENDEE",
  size = "default",
  autoFloat = true,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const rx = (0.5 - y) * 18;
      const ry = (x - 0.5) * 22;
      el.style.setProperty("--rx", `${rx}deg`);
      el.style.setProperty("--ry", `${ry}deg`);
      el.style.setProperty("--mx", `${x * 100}%`);
      el.style.setProperty("--my", `${y * 100}%`);
    };
    const onLeave = () => {
      el.style.setProperty("--rx", `0deg`);
      el.style.setProperty("--ry", `0deg`);
      el.style.setProperty("--mx", `50%`);
      el.style.setProperty("--my", `30%`);
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerenter", () => setActive(true));
    el.addEventListener("pointerleave", () => {
      setActive(false);
      onLeave();
    });

    return () => {
      el.removeEventListener("pointermove", onMove);
    };
  }, []);

  const dims = size === "big" ? "w-[420px] h-[260px] sm:w-[480px] sm:h-[300px]" : "w-[340px] h-[214px]";
  const fp = publicKey
    ? `${publicKey.slice(0, 6)} ${publicKey.slice(6, 10)} ${publicKey.slice(10, 14)} ${publicKey.slice(-6)}`
    : "•••• •••• •••• ••••";

  return (
    <div
      className="relative"
      style={{
        perspective: "1400px",
        animation: autoFloat ? "holo-float 6s ease-in-out infinite" : undefined,
      }}
    >
      <style>{`
        @keyframes holo-float {
          0%,100% { transform: translateY(0) rotateX(2deg) rotateY(-3deg); }
          50%     { transform: translateY(-6px) rotateX(-1deg) rotateY(4deg); }
        }
      `}</style>

      <div
        ref={ref}
        className={`holo ${dims} relative rounded-[26px] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)] transition-transform duration-200 ease-out`}
        style={{
          transformStyle: "preserve-3d",
          transform: `rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg))`,
          willChange: "transform",
        }}
      >
        {/* edge sheen */}
        <div
          aria-hidden
          className="absolute inset-0 rounded-[26px] pointer-events-none"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 30%, rgba(255,255,255,0) 70%, rgba(0,0,0,0.25) 100%)",
            mixBlendMode: "overlay",
          }}
        />

        {/* content */}
        <div className="absolute inset-0 p-6 sm:p-7 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <p
                className="font-mono uppercase tracking-[0.18em] text-[10px] sm:text-[11px]"
                style={{ color: "rgba(255,255,255,0.78)" }}
              >
                Pase · Identidad
              </p>
              <p
                className="italic-display text-[24px] sm:text-[30px] leading-none mt-1"
                style={{ color: "#fff", textShadow: "0 1px 12px rgba(0,0,0,0.35)" }}
              >
                {name}
              </p>
            </div>
            <div
              className="font-mono uppercase tracking-[0.18em] text-[10px] sm:text-[11px] px-2 py-1 rounded-full"
              style={{
                border: "1px solid rgba(255,255,255,0.45)",
                color: "rgba(255,255,255,0.9)",
                backdropFilter: "blur(6px)",
              }}
            >
              {role === "ORGANIZER" ? "Organizador" : role === "ATTENDEE" ? "Asistente" : role}
            </div>
          </div>

          {/* chip */}
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className="w-12 h-9 rounded-[6px]"
              style={{
                background:
                  "linear-gradient(135deg, #d6b86a 0%, #8a6f30 40%, #f0d98b 65%, #6b4f1c 100%)",
                boxShadow:
                  "inset 0 0 0 1px rgba(0,0,0,0.3), inset 1px 1px 0 rgba(255,255,255,0.4)",
              }}
            />
            <div className="flex flex-col">
              <span
                className="font-mono uppercase tracking-[0.18em] text-[9px] sm:text-[10px]"
                style={{ color: "rgba(255,255,255,0.65)" }}
              >
                secp256r1 · pubkey
              </span>
              <span
                className="font-mono text-[12px] sm:text-[14px] tracking-[0.08em]"
                style={{ color: "#fff" }}
              >
                {fp}
              </span>
            </div>
          </div>

          <div className="flex items-end justify-between">
            <div>
              <p
                className="font-mono uppercase tracking-[0.18em] text-[9px] sm:text-[10px]"
                style={{ color: "rgba(255,255,255,0.6)" }}
              >
                Custodia
              </p>
              <p
                className="font-mono text-[12px] sm:text-[13px]"
                style={{ color: "rgba(255,255,255,0.92)" }}
              >
                {email}
              </p>
            </div>
            <Logo />
          </div>
        </div>

        {/* a thin diagonal scratchline that catches light */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none rounded-[26px]"
          style={{
            background:
              "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 6px)",
            mixBlendMode: "overlay",
            opacity: active ? 0.9 : 0.5,
            transition: "opacity 300ms",
          }}
        />
      </div>
    </div>
  );
}

function Logo() {
  return (
    <svg width="56" height="20" viewBox="0 0 120 40" aria-hidden>
      <text
        x="0"
        y="30"
        fontFamily="serif"
        fontStyle="italic"
        fontSize="32"
        fill="#fff"
        opacity="0.95"
      >
        Pase
      </text>
    </svg>
  );
}
