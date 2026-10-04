"use client";
// src/modules/payroll/components/LegalThresholdsPanel.tsx
// Ítem 72: Panel de gestión de topes legales venezolanos.
// ADMIN puede agregar nuevas entradas cuando cambia un decreto presidencial.

import { useState, useTransition } from "react";
import {
  createLegalThresholdAction,
  deleteLegalThresholdAction,
  confirmThresholdStillValidAction,
} from "../actions/legal-threshold.actions";
import { computeSalMinAlert } from "../utils/sal-min-alert";
import type { LegalThresholdRow } from "../services/LegalThresholdService";
import { MoneyInput } from "@/components/ui/money-input";
import { formatMoneyVE } from "@/lib/money-input";

interface Props {
  companyId: string;
  initialThresholds: LegalThresholdRow[];
  isAdmin: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  SALARY_MIN_VES: "Salario Mínimo (Bs/mes)",
  UT_VALUE: "Unidad Tributaria (Bs)",
  IVSS_OBR_RATE: "IVSS Obrero (%)",
  IVSS_PAT_RATE: "IVSS Patronal (%)",
  INCES_OBR_RATE: "INCES Obrero (%)",
  INCES_PAT_RATE: "INCES Patronal (%)",
  FAOV_OBR_RATE: "FAOV/Banavih Obrero (%)",
  FAOV_PAT_RATE: "FAOV/Banavih Patronal (%)",
  RPE_OBR_RATE: "RPE/Paro Forzoso Obrero (%)",
  RPE_PAT_RATE: "RPE/Paro Forzoso Patronal (%)",
  PENSIONES_PAT_RATE: "Protección de Pensiones Patronal (%)",
  INGRESO_MINIMO_INTEGRAL_USD: "Ingreso Mínimo Integral (USD)",
};

const TYPE_DEFAULTS: Record<string, string> = {
  SALARY_MIN_VES: "",
  UT_VALUE: "",
  IVSS_OBR_RATE: "4.00",
  IVSS_PAT_RATE: "9.00",
  INCES_OBR_RATE: "0.50",
  INCES_PAT_RATE: "2.00",
  FAOV_OBR_RATE: "1.00",
  FAOV_PAT_RATE: "2.00",
  RPE_OBR_RATE: "0.50",
  RPE_PAT_RATE: "2.00",
  PENSIONES_PAT_RATE: "9.00",
  INGRESO_MINIMO_INTEGRAL_USD: "",
};

const RATE_TYPES = new Set([
  "IVSS_OBR_RATE",
  "IVSS_PAT_RATE",
  "INCES_OBR_RATE",
  "INCES_PAT_RATE",
  "FAOV_OBR_RATE",
  "FAOV_PAT_RATE",
  "RPE_OBR_RATE",
  "RPE_PAT_RATE",
  "PENSIONES_PAT_RATE",
]);

// El piso en USD (Art. 7, Ley Protección de las Pensiones) NO es un porcentaje
// ni está en bolívares como los otros dos monetarios — se separa para que la
// columna "Valor" pueda mostrar la unidad correcta en vez de asumir "Bs".
const USD_TYPES = new Set(["INGRESO_MINIMO_INTEGRAL_USD"]);

const MONETARY_TYPES = ["SALARY_MIN_VES", "UT_VALUE", "INGRESO_MINIMO_INTEGRAL_USD"] as const;
const PARAFISCAL_RATE_TYPES = [
  "IVSS_OBR_RATE",
  "IVSS_PAT_RATE",
  "INCES_OBR_RATE",
  "INCES_PAT_RATE",
  "FAOV_OBR_RATE",
  "FAOV_PAT_RATE",
  "RPE_OBR_RATE",
  "RPE_PAT_RATE",
  "PENSIONES_PAT_RATE",
] as const;

const EMPTY_FORM = {
  type: "SALARY_MIN_VES" as string,
  effectiveFrom: "",
  value: "",
  notes: "",
};

