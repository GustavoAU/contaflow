"use client";
// src/modules/payroll/components/BcvRateForm.tsx
// Fase NOM-D: Formulario para registrar tasa BCV mensual (ADMIN_ONLY)
// CRITICAL-3: annualRate ingresada por el admin — NUNCA inferida del cliente

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createBcvRateAction } from "../actions/nom-d.actions";

interface Props {
  companyId: string;
}

export default function BcvRateForm({ companyId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [annualRate, setAnnualRate] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createBcvRateAction(companyId, {
        year,
        month,
        annualRate: parseFloat(annualRate),
      });
      if (result.success) {
        toast.success("Tasa BCV registrada correctamente");
        setAnnualRate("");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Año</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            min={2000}
            max={2099}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Mes</label>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {[
              "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
              "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
            ].map((name, i) => (
              <option key={i + 1} value={i + 1}>{name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Tasa anual BCV (%)
          </label>
          <input
            type="number"
            value={annualRate}
            onChange={(e) => setAnnualRate(e.target.value)}
            min={0}
            max={500}
            step={0.01}
            placeholder="Ej: 17.50"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isPending ? "Registrando…" : "Registrar tasa BCV"}
      </button>
    </form>
  );
}
