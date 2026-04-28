"use client";
// src/modules/payroll/components/SalaryHistoryPanel.tsx
// Fase NOM-B: historial de salarios + formulario de nuevo salario (ADMIN_ONLY)

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { addSalaryAction } from "../actions/employee.actions";
import type { SalaryHistoryRow } from "../services/EmployeeService";

interface Props {
  companyId: string;
  employeeId: string;
  history: SalaryHistoryRow[];
  canWrite: boolean;
}

export default function SalaryHistoryPanel({
  companyId,
  employeeId,
  history,
  canWrite,
}: Props) {
  const [rows, setRows] = useState<SalaryHistoryRow[]>(history);
  const [showForm, setShowForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    effectiveFrom: "",
    amount: "",
    currency: "VES" as "VES" | "USD" | "MIXED",
  });

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      const result = await addSalaryAction(companyId, employeeId, form);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setRows((prev) => [result.data, ...prev]);
      setShowForm(false);
      setForm({ effectiveFrom: "", amount: "", currency: "VES" });
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Historial de salarios</h3>
        {canWrite && !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
          >
            + Nuevo salario
          </button>
        )}
      </div>

      {showForm && (
        <div className="rounded border bg-blue-50 p-4 space-y-3">
          <p className="text-xs font-medium text-blue-800">Agregar cambio de salario</p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-xs text-gray-600">Vigente desde *</label>
              <input
                type="date"
                value={form.effectiveFrom}
                onChange={(e) => setForm((p) => ({ ...p, effectiveFrom: e.target.value }))}
                className="w-full rounded border px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Monto *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                className="w-full rounded border px-2 py-1.5 text-sm"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Moneda *</label>
              <select
                value={form.currency}
                onChange={(e) =>
                  setForm((p) => ({ ...p, currency: e.target.value as typeof form.currency }))
                }
                className="w-full rounded border px-2 py-1.5 text-sm"
              >
                <option value="VES">VES</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>
          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAdd}
              disabled={isPending}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Guardando..." : "Guardar"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded border px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 italic">Sin historial de salarios.</p>
      ) : (
        <div className="overflow-hidden rounded border">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                  Vigente desde
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Monto</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Moneda</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {rows.map((row, i) => (
                <tr key={row.id} className={i === 0 ? "font-medium" : ""}>
                  <td className="px-4 py-2">
                    {row.effectiveFrom}
                    {i === 0 && (
                      <span className="ml-2 rounded-full bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-800">
                        Actual
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {Number(row.amount).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{row.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