export default function LegalThresholdsPanel({ companyId, initialThresholds, isAdmin }: Props) {
  const [thresholds, setThresholds] = useState<LegalThresholdRow[]>(initialThresholds);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createLegalThresholdAction(companyId, form);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setThresholds((prev) => [res.data, ...prev]);
      setForm(EMPTY_FORM);
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const res = await deleteLegalThresholdAction(companyId, id);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setThresholds((prev) => prev.filter((t) => t.id !== id));
    });
  }

  function handleConfirm(id: string) {
    // No cambia el valor: registra que alguien COMPROBÓ que sigue vigente. El
    // sistema no puede saber si salió un decreto nuevo; sí puede pedir que se
    // revise cada mes y contar desde esa revisión.
    startTransition(async () => {
      const res = await confirmThresholdStillValidAction(companyId, id);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setThresholds((prev) =>
        prev.map((t) => (t.id === id ? { ...t, verifiedAt: res.data.verifiedAt } : t))
      );
    });
  }

  const byType = Object.fromEntries(
    [...MONETARY_TYPES, ...PARAFISCAL_RATE_TYPES].map((t) => [
      t,
      thresholds.filter((r) => r.type === t),
    ])
  ) as Record<string, typeof thresholds>;

  const lastSalMin = byType["SALARY_MIN_VES"]?.[0];
  // Bug encontrado en vivo (2026-09-05): esto medía SOLO antigüedad de
  // effectiveFrom (>180 días) — nunca miraba `verifiedAt`, así que ni
  // siquiera clicar "Sigue vigente" abajo lo apagaba, y un valor CORRECTO
  // (Bs. 130, congelado desde 2022) quedaba marcado "incorrecto" para
  // siempre. Ver utils/sal-min-alert.ts — mismo fix que PayrollRunForm.
  const salMinAlert = computeSalMinAlert(
    lastSalMin?.value ?? null,
    lastSalMin?.verifiedAt ?? lastSalMin?.effectiveFrom ?? null
  );
  const salMinEsError = salMinAlert.severity === "error";

  return (
    <div className="space-y-6">
      {salMinAlert.tieneAviso && (
        <div
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
            salMinEsError
              ? "border-red-300 bg-red-50 text-red-800"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          <svg
            className={`mt-0.5 h-4 w-4 shrink-0 ${salMinEsError ? "text-red-600" : "text-amber-600"}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
          <div className="space-y-1.5">
            <p className="font-semibold">{salMinAlert.titulo}</p>
            <p className={salMinEsError ? "text-red-700" : "text-amber-800"}>
              {salMinAlert.mensaje}
            </p>
            {salMinEsError && lastSalMin && (
              <>
                <p className="text-red-700">
                  Mientras no se actualice, los topes de cotización usados son:
                </p>
                <ul className="mt-1 space-y-0.5 font-mono text-xs text-red-700">
                  <li>
                    · IVSS obrero (4%): base máx. Bs{" "}
                    {(Number(lastSalMin.value) * 5).toLocaleString("es-VE", {
                      minimumFractionDigits: 2,
                    })}{" "}
                    (5 × salMin)
                  </li>
                  <li>
                    · INCES obrero (0,5%): base máx. Bs{" "}
                    {(Number(lastSalMin.value) * 5).toLocaleString("es-VE", {
                      minimumFractionDigits: 2,
                    })}{" "}
                    (5 × salMin)
                  </li>
                  <li>
                    · FAOV/Banavih obrero (1%): base máx. Bs{" "}
                    {(Number(lastSalMin.value) * 10).toLocaleString("es-VE", {
                      minimumFractionDigits: 2,
                    })}{" "}
                    (10 × salMin)
                  </li>
                </ul>
              </>
            )}
            {salMinEsError && (
              <p className="text-red-700">
                Esto genera <strong>subpagos a los organismos fiscales</strong>. Verifica el decreto
                vigente en{" "}
                <a
                  href="https://www.minpptrass.gob.ve"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-red-900"
                >
                  MINPPTRASS
                </a>{" "}
                y actualiza el valor de inmediato.
              </p>
            )}
          </div>
        </div>
      )}
      {/* Tabla — valores monetarios */}
      {MONETARY_TYPES.map((type) => (
        <div key={type} className="overflow-hidden rounded-lg border">
          <div className="bg-muted px-4 py-2 text-sm font-medium">{TYPE_LABELS[type]}</div>
          {byType[type].length === 0 ? (
            <p className="text-muted-foreground px-4 py-3 text-sm">
              Sin registros. Agrega el valor actual para que el motor de nómina aplique el tope
              correcto.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left">
                    Vigente desde
                  </th>
                  <th scope="col" className="px-4 py-2 text-right">
                    Valor ({USD_TYPES.has(type) ? "USD" : "Bs"})
                  </th>
                  <th scope="col" className="px-4 py-2 text-left">
                    Notas
                  </th>
                  {isAdmin && <th scope="col" className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {byType[type].map((t) => (
                  <tr key={t.id} className="hover:bg-muted/30 border-b last:border-0">
                    <td className="px-4 py-2 font-mono">{t.effectiveFrom}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {Number(t.value).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="text-muted-foreground px-4 py-2">
                      {t.notes ?? "—"}
                      {/* Un tope puede llevar años sin cambiar y seguir vigente:
                          el salario mínimo venezolano está en Bs. 130 desde
                          marzo de 2022. Lo que envejece no es el valor, es la
                          comprobación. */}
                      {t.verifiedAt && (
                        <span className="mt-0.5 block text-xs text-emerald-700">
                          Vigencia confirmada el{" "}
                          {new Date(t.verifiedAt).toLocaleDateString("es-VE", { timeZone: "UTC" })}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleConfirm(t.id)}
                        disabled={isPending}
                        title="Registra que comprobaste que este tope sigue vigente. No cambia el valor."
                        className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
                      >
                        Sigue vigente
                      </button>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => handleDelete(t.id)}
                          disabled={isPending}
                          className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                        >
                          Eliminar
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {/* Tabla — alícuotas parafiscales */}
      <div className="overflow-hidden rounded-lg border">
        <div className="bg-muted flex items-center justify-between px-4 py-2 text-sm font-medium">
          <span>Alícuotas parafiscales (%)</span>
          <span className="text-muted-foreground text-xs font-normal">
            Valor en %; sin registro = default legal vigente
          </span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th scope="col" className="px-4 py-2 text-left">
                Organismo
              </th>
              <th scope="col" className="px-4 py-2 text-right">
                Default
              </th>
              <th scope="col" className="px-4 py-2 text-right">
                Vigente (desde)
              </th>
              {isAdmin && <th scope="col" className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {PARAFISCAL_RATE_TYPES.map((type) => {
              const latest = byType[type]?.[0];
              return (
                <tr key={type} className="hover:bg-muted/30 border-b last:border-0">
                  <td className="px-4 py-2">{TYPE_LABELS[type]}</td>
                  <td className="text-muted-foreground px-4 py-2 text-right font-mono">
                    {TYPE_DEFAULTS[type]}%
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {latest ? (
                      <span className="font-semibold text-blue-700">
                        {Number(latest.value).toFixed(2)}%{" "}
                        <span className="text-muted-foreground text-xs font-normal">
                          desde {latest.effectiveFrom}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">usando default</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-2 text-right">
                      {latest && (
                        <button
                          onClick={() => handleDelete(latest.id)}
                          disabled={isPending}
                          className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                        >
                          Eliminar
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Formulario — solo ADMIN */}
      {isAdmin && (
        <form onSubmit={handleAdd} className="space-y-4 rounded-lg border p-4">
          <h2 className="text-sm font-medium">Agregar nuevo tope</h2>

          {error && (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-muted-foreground text-xs font-medium">Tipo</label>
              <select
                name="type"
                value={form.type}
                onChange={(e) => {
                  const newType = e.target.value;
                  setForm((prev) => ({
                    ...prev,
                    type: newType,
                    value: RATE_TYPES.has(newType) ? (TYPE_DEFAULTS[newType] ?? "") : "",
                  }));
                }}
                className="w-full rounded border bg-white px-3 py-2 text-sm"
              >
                <optgroup label="Valores monetarios">
                  <option value="SALARY_MIN_VES">Salario Mínimo (Bs)</option>
                  <option value="UT_VALUE">Unidad Tributaria (Bs)</option>
                  <option value="INGRESO_MINIMO_INTEGRAL_USD">Ingreso Mínimo Integral (USD)</option>
                </optgroup>
                <optgroup label="Alícuotas parafiscales (%)">
                  <option value="IVSS_OBR_RATE">IVSS Obrero</option>
                  <option value="IVSS_PAT_RATE">IVSS Patronal</option>
                  <option value="INCES_OBR_RATE">INCES Obrero</option>
                  <option value="INCES_PAT_RATE">INCES Patronal</option>
                  <option value="FAOV_OBR_RATE">FAOV/Banavih Obrero</option>
                  <option value="FAOV_PAT_RATE">FAOV/Banavih Patronal</option>
                  <option value="RPE_OBR_RATE">RPE/Paro Forzoso Obrero</option>
                  <option value="RPE_PAT_RATE">RPE/Paro Forzoso Patronal</option>
                  <option value="PENSIONES_PAT_RATE">Protección de Pensiones Patronal</option>
                </optgroup>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-muted-foreground text-xs font-medium">Vigente desde</label>
              <input
                type="date"
                name="effectiveFrom"
                value={form.effectiveFrom}
                onChange={handleChange}
                required
                className="w-full rounded border px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-muted-foreground text-xs font-medium">
                {RATE_TYPES.has(form.type)
                  ? "Alícuota (%)"
                  : USD_TYPES.has(form.type)
                    ? "Valor (USD)"
                    : "Valor (Bs)"}
              </label>
              <div className="relative">
                <MoneyInput
                  bare
                  name="value"
                  value={form.value}
                  onValueChange={(v) => setForm((prev) => ({ ...prev, value: v }))}
                  placeholder={
                    RATE_TYPES.has(form.type)
                      ? `Ej: ${formatMoneyVE(TYPE_DEFAULTS[form.type] || "4")}`
                      : USD_TYPES.has(form.type)
                        ? "Ej: 240,00"
                        : "Ej: 130,00"
                  }
                  required
                  className="w-full rounded border px-3 py-2 pr-8 font-mono text-sm"
                />
                {RATE_TYPES.has(form.type) && (
                  <span className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2 text-sm">
                    %
                  </span>
                )}
              </div>
              {RATE_TYPES.has(form.type) && (
                <p className="text-muted-foreground text-xs">
                  Default actual: {TYPE_DEFAULTS[form.type]}% — solo registra si hay un decreto que
                  modifique la alícuota.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-muted-foreground text-xs font-medium">
                Notas / Gaceta Oficial (opcional)
              </label>
              <input
                type="text"
                name="notes"
                value={form.notes}
                onChange={handleChange}
                placeholder="Ej: Decreto 5.163 Gaceta Oficial 43.050"
                maxLength={200}
                className="w-full rounded border px-3 py-2 text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isPending ? "Guardando…" : "Agregar"}
          </button>
        </form>
      )}
    </div>
  );
}
