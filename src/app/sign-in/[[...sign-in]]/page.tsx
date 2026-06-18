import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="relative min-h-screen bg-[oklch(0.145_0.05_258)] flex flex-col items-center justify-center px-4 py-12 overflow-hidden">

      {/* Aurora de color — igual que el hero */}
      <div
        className="pointer-events-none absolute inset-[-25%]"
        style={{
          background: [
            "radial-gradient(ellipse 58% 60% at 8% 48%,  oklch(0.55 0.27 258 / 0.42) 0%, transparent 60%)",
            "radial-gradient(ellipse 50% 55% at 92% 10%, oklch(0.75 0.15 72 / 0.22) 0%, transparent 56%)",
            "radial-gradient(ellipse 46% 56% at 72% 85%, oklch(0.55 0.25 290 / 0.36) 0%, transparent 60%)",
            "radial-gradient(ellipse 42% 46% at 32% 82%, oklch(0.62 0.17 200 / 0.22) 0%, transparent 60%)",
          ].join(","),
        }}
      />

      {/* Grilla de puntos — igual que el hero */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, oklch(1 0 0 / 0.07) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage:
            "radial-gradient(ellipse 85% 85% at 50% 50%, black 0%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 85% 85% at 50% 50%, black 0%, transparent 80%)",
        }}
      />

      {/* Logo */}
      <div className="relative flex flex-col items-center mb-8 z-10">
        <div className="w-16 h-16 bg-blue-500 rounded-2xl grid place-items-center text-3xl shadow-2xl shadow-blue-500/40 mb-5 ring-1 ring-blue-400/30">
          ⚡
        </div>
        <span className="font-extrabold text-2xl text-white tracking-tight">
          Conta<span className="text-blue-400">Flow</span>
        </span>
        <p className="mt-2 text-sm text-zinc-400">
          Sistema contable profesional venezolano
        </p>
      </div>

      {/* Formulario Clerk */}
      <div className="relative z-10">
        <SignIn />
      </div>

      {/* Footer */}
      <p className="relative mt-8 z-10 flex items-center gap-2 text-xs text-zinc-600">
        <svg
          viewBox="0 0 24 24"
          className="w-3.5 h-3.5 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        Datos protegidos con cifrado SSL · Homologado SENIAT PA-121
      </p>
    </div>
  );
}
