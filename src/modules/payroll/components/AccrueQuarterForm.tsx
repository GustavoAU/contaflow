"use client";
// src/modules/payroll/components/AccrueQuarterForm.tsx
// Fase NOM-D: Acumulación trimestral de prestaciones sociales (Art. 142 LOTTT)

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { accrueQuarterAction } from "../actions/nom-d.actions";

interface Props {
  companyId: string;
}

export default function AccrueQuarterForm({ companyId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState(Math.ceil((new Date().getMonth() + 1) / 3));
  const [result, setResult] = useState<{ employeesProcessed: number; totalAccrued: string } | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm(
      `¿Ejecutar acumulación trimestral Q${quarter}-${year}? Esta acción registrará prestaciones sociales para todos los empleados activos.`
    )) return;

    setResult(null);
    startTransition(async () => {
      const res = await accrueQuarterAction(companyId, { year, quarter });
      if (res.success) {
        setResult(res.data);
        toast.success(
          `Acumulación Q${quarter}-${year} completada: ${res.data.employeesProcessed} empleados`
        );
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Año</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            min={2000}
            max={2099}
            className="w-24 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Trimestre</label>
          <select
            value={quarter}
            onChange={(e) => setQuarter(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={1}>Q1 (Ene–Mar)</option>
            <option value={2}>Q2 (Abr–Jun)</option>
            <option value={3}>Q3 (Jul–Sep)</option>
            <option value={4}>Q4 (Oct–Dic)</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Procesando…" : "Ejecutar acumulación"}
        </button>
      </form>

      {result && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm">
          <p className="font-medium text-green-800">Acumulación completada</p>
          <p className="text-green-700 mt-1">
            Empleados procesados: <span className="font-mono font-semibold">{result.employeesProcessed}</span>
            &nbsp;·&nbsp;
            Total acumulado: <span className="font-mono font-semibold">
              {Number(result.totalAccrued).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
