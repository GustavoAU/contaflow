"use client";
// src/modules/payroll/components/PayrollWizard.tsx
// Fase NOM-A: Wizard de 3 pasos para configuración de nómina
// NOM-A-03: confirmación de desactivar organismos obligatorios (IVSS/INCES/Banavih)
// Solo visible para ADMIN_ONLY — el server guard rechaza a otros roles en la action

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePayrollConfigAction } from "../actions/payroll-config.actions";
import type { PayrollConfigRow } from "../services/PayrollConfigService";

type Step = 1 | 2 | 3;

interface AccountOption {
  id: string;
  code: string;
  name: string;
}

interface Props {
  companyId: string;
  initial?: PayrollConfigRow | null;
  accounts?: AccountOption[];
  onSaved?: (cfg: PayrollConfigRow) => void;
}

const SIZE_LABELS: Record<string, string> = {
  SMALL: "Menos de 20 empleados",
  MEDIUM: "20 a 100 empleados",
  LARGE: "Más de 100 empleados",
};

const LOTT_LABELS: Record<string, string> = {
  POST_2012: "Solo régimen post-LOTTT 2012",
  MIXED: "Mixto (empleados pre-1997 y post-2012)",
};

const CURRENCY_LABELS: Record<string, string> = {
  VES: "Bolívares (VES)",
  USD: "Dólares (USD)",
  MIXED: "Mixto (VES + USD)",
};

const FREQUENCY_LABELS: Record<string, string> = {
  BIWEEKLY: "Quincenal (días 15 y último)",
  MONTHLY: "Mensual",
};

const FIDEICOMISO_LABELS: Record<string, string> = {
  EXTERNAL_BANK: "Banco externo (fideicomiso real)",
  INTERNAL: "Registro contable interno",
};

const CESTA_LABELS: Record<string, string> = {
  CARD: "Tarjeta de alimentación",
  CASH: "Efectivo",
  NONE: "No aplica",
};

