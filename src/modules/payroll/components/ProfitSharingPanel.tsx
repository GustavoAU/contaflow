"use client";
// src/modules/payroll/components/ProfitSharingPanel.tsx
// Fase NOM-D: Panel de utilidades por empleado (cálculo + historial)

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { calculateProfitSharingAction } from "../actions/nom-d.actions";
import type { ProfitSharingRecordRow } from "../services/ProfitSharingService";

function fmt(v: string | number) {
  return Number(v).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  companyId: string;
  employeeId: string;
  initialRecords: ProfitSharingRecordRow[];
  canAdmin?: boolean;
}

const currentYear = new Date().getFullYear();

export default function ProfitSharingPanel({ companyId, employeeId, initialRecords, canAdmin }: Props) {
  const [records, setRecords] = useState<ProfitSharingRecordRow[]>(initialRecords);
  const [showForm, setShowForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    fiscalYear: currentYear - 1,
    periodStart: "",
    periodEnd: "",
  });

  const alreadyExistsForYear = records.some((r) => r.fiscalYear === form.fiscalYear);

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const payload = {
        fiscalYear: form.fiscalYear,
      };
      const result = await calculateProfitSharingAction(companyId, employeeId, payload);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setRecords((prev) => [result.data, ...prev]);
      setShowForm(false);
      setForm({ fiscalYear: currentYear - 1, periodStart: "", periodEnd: "" });
    });
  }

  return (
    <div className="space-y-3">
      {/* Historial */}
      {records.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium text-gray-600">Año fiscal</th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">Días base</th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">Días calc.</th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">Meses</th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">Salario prom.</th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">Monto</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-gray-600">Tipo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {records.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">{r.fiscalYear}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(r.profitDays)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(r.fractionalDays)}</td>
                  <td className="px-3 py-2 text-right">{r.monthsWorked}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-600">{fmt(r.baseSalarySnapshot)}</td>
                  <td className="px-3 py-2 text-right font-mono text-green-700">{fmt(r.profitAmount)}</td>
                  <td className="px-3 py-2">
                    {r.isFractional ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Fraccionada</span>
                    ) : (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">Completa</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-gray-400 italic">Sin utilidades registradas</p>
      )}

      {/* Botón + formulario */}
      {canAdmin && !showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 transition-colors border border-green-200"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Calcular utilidades
        </button>
      )}

      {canAdmin && showForm && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-3">
          <p className="text-xs font-semibold text-green-800 uppercase tracking-wide">
            Calcular utilidades (Art. 131–132 LOTTT)
          </p>
          <p className="text-xs text-gray-500">
            Los días de utilidades y el salario base se toman de la configuración de nómina y el historial salarial del empleado.
          </p>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Año fiscal</label>
            <input
              type="number"
              value={form.fiscalYear}
              onChange={(e) => setForm((f) => ({ ...f, fiscalYear: Number(e.target.value) }))}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>

          {alreadyExistsForYear && (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Ya existe un cálculo de utilidades para el año fiscal {form.fiscalYear}. Solo se permite un registro por ejercicio fiscal.
            </p>
          )}

          {error && (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null); }}
              className="rounded border px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending || alreadyExistsForYear}
              className="rounded bg-green-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Calculando..." : "Confirmar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
