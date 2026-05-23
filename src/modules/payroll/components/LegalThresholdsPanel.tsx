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
}

const TYPE_LABELS: Record<string, string> = {
  SALARY_MIN_VES: "Salario Mínimo (Bs/mes)",
  UT_VALUE: "Unidad Tributaria (Bs)",
};

const EMPTY_FORM = {
  type: "SALARY_MIN_VES" as const,
  effectiveFrom: "",
  value: "",
  notes: "",
};

export default function LegalThresholdsPanel({
  companyId,
  initialThresholds,
  isAdmin,
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

  const byType = {
    SALARY_MIN_VES: thresholds.filter((t) => t.type === "SALARY_MIN_VES"),
    UT_VALUE: thresholds.filter((t) => t.type === "UT_VALUE"),
  };

  return (
    <div className="space-y-6">
      {/* Tabla por tipo */}
      {(["SALARY_MIN_VES", "UT_VALUE"] as const).map((type) => (
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
                        <button
                          onClick={() => handleDelete(t.id)}
                          disabled={isPending}
                          className="text-red-500 hover:text-red-700 text-xs disabled:opacity-50"
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
                onChange={handleChange}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                <option value="SALARY_MIN_VES">Salario Mínimo</option>
                <option value="UT_VALUE">Unidad Tributaria</option>
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
              <label className="text-xs font-medium text-muted-foreground">Valor (Bs)</label>
              <input
                type="text"
                name="value"
                value={form.value}
                onChange={handleChange}
                placeholder="Ej: 130.00"
                required
                className="w-full border rounded px-3 py-2 text-sm font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Notas (opcional)</label>
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
