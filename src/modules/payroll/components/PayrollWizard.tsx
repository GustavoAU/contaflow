"use client";
// src/modules/payroll/components/PayrollWizard.tsx
// Fase NOM-A: Wizard de 3 pasos para configuración de nómina
// NOM-A-03: confirmación de desactivar organismos obligatorios (IVSS/INCES/Banavih)
// Solo visible para ADMIN_ONLY — el server guard rechaza a otros roles en la action

import { useState, useTransition, useMemo } from "react";
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

const WORK_SCHEDULE_LABELS: Record<string, string> = {
  LUNES_VIERNES: "Lunes a viernes (sábado y domingo libres)",
  LUNES_SABADO: "Lunes a sábado (solo domingo libre)",
  LUNES_SABADO_MEDIO: "Lunes a viernes + sábado medio turno",
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
    rpeEnabled: initial?.rpeEnabled ?? true,
    cestaTicketType: initial?.cestaTicketType ?? "CARD",
    paymentCurrency: initial?.paymentCurrency ?? "VES",
    frequency: initial?.frequency ?? "BIWEEKLY",
    fideicomiso: initial?.fideicomiso ?? "INTERNAL",
    workSchedule: (initial?.workSchedule ?? "LUNES_VIERNES") as "LUNES_VIERNES" | "LUNES_SABADO" | "LUNES_SABADO_MEDIO",
    salaryMinimumVes: initial?.salaryMinimumVes ?? "",
    // Cuentas nómina principal (requeridas para aprobar proceso)
    expenseAccountId: initial?.expenseAccountId ?? "",
    payableAccountId: initial?.payableAccountId ?? "",
    ivssPayableAccountId: initial?.ivssPayableAccountId ?? "",
    faovPayableAccountId: initial?.faovPayableAccountId ?? "",
    incesPayableAccountId: initial?.incesPayableAccountId ?? "",
    // Aportes patronales
    ivssPatronalAccountId: initial?.ivssPatronalAccountId ?? "",
    incesPatronalAccountId: initial?.incesPatronalAccountId ?? "",
    faovPatronalAccountId: initial?.faovPatronalAccountId ?? "",
    rpePatronalAccountId: initial?.rpePatronalAccountId ?? "",
    // Beneficios legales
    benefitsExpenseAccountId: initial?.benefitsExpenseAccountId ?? "",
    benefitsPayableAccountId: initial?.benefitsPayableAccountId ?? "",
    vacationPayableAccountId: initial?.vacationPayableAccountId ?? "",
    profitSharingPayableAccountId: initial?.profitSharingPayableAccountId ?? "",
    rpePayableAccountId: initial?.rpePayableAccountId ?? "",
    loanReceivableAccountId: initial?.loanReceivableAccountId ?? "",
    disbursementBankAccountId: initial?.disbursementBankAccountId ?? "",
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Detecta en tiempo real si dos conceptos comparten la misma cuenta GL
  const accountConflict = useMemo((): string | null => {
    const fields = [
      { key: "expenseAccountId",              label: "Gasto Sueldos y Salarios" },
      { key: "payableAccountId",              label: "Sueldos por Pagar" },
      { key: "ivssPayableAccountId",          label: "IVSS Obrero por Pagar" },
      { key: "faovPayableAccountId",          label: "FAOV Obrero por Pagar" },
      { key: "incesPayableAccountId",         label: "INCES Obrero por Pagar" },
      { key: "ivssPatronalAccountId",         label: "IVSS Patronal por Pagar" },
      { key: "incesPatronalAccountId",        label: "INCES Patronal por Pagar" },
      { key: "faovPatronalAccountId",         label: "FAOV Patronal por Pagar" },
      { key: "rpePatronalAccountId",          label: "RPE Patronal por Pagar" },
      { key: "benefitsExpenseAccountId",      label: "Gasto Prestaciones" },
      { key: "benefitsPayableAccountId",      label: "Prestaciones por Pagar" },
      { key: "vacationPayableAccountId",      label: "Vacaciones por Pagar" },
      { key: "profitSharingPayableAccountId", label: "Utilidades por Pagar" },
      { key: "rpePayableAccountId",           label: "RPE Obrero por Pagar" },
      { key: "loanReceivableAccountId",       label: "Préstamos a Empleados" },
      { key: "disbursementBankAccountId",     label: "Banco de Desembolso" },
    ] as const;
    const seen = new Map<string, string>();
    for (const { key, label } of fields) {
      const id = form[key];
      if (!id) continue;
      if (seen.has(id)) return `"${seen.get(id)}" y "${label}" usan la misma cuenta GL`;
      seen.set(id, label);
    }
    return null;
  }, [form]);

  // NOM-A-03: advertencia si el usuario intenta desactivar un organismo obligatorio
  function toggleOrganism(key: "ivssEnabled" | "incesEnabled" | "banavihEnabled" | "rpeEnabled") {
    const current = form[key];
    if (current) {
      const labels: Record<string, string> = {
        ivssEnabled: "IVSS",
        incesEnabled: "INCES",
        banavihEnabled: "Banavih (FAOV)",
        rpeEnabled: "Paro Forzoso (RPE)",
      };
      const ok = window.confirm(
        `Deshabilitar ${labels[key]} eliminará el cálculo de aportes patronales y obreros correspondientes. ` +
          `Esta configuración puede generar obligaciones fiscales. ¿Confirma?`
      );
      if (!ok) return;
    }
    set(key, !current as typeof form[typeof key]);
  }

  function validateAccountConflicts(): string | null {
    // Reutiliza la misma lógica del useMemo para consistencia submit vs. tiempo-real
    return accountConflict;
  }

  function handleSubmit() {
    setError(null);
    const conflict = validateAccountConflicts();
    if (conflict) {
      setError(conflict);
      return;
    }
    startTransition(async () => {
      const payload = {
        ...form,
        salaryMinimumVes: form.salaryMinimumVes || null,
        expenseAccountId: form.expenseAccountId || null,
        payableAccountId: form.payableAccountId || null,
        ivssPayableAccountId: form.ivssPayableAccountId || null,
        faovPayableAccountId: form.faovPayableAccountId || null,
        incesPayableAccountId: form.incesPayableAccountId || null,
        ivssPatronalAccountId: form.ivssPatronalAccountId || null,
        incesPatronalAccountId: form.incesPatronalAccountId || null,
        faovPatronalAccountId: form.faovPatronalAccountId || null,
        rpePatronalAccountId: form.rpePatronalAccountId || null,
        benefitsExpenseAccountId: form.benefitsExpenseAccountId || null,
        benefitsPayableAccountId: form.benefitsPayableAccountId || null,
        vacationPayableAccountId: form.vacationPayableAccountId || null,
        profitSharingPayableAccountId: form.profitSharingPayableAccountId || null,
        rpePayableAccountId: form.rpePayableAccountId || null,
        loanReceivableAccountId: form.loanReceivableAccountId || null,
        disbursementBankAccountId: form.disbursementBankAccountId || null,
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

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Jornada laboral <span className="text-xs text-gray-400 font-normal">(días hábiles para vacaciones)</span>
            </label>
            {Object.entries(WORK_SCHEDULE_LABELS).map(([val, label]) => (
              <label key={val} className="flex cursor-pointer items-center gap-2 py-1">
                <input
                  type="radio"
                  name="workSchedule"
                  value={val}
                  checked={form.workSchedule === val}
                  onChange={() => set("workSchedule", val as typeof form.workSchedule)}
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
                { key: "ivssEnabled", label: "IVSS (Seg. Social — 11% patronal + 4% obrero)" },
                { key: "incesEnabled", label: "INCES (2% patronal + 0.5% trabajador)" },
                { key: "banavihEnabled", label: "Banavih / FAOV (1% patronal + 1% trabajador)" },
                { key: "rpeEnabled", label: "Paro Forzoso RPE (0.5% obrero — LSSO Art. 7)" },
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

          <div className="mt-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Salario mínimo nacional vigente (Bs/mes)
            </label>
            <p className="text-xs text-gray-500 mb-1">
              Requerido para aplicar topes de cotización (IVSS: 5×, FAOV: 10×, INCES/RPE: 5×).
            </p>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="ej. 130.00"
              value={form.salaryMinimumVes}
              onChange={(e) => set("salaryMinimumVes", e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
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

          {/* Cuentas contables — agrupadas en 3 secciones */}
          {accounts.length > 0 && (
            <div className="space-y-6">
              {/* Sección 1: Nómina principal — requeridas para aprobar procesos */}
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">Cuentas contables — Nómina (sueldos)</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Requeridas para aprobar procesos de nómina. El asiento de causación debita Gastos de Personal y acredita los pasivos por pagar.
                  </p>
                </div>
                {(
                  [
                    { key: "expenseAccountId",      label: "Gasto Sueldos y Salarios (5105)",     req: true  },
                    { key: "payableAccountId",      label: "Sueldos y Salarios por Pagar (neto)", req: true  },
                    { key: "ivssPayableAccountId",  label: "IVSS Obrero por Pagar (2215)",        req: false },
                    { key: "incesPayableAccountId", label: "INCES Obrero por Pagar (2220)",       req: false },
                    { key: "faovPayableAccountId",  label: "FAOV / Banavih Obrero por Pagar",     req: false },
                  ] as const
                ).map(({ key, label, req }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      {label}
                      {req && <span className="ml-1 text-red-500">*</span>}
                    </label>
                    <select
                      value={form[key]}
                      onChange={(e) => set(key, e.target.value)}
                      className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">— Sin asignar —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* Sección 2: Aportes patronales */}
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">Cuentas contables — Aportes patronales</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Para causación de las contribuciones del patrono (IVSS 9%, INCES 2%, FAOV 2%, RPE 2%).
                  </p>
                </div>
                {(
                  [
                    { key: "ivssPatronalAccountId",  label: "IVSS Patronal por Pagar (2215)" },
                    { key: "incesPatronalAccountId", label: "INCES Patronal por Pagar (2220)" },
                    { key: "faovPatronalAccountId",  label: "FAOV Patronal por Pagar (2235)" },
                    { key: "rpePatronalAccountId",   label: "RPE Patronal por Pagar (2210)" },
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
                        <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* Sección 3: Beneficios legales (NOM-D) */}
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">Cuentas contables — Beneficios legales</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Para prestaciones sociales, vacaciones y utilidades. Cada concepto debe usar una cuenta GL diferente.
                  </p>
                </div>
                {(
                  [
                    { key: "benefitsExpenseAccountId",      label: "Gasto Prestaciones Sociales (5107)" },
                    { key: "benefitsPayableAccountId",      label: "Prestaciones Sociales por Pagar (2230)" },
                    { key: "vacationPayableAccountId",      label: "Vacaciones por Pagar (2225)" },
                    { key: "profitSharingPayableAccountId", label: "Utilidades por Pagar (2240)" },
                    { key: "rpePayableAccountId",           label: "RPE Obrero por Pagar" },
                    { key: "loanReceivableAccountId",       label: "Préstamos a Empleados (Activo 1315)" },
                    { key: "disbursementBankAccountId",     label: "Banco de Desembolso (para préstamos)" },
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
                        <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* Alerta en tiempo real si dos conceptos comparten la misma cuenta GL */}
              {accountConflict && (
                <div className="flex items-start gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
                  <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <span>
                    <strong>Cuenta GL duplicada:</strong> {accountConflict}. Asigna una cuenta diferente para evitar descuadres contables.
                  </span>
                </div>
              )}
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
                form.rpeEnabled && "RPE",
              ]
                .filter(Boolean)
                .join(" · ") || "Ninguno"}
            </p>
            {form.salaryMinimumVes && (
              <p>Salario mínimo: Bs {form.salaryMinimumVes} (topes activos)</p>
            )}
            <p>Cesta ticket: {CESTA_LABELS[form.cestaTicketType]}</p>
            <p>Moneda: {CURRENCY_LABELS[form.paymentCurrency]}</p>
            <p>Frecuencia: {FREQUENCY_LABELS[form.frequency]}</p>
            <p>Fideicomiso: {FIDEICOMISO_LABELS[form.fideicomiso]}</p>
            <p>Jornada: {WORK_SCHEDULE_LABELS[form.workSchedule]}</p>
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
              disabled={isPending || !!accountConflict}
              className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              title={accountConflict ? "Resuelve el conflicto de cuentas GL antes de guardar" : undefined}
            >
              {isPending ? "Guardando..." : "Guardar configuración"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