export default function PayrollWizard({ companyId, initial, accounts = [], onSaved }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Form state — defaults from existing config or sensible defaults
  const [form, setForm] = useState({
    sizeRange: initial?.sizeRange ?? "SMALL",
    lottRegime: initial?.lottRegime ?? "POST_2012",
    ivssEnabled: initial?.ivssEnabled ?? true,
    incesEnabled: initial?.incesEnabled ?? true,
    banavihEnabled: initial?.banavihEnabled ?? true,
    cestaTicketType: initial?.cestaTicketType ?? "CARD",
    paymentCurrency: initial?.paymentCurrency ?? "VES",
    frequency: initial?.frequency ?? "BIWEEKLY",
    fideicomiso: initial?.fideicomiso ?? "INTERNAL",
    benefitsExpenseAccountId: initial?.benefitsExpenseAccountId ?? "",
    benefitsPayableAccountId: initial?.benefitsPayableAccountId ?? "",
    vacationPayableAccountId: initial?.vacationPayableAccountId ?? "",
    profitSharingPayableAccountId: initial?.profitSharingPayableAccountId ?? "",
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // NOM-A-03: advertencia si el usuario intenta desactivar un organismo obligatorio
  function toggleOrganism(key: "ivssEnabled" | "incesEnabled" | "banavihEnabled") {
    const current = form[key];
    if (current) {
      const labels: Record<string, string> = {
        ivssEnabled: "IVSS",
        incesEnabled: "INCES",
        banavihEnabled: "Banavih (FAOV)",
      };
      const ok = window.confirm(
        `Deshabilitar ${labels[key]} eliminará el cálculo de aportes patronales y obreros correspondientes. ` +
          `Esta configuración puede generar obligaciones fiscales. ¿Confirma?`
      );
      if (!ok) return;
    }
    set(key, !current as typeof form[typeof key]);
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const payload = {
        ...form,
        benefitsExpenseAccountId: form.benefitsExpenseAccountId || null,
        benefitsPayableAccountId: form.benefitsPayableAccountId || null,
        vacationPayableAccountId: form.vacationPayableAccountId || null,
        profitSharingPayableAccountId: form.profitSharingPayableAccountId || null,
      };
      const result = await savePayrollConfigAction(companyId, payload);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onSaved?.(result.data);
      router.push(`/company/${companyId}/payroll`);
    });
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {/* Progress */}
      <div className="flex items-center gap-2">
        {([1, 2, 3] as Step[]).map((s) => (
          <div
            key={s}
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
              s === step
                ? "bg-blue-600 text-white"
                : s < step
                ? "bg-green-500 text-white"
                : "bg-gray-200 text-gray-500"
            }`}
          >
            {s}
          </div>
        ))}
        <span className="ml-2 text-sm text-gray-500">
          {step === 1 && "Empresa"}
          {step === 2 && "Organismos y Beneficios"}
          {step === 3 && "Configuración de Pagos"}
        </span>
      </div>

      {/* Step 1 — Empresa */}
      {step === 1 && (
        <section className="space-y-5 rounded-lg border p-6">
          <h2 className="text-lg font-semibold">Paso 1 — Tu empresa</h2>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Tamaño de la empresa
            </label>
            {Object.entries(SIZE_LABELS).map(([val, label]) => (
              <label key={val} className="flex cursor-pointer items-center gap-2 py-1">
                <input
                  type="radio"
                  name="sizeRange"
                  value={val}
                  checked={form.sizeRange === val}
                  onChange={() => set("sizeRange", val as typeof form.sizeRange)}
                  className="accent-blue-600"
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Régimen LOTTT aplicable
            </label>
            {Object.entries(LOTT_LABELS).map(([val, label]) => (
              <label key={val} className="flex cursor-pointer items-center gap-2 py-1">
                <input
                  type="radio"
                  name="lottRegime"
                  value={val}
                  checked={form.lottRegime === val}
                  onChange={() => set("lottRegime", val as typeof form.lottRegime)}
                  className="accent-blue-600"
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Siguiente
            </button>
          </div>
        </section>
      )}

      {/* Step 2 — Organismos y Beneficios */}
      {step === 2 && (
        <section className="space-y-5 rounded-lg border p-6">
          <h2 className="text-lg font-semibold">Paso 2 — Organismos y Beneficios</h2>

          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Organismos activos</p>
            <p className="text-xs text-gray-500">
              Desactivar un organismo elimina su cálculo en todas las nóminas futuras.
            </p>
            {(
              [
                { key: "ivssEnabled", label: "IVSS (Seguro Social — 11% patronal + 4% obrero)" },
                { key: "incesEnabled", label: "INCES (2% patronal + 0.5% trabajador)" },
                { key: "banavihEnabled", label: "Banavih / FAOV (1% patronal + 1% trabajador)" },
              ] as const
            ).map(({ key, label }) => (
              <label key={key} className="flex cursor-pointer items-center gap-3 py-1">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={() => toggleOrganism(key)}
                  className="h-4 w-4 accent-blue-600"
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Cesta Ticket</label>
            {Object.entries(CESTA_LABELS).map(([val, label]) => (
              <label key={val} className="flex cursor-pointer items-center gap-2 py-1">
                <input
                  type="radio"
                  name="cestaTicketType"
                  value={val}
                  checked={form.cestaTicketType === val}
                  onChange={() => set("cestaTicketType", val as typeof form.cestaTicketType)}
                  className="accent-blue-600"
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Siguiente
            </button>
          </div>
        </section>
      )}

      {/* Step 3 — Pagos */}
      {step === 3 && (
        <section className="space-y-5 rounded-lg border p-6">
          <h2 className="text-lg font-semibold">Paso 3 — Configuración de Pagos</h2>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Moneda de pago</label>
            {Object.entries(CURRENCY_LABELS).map(([val, label]) => (
              <label key={val} className="flex cursor-pointer items-center gap-2 py-1">
                <input
                  type="radio"
                  name="paymentCurrency"
                  value={val}
                  checked={form.paymentCurrency === val}
                  onChange={() => set("paymentCurrency", val as typeof form.paymentCurrency)}
                  className="accent-blue-600"
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Frecuencia de pago
            </label>
            {Object.entries(FREQUENCY_LABELS).map(([val, label]) => (
              <label key={val} className="flex cursor-pointer items-center gap-2 py-1">
                <input
                  type="radio"
                  name="frequency"
                  value={val}
                  checked={form.frequency === val}
                  onChange={() => set("frequency", val as typeof form.frequency)}
                  className="accent-blue-600"
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Fideicomiso</label>
            {Object.entries(FIDEICOMISO_LABELS).map(([val, label]) => (
              <label key={val} className="flex cursor-pointer items-center gap-2 py-1">
                <input
                  type="radio"
                  name="fideicomiso"
                  value={val}
                  checked={form.fideicomiso === val}
                  onChange={() => set("fideicomiso", val as typeof form.fideicomiso)}
                  className="accent-blue-600"
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>

          {/* Cuentas contables NOM-D */}
          {accounts.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">Cuentas contables — Beneficios legales</p>
              <p className="text-xs text-gray-500">
                Requeridas para registrar prestaciones sociales, vacaciones y utilidades.
              </p>
              {(
                [
                  { key: "benefitsExpenseAccountId", label: "Gasto Prestaciones Sociales" },
                  { key: "benefitsPayableAccountId", label: "Prestaciones Sociales por Pagar" },
                  { key: "vacationPayableAccountId", label: "Vacaciones por Pagar" },
                  { key: "profitSharingPayableAccountId", label: "Utilidades por Pagar" },
                ] as const
              ).map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <select
                    value={form[key]}
                    onChange={(e) => set(key, e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">— Sin asignar —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          {/* Resumen */}
          <div className="rounded bg-gray-50 p-4 text-xs text-gray-600 space-y-1">
            <p className="font-medium text-gray-800 mb-2">Resumen de configuración</p>
            <p>Tamaño: {SIZE_LABELS[form.sizeRange]}</p>
            <p>Régimen: {LOTT_LABELS[form.lottRegime]}</p>
            <p>
              Organismos: {[
                form.ivssEnabled && "IVSS",
                form.incesEnabled && "INCES",
                form.banavihEnabled && "Banavih",
              ]
                .filter(Boolean)
                .join(" · ") || "Ninguno"}
            </p>
            <p>Cesta ticket: {CESTA_LABELS[form.cestaTicketType]}</p>
            <p>Moneda: {CURRENCY_LABELS[form.paymentCurrency]}</p>
            <p>Frecuencia: {FREQUENCY_LABELS[form.frequency]}</p>
            <p>Fideicomiso: {FIDEICOMISO_LABELS[form.fideicomiso]}</p>
          </div>

          {error && (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending}
              className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? "Guardando..." : "Guardar configuración"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
