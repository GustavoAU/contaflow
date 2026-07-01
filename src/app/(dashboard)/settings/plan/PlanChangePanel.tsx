"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  requestPlanChangeAction,
  cancelPlanChangeAction,
} from "@/modules/billing/actions/plan-change.actions";

const PLAN_LABELS: Record<string, string> = {
  TRIAL: "Prueba gratuita",
  MONTHLY: "Plan Mensual",
  ANNUAL: "Plan Anual",
  EARLY_ADOPTER: "Plan Early Adopter",
};

// El precio real depende del perfil de la empresa (Individual vs Empresa) y se
// resuelve en el servidor; aquí solo mostramos la cadencia de facturación.
const PLAN_PRICES: Record<string, string> = {
  MONTHLY: "Facturación mensual",
  ANNUAL: "Facturación anual",
  EARLY_ADOPTER: "Early Adopter (año 1)",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-VE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)} USDT`;
}

interface Props {
  companyId: string;
  companyName: string;
  currentPlan: string;
  currentPeriodEnd: string;
  priceUsdCents: number;
  pendingChange: {
    id: string;
    toPlan: string;
    effectiveDate: string;
    newPriceUsdCents: number;
    status: string;
  } | null;
  preselectedPlan?: string; // viene del query param ?change=ANNUAL
}

export function PlanChangePanel({
  companyId,
  companyName,
  currentPlan,
  currentPeriodEnd,
  priceUsdCents,
  pendingChange,
  preselectedPlan,
}: Props) {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(
    preselectedPlan && preselectedPlan !== currentPlan ? preselectedPlan : null,
  );
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    effectiveDate: string;
    newPriceUsdCents: number;
  } | null>(null);

  const availablePlans = ["MONTHLY", "ANNUAL"].filter((p) => p !== currentPlan);

  function handleRequest() {
    if (!selectedPlan) return;
    startTransition(async () => {
      const res = await requestPlanChangeAction({ companyId, toPlan: selectedPlan });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setResult({ effectiveDate: res.data.effectiveDate, newPriceUsdCents: res.data.newPriceUsdCents });
      toast.success("Solicitud de cambio de plan registrada");
    });
  }

  function handleCancel(id: string) {
    startTransition(async () => {
      const res = await cancelPlanChangeAction({ planChangeRequestId: id });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Cambio de plan cancelado");
      setResult(null);
      setSelectedPlan(null);
    });
  }

  return (
    <>
      <Toaster richColors position="top-right" />

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
          {companyName}
        </p>
        <h2 className="mb-4 text-lg font-bold text-slate-900">Tu suscripción</h2>

        {/* Plan actual */}
        <div className="mb-6 rounded-xl bg-slate-50 px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-700">
                {PLAN_LABELS[currentPlan] ?? currentPlan}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatPrice(priceUsdCents)} · Renovación el {formatDate(currentPeriodEnd)}
              </p>
            </div>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
              Activo
            </span>
          </div>
        </div>

        {/* Cambio pendiente existente */}
        {(pendingChange || result) && (
          <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-blue-800">
                  Cambio de plan pendiente
                </p>
                <p className="mt-0.5 text-xs text-blue-700">
                  Pasarás al{" "}
                  <span className="font-semibold">
                    {PLAN_LABELS[(pendingChange ?? result as unknown as typeof pendingChange)!.toPlan!] ??
                      (pendingChange ?? result as unknown as typeof pendingChange)!.toPlan}
                  </span>{" "}
                  el{" "}
                  <span className="font-semibold">
                    {formatDate((pendingChange?.effectiveDate ?? result?.effectiveDate)!)}
                  </span>
                  . Tu próximo cobro será{" "}
                  <span className="font-semibold">
                    {formatPrice((pendingChange?.newPriceUsdCents ?? result?.newPriceUsdCents)!)}
                  </span>
                  .
                </p>
                {pendingChange?.status === "PENDING_PAYMENT" && (
                  <p className="mt-2 text-xs text-blue-600">
                    Pendiente: envía el pago por WhatsApp para confirmar.
                  </p>
                )}
                {pendingChange?.status === "CONFIRMED" && (
                  <p className="mt-2 text-xs text-emerald-700 font-semibold">
                    ✓ Pago confirmado — se aplicará automáticamente en la fecha efectiva.
                  </p>
                )}
              </div>
              {pendingChange && pendingChange.status === "PENDING_PAYMENT" && (
                <button
                  onClick={() => handleCancel(pendingChange.id)}
                  disabled={isPending}
                  className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
              )}
            </div>
          </div>
        )}

        {/* Selector de nuevo plan */}
        {!pendingChange && !result && (
          <div>
            <p className="mb-3 text-sm font-semibold text-slate-700">Cambiar de plan</p>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row">
              {availablePlans.map((plan) => (
                <button
                  key={plan}
                  onClick={() => setSelectedPlan(selectedPlan === plan ? null : plan)}
                  className={`flex-1 rounded-xl border-2 px-4 py-3 text-left transition-all ${
                    selectedPlan === plan
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <p className="text-sm font-semibold text-slate-900">{PLAN_LABELS[plan]}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{PLAN_PRICES[plan]}</p>
                </button>
              ))}
            </div>

            {selectedPlan && (
              <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
                El cambio al <span className="font-semibold">{PLAN_LABELS[selectedPlan]}</span> se hará
                efectivo el{" "}
                <span className="font-semibold">
                  1 de{" "}
                  {new Date(
                    Date.UTC(
                      new Date().getUTCMonth() === 11
                        ? new Date().getUTCFullYear() + 1
                        : new Date().getUTCFullYear(),
                      (new Date().getUTCMonth() + 1) % 12,
                      1,
                    ),
                  ).toLocaleDateString("es-VE", { month: "long", year: "numeric", timeZone: "UTC" })}
                </span>
                . Deberás enviar el pago USDT antes de esa fecha.
              </div>
            )}

            <button
              onClick={handleRequest}
              disabled={!selectedPlan || isPending}
              aria-busy={isPending}
              className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Procesando…" : "Solicitar cambio de plan"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
