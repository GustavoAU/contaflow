"use client";
// src/modules/payroll/components/LegalThresholdsPanel.tsx
// Ítem 72: Panel de gestión de topes legales venezolanos.
// ADMIN puede agregar nuevas entradas cuando cambia un decreto presidencial.

import { useState, useTransition } from "react";
import {
  createLegalThresholdAction,
  deleteLegalThresholdAction,
} from "../actions/legal-threshold.actions";
import type { LegalThresholdRow } from "../services/LegalThresholdService";

interface Props {
  companyId: string;
  initialThresholds: LegalThresholdRow[];
  isAdmin: boolean;
  salMinStale: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  SALARY_MIN_VES:  "Salario Mínimo (Bs/mes)",
  UT_VALUE:        "Unidad Tributaria (Bs)",
  IVSS_OBR_RATE:   "IVSS Obrero (%)",
  IVSS_PAT_RATE:   "IVSS Patronal (%)",
  INCES_OBR_RATE:  "INCES Obrero (%)",
  INCES_PAT_RATE:  "INCES Patronal (%)",
  FAOV_OBR_RATE:   "FAOV/Banavih Obrero (%)",
  FAOV_PAT_RATE:   "FAOV/Banavih Patronal (%)",
  RPE_OBR_RATE:    "RPE/Paro Forzoso Obrero (%)",
  RPE_PAT_RATE:    "RPE/Paro Forzoso Patronal (%)",
};

const TYPE_DEFAULTS: Record<string, string> = {
  SALARY_MIN_VES:  "",
  UT_VALUE:        "",
  IVSS_OBR_RATE:   "4.00",
  IVSS_PAT_RATE:   "9.00",
  INCES_OBR_RATE:  "0.50",
  INCES_PAT_RATE:  "2.00",
  FAOV_OBR_RATE:   "1.00",
  FAOV_PAT_RATE:   "2.00",
  RPE_OBR_RATE:    "0.50",
  RPE_PAT_RATE:    "2.00",
};

const RATE_TYPES = new Set([
  "IVSS_OBR_RATE", "IVSS_PAT_RATE",
  "INCES_OBR_RATE", "INCES_PAT_RATE",
  "FAOV_OBR_RATE", "FAOV_PAT_RATE",
  "RPE_OBR_RATE", "RPE_PAT_RATE",
]);

const MONETARY_TYPES = ["SALARY_MIN_VES", "UT_VALUE"] as const;
const PARAFISCAL_RATE_TYPES = [
  "IVSS_OBR_RATE", "IVSS_PAT_RATE",
  "INCES_OBR_RATE", "INCES_PAT_RATE",
  "FAOV_OBR_RATE", "FAOV_PAT_RATE",
  "RPE_OBR_RATE", "RPE_PAT_RATE",
] as const;

const EMPTY_FORM = {
  type: "SALARY_MIN_VES" as string,
  effectiveFrom: "",
  value: "",
  notes: "",
};

