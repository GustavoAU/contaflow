"use client";
// src/modules/payroll/components/BcvRateForm.tsx
// Fase NOM-D: Formulario para registrar tasa BCV mensual (ADMIN_ONLY)
// CRITICAL-3: annualRate ingresada por el admin — NUNCA inferida del cliente

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createBcvRateAction } from "../actions/nom-d.actions";

interface Props {
  companyId: string;
  hasCurrentMonthRate?: boolean;
  hasPrevMonthRate?: boolean;
}

export default function BcvRateForm({ companyId, hasCurrentMonthRate, hasPrevMonthRate }: Props) {
  const [isPending, startTransition] = useTransition();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [annualRate, setAnnualRate] = useState("");
  // Bug encontrado en vivo (2026-09-06) + confirmado con contador: el aviso
  // oficial del BCV publica DOS tasas bajo el Art. 143 LOTTT — la "Activa"
  // pura (Cuarto Aparte, mora/litigios) y el "Promedio" entre activa y pasiva
  // (Tercer Aparte, interés sobre el saldo ACUMULADO de prestaciones — que es
  // justo lo que esta pantalla calcula). El default anterior era "ACTIVA",
  // que llevó a registrar 3 tasas de más de la empresa real con el tipo
  // equivocado (ninguna llegó a usarse para postear interés, así que no hubo
  // corrección que revertir — pero el default sesgaba a repetir el error).
  const [rateType, setRateType] = useState<"ACTIVA" | "PROMEDIO">("PROMEDIO");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createBcvRateAction(companyId, {
        year,
        month,
        annualRate: parseFloat(annualRate),
        rateType,
      });
      if (result.success) {
        toast.success("Tasa BCV registrada correctamente");
        setAnnualRate("");
      } else {
        toast.error(result.error);
      }
    });
  }

  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();
  const prevMon = curMonth === 1 ? 12 : curMonth - 1;
  const prevMonYear = curMonth === 1 ? curYear - 1 : curYear;
  const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {(hasCurrentMonthRate === false || hasPrevMonthRate === false) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <span className="font-semibold">Tasas faltantes: </span>
          {!hasPrevMonthRate && (
            <span className="inline-block mr-2 rounded bg-amber-100 px-1.5 py-0.5 font-mono">
              {MONTH_LABELS[prevMon - 1]}-{prevMonYear} sin tasa
            </span>
          )}
          {!hasCurrentMonthRate && (
            <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 font-mono">
              {MONTH_LABELS[curMonth - 1]}-{curYear} sin tasa
            </span>
          )}
          {" — "}Sin tasa registrada no se pueden calcular los intereses del período (Art. 143 LOTTT).
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
            placeholder="Ej. 17.50"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Tipo de tasa
          </label>
          <select
            value={rateType}
            onChange={(e) => setRateType(e.target.value as "ACTIVA" | "PROMEDIO")}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="PROMEDIO">Promedio (Tercer Aparte — interés sobre saldo acumulado)</option>
            <option value="ACTIVA">Activa (Cuarto Aparte — mora/litigios)</option>
          </select>
        </div>
      </div>
      <p className="text-xs text-gray-400">
        El aviso oficial del BCV publica dos tasas bajo el Art. 143 LOTTT: la <strong>Activa</strong> pura
        (Cuarto Aparte, para mora/litigios) y el <strong>Promedio</strong> entre activa y pasiva (Tercer
        Aparte). Esta pantalla calcula el interés sobre el <strong>saldo acumulado de prestaciones</strong>,
        que corresponde al Tercer Aparte — usar <strong>Promedio</strong>, confirmado con contador (2026-09).
      </p>
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
