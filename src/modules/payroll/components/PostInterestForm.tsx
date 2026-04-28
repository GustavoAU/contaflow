"use client";
// src/modules/payroll/components/PostInterestForm.tsx
// Fase NOM-D: Intereses sobre prestaciones (Art. 143 LOTTT)
// CRITICAL-3: NO recibe tasa — BenefitAccrualService.postBenefitInterest lee BcvBenefitRate

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { postBenefitInterestAction } from "../actions/nom-d.actions";

interface Props {
  companyId: string;
}

export default function PostInterestForm({ companyId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [result, setResult] = useState<{ employeesProcessed: number; totalInterest: string } | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const monthName = [
      "enero", "febrero", "marzo", "abril", "mayo", "junio",
      "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
    ][month - 1];
    if (!window.confirm(
      `¿Registrar intereses sobre prestaciones de ${monthName} ${year}? Se usará la tasa BCV registrada para ese mes.`
    )) return;

    setResult(null);
    startTransition(async () => {
      const res = await postBenefitInterestAction(companyId, { year, month });
      if (res.success) {
        setResult(res.data);
        toast.success(`Intereses ${monthName} ${year} registrados`);
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
          <label className="block text-xs font-medium text-gray-700 mb-1">Mes</label>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {[
              "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
              "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
            ].map((name, i) => (
              <option key={i + 1} value={i + 1}>{name}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Registrando…" : "Registrar intereses"}
        </button>
      </form>

      {result && (
        <div className="rounded-lg bg-purple-50 border border-purple-200 p-4 text-sm">
          <p className="font-medium text-purple-800">Intereses registrados</p>
          <p className="text-purple-700 mt-1">
            Empleados procesados: <span className="font-mono font-semibold">{result.employeesProcessed}</span>
            &nbsp;·&nbsp;
            Total intereses: <span className="font-mono font-semibold">
              {Number(result.totalInterest).toLocaleString("es-VE", { minimumFractionDigits: 4 })}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