export default function LegalThresholdsPanel({
  companyId,
  initialThresholds,
  isAdmin,
  salMinStale,
}: Props) {
  const [thresholds, setThresholds] = useState<LegalThresholdRow[]>(initialThresholds);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
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
      if (!res.success) { setError(res.error); return; }
      setThresholds((prev) => prev.filter((t) => t.id !== id));
    });
  }

  const byType = Object.fromEntries(
    [...MONETARY_TYPES, ...PARAFISCAL_RATE_TYPES].map((t) => [
      t,
      thresholds.filter((r) => r.type === t),
    ])
  ) as Record<string, typeof thresholds>;

  // U-05: alerta si el salario mínimo no ha sido actualizado en más de 180 días
  const lastSalMin = byType["SALARY_MIN_VES"]?.[0];

  return (
    <div className="space-y-6">
      {salMinStale && (
        <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div className="space-y-1.5">
            <p className="font-semibold">
              Salario mínimo desactualizado — topes de cotización incorrectos
            </p>
            <p className="text-red-700">
              {lastSalMin
                ? `El último valor registrado (Bs. ${Number(lastSalMin.value).toLocaleString("es-VE", { minimumFractionDigits: 2 })}) es del ${new Date(lastSalMin.effectiveFrom).toLocaleDateString("es-VE", { timeZone: "UTC" })}.`
                : "No hay salario mínimo registrado."}{" "}
              Mientras no se actualice, los topes de cotización usados son:
            </p>
            {lastSalMin && (
              <ul className="mt-1 space-y-0.5 text-xs font-mono text-red-700">
                <li>· IVSS obrero (4%): base máx. Bs {(Number(lastSalMin.value) * 5).toLocaleString("es-VE", { minimumFractionDigits: 2 })} (5 × salMin)</li>
                <li>· INCES obrero (0,5%): base máx. Bs {(Number(lastSalMin.value) * 5).toLocaleString("es-VE", { minimumFractionDigits: 2 })} (5 × salMin)</li>
                <li>· FAOV/Banavih obrero (1%): base máx. Bs {(Number(lastSalMin.value) * 10).toLocaleString("es-VE", { minimumFractionDigits: 2 })} (10 × salMin)</li>
              </ul>
            )}
            <p className="text-red-700">
              Esto genera <strong>subpagos a los organismos fiscales</strong>. Verifica el decreto vigente en{" "}
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
          </div>
        </div>
      )}
      {/* Tabla — valores monetarios */}
      {MONETARY_TYPES.map((type) => (
        <div key={type} className="border rounded-lg overflow-hidden">
          <div className="bg-muted px-4 py-2 font-medium text-sm">{TYPE_LABELS[type]}</div>
          {byType[type].length === 0 ? (
            <p className="text-sm text-muted-foreground px-4 py-3">
              Sin registros. Agrega el valor actual para que el motor de nómina aplique el tope correcto.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th scope="col" className="text-left px-4 py-2">Vigente desde</th>
                  <th scope="col" className="text-right px-4 py-2">Valor (Bs)</th>
                  <th scope="col" className="text-left px-4 py-2">Notas</th>
                  {isAdmin && <th scope="col" className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {byType[type].map((t) => (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-mono">{t.effectiveFrom}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {Number(t.value).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{t.notes ?? "—"}</td>
                    {isAdmin && (
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => handleDelete(t.id)} disabled={isPending}
                          className="text-red-500 hover:text-red-700 text-xs disabled:opacity-50">
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
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-muted px-4 py-2 font-medium text-sm flex items-center justify-between">
          <span>Alícuotas parafiscales (%)</span>
          <span className="text-xs font-normal text-muted-foreground">
            Valor en %; sin registro = default legal vigente
          </span>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th scope="col" className="text-left px-4 py-2">Organismo</th>
              <th scope="col" className="text-right px-4 py-2">Default</th>
              <th scope="col" className="text-right px-4 py-2">Vigente (desde)</th>
              {isAdmin && <th scope="col" className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {PARAFISCAL_RATE_TYPES.map((type) => {
              const latest = byType[type]?.[0];
              return (
                <tr key={type} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2">{TYPE_LABELS[type]}</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                    {TYPE_DEFAULTS[type]}%
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {latest
                      ? <span className="font-semibold text-blue-700">{Number(latest.value).toFixed(2)}% <span className="text-xs font-normal text-muted-foreground">desde {latest.effectiveFrom}</span></span>
                      : <span className="text-muted-foreground text-xs">usando default</span>}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-2 text-right">
                      {latest && (
                        <button onClick={() => handleDelete(latest.id)} disabled={isPending}
                          className="text-red-500 hover:text-red-700 text-xs disabled:opacity-50">
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
        <form onSubmit={handleAdd} className="border rounded-lg p-4 space-y-4">
          <h2 className="font-medium text-sm">Agregar nuevo tope</h2>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Tipo</label>
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
                className="w-full border rounded px-3 py-2 text-sm bg-white"
              >
                <optgroup label="Valores monetarios">
                  <option value="SALARY_MIN_VES">Salario Mínimo (Bs)</option>
                  <option value="UT_VALUE">Unidad Tributaria (Bs)</option>
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
                </optgroup>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Vigente desde</label>
              <input
                type="date"
                name="effectiveFrom"
                value={form.effectiveFrom}
                onChange={handleChange}
                required
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {RATE_TYPES.has(form.type) ? "Alícuota (%)" : "Valor (Bs)"}
              </label>
              <div className="relative">
                <input
                  type="text"
                  name="value"
                  value={form.value}
                  onChange={handleChange}
                  placeholder={RATE_TYPES.has(form.type)
                    ? `Ej: ${TYPE_DEFAULTS[form.type] ?? "4.00"}`
                    : "Ej: 130.00"}
                  required
                  className="w-full border rounded px-3 py-2 text-sm font-mono pr-8"
                />
                {RATE_TYPES.has(form.type) && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                )}
              </div>
              {RATE_TYPES.has(form.type) && (
                <p className="text-xs text-muted-foreground">
                  Default actual: {TYPE_DEFAULTS[form.type]}% — solo registra si hay un decreto que modifique la alícuota.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Notas / Gaceta Oficial (opcional)</label>
              <input
                type="text"
                name="notes"
                value={form.notes}
                onChange={handleChange}
                placeholder="Ej: Decreto 5.163 Gaceta Oficial 43.050"
                maxLength={200}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? "Guardando…" : "Agregar"}
          </button>
        </form>
      )}
    </div>
  );
}
