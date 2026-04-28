"use client";
// src/modules/payroll/components/VacationPanel.tsx
// Fase NOM-D: Panel de vacaciones por empleado (registro + historial)

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { createVacationAction } from "../actions/nom-d.actions";
import type { VacationRecordRow } from "../services/VacationService";

function fmt(v: string | number) {
  return Number(v).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  companyId: string;
  employeeId: string;
  initialRecords: VacationRecordRow[];
  canAdmin?: boolean;
}

const currentYear = new Date().getFullYear();

export default function VacationPanel({ companyId, employeeId, initialRecords, canAdmin }: Props) {
  const [records, setRecords] = useState<VacationRecordRow[]>(initialRecords);
  const [showForm, setShowForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    periodYear: currentYear,
    vacationDays: 15,
    bonusDays: 7,
    startDate: "",
    endDate: "",
    isFractional: false,
  });

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await createVacationAction(companyId, employeeId, form);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setRecords((prev) => [result.data, ...prev]);
      setShowForm(false);
      setForm({ periodYear: currentYear, vacationDays: 15, bonusDays: 7, startDate: "", endDate: "", isFractional: false });
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
                <th className="px-3 py-2 text-left font-medium text-gray-600">Año</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Días vac.</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Días bono</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Monto vac.</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Monto bono</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Período</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Tipo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {records.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">{r.periodYear}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(r.vacationDays)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(r.bonusDays)}</td>
                  <td className="px-3 py-2 text-right font-mono text-green-700">{fmt(r.vacationAmount)}</td>
                  <td className="px-3 py-2 text-right font-mono text-green-700">{fmt(r.bonusAmount)}</td>
                  <td className="px-3 py-2 text-gray-500">{r.startDate} → {r.endDate}</td>
                  <td className="px-3 py-2">
                    {r.isFractional ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Fraccionada</span>
                    ) : (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">Completa</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-gray-400 italic">Sin vacaciones registradas</p>
      )}

      {/* Botón + formulario */}
      {canAdmin && !showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors border border-blue-200"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Registrar vacaciones
        </button>
      )}

      {canAdmin && showForm && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
          <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">
            Registrar vacaciones (Art. 190–192 LOTTT)
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Año período</label>
              <input
                type="number"
                value={form.periodYear}
                onChange={(e) => setForm((f) => ({ ...f, periodYear: Number(e.target.value) }))}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isFractional}
                  onChange={(e) => setForm((f) => ({ ...f, isFractional: e.target.checked }))}
                  className="accent-blue-600"
                />
                Fraccionadas
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Días de vacaciones</label>
              <input
                type="number"
                min={1}
                max={90}
                value={form.vacationDays}
                onChange={(e) => setForm((f) => ({ ...f, vacationDays: Number(e.target.value) }))}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Días bono vacacional</label>
              <input
                type="number"
                min={0}
                max={90}
                value={form.bonusDays}
                onChange={(e) => setForm((f) => ({ ...f, bonusDays: Number(e.target.value) }))}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Fecha inicio</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Fecha fin</label>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

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
              disabled={isPending || !form.startDate || !form.endDate}
              className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Registrando..." : "Confirmar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
