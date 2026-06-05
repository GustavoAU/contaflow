"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

interface Props {
  planName: string;
  displayPrice: string;
  toPlanKey: string; // e.g. "ANNUAL", "MONTHLY", "EARLY_ADOPTER"
}

export function AlreadySignedInPanel({ planName, displayPrice, toPlanKey }: Props) {
  const router = useRouter();

  useEffect(() => {
    toast.warning("Ya tienes una cuenta activa en ContaFlow", {
      description: "Puedes cambiar tu plan directamente desde tu cuenta.",
      duration: 7000,
    });
  }, []);

  function handleChangePlan() {
    router.push(`/settings/plan?change=${toPlanKey}`);
  }

  return (
    <>
      <Toaster richColors position="top-right" />

      <div className="flex w-full max-w-sm flex-col gap-4">
        {/* Banner info */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100">
              <svg
                className="h-4 w-4 text-amber-600"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-800">
                Ya tienes una cuenta activa
              </p>
              <p className="mt-0.5 text-xs text-amber-700">
                Estás registrado en ContaFlow. Para cambiar al{" "}
                <span className="font-semibold">{planName}</span> ({displayPrice}),
                puedes hacerlo desde tu cuenta — el cambio se hace efectivo el
                primer día del próximo mes.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2.5">
          <button
            onClick={handleChangePlan}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Cambiar al {planName}
          </button>

          <a
            href="/dashboard"
            className="flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
          >
            Ir al Dashboard
          </a>
        </div>

        <p className="text-center text-xs text-slate-400">
          El cambio se hace efectivo el 1° del próximo mes. Requiere pago USDT previo.
        </p>
      </div>
    </>
  );
}
