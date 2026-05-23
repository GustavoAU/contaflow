// src/modules/payroll/components/ArcReportView.tsx
// Fase NOM-E: Vista del ARC/ISLR anual por empleado.
"use client";

import { useState, useTransition } from "react";
import { Download, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getArcReportAction, exportArcPdfAction } from "../actions/payroll-reports.actions";
import type { ArcReportData } from "../services/PayrollReportService";

function fmt(val: unknown): string {
  try { return parseFloat(String(val)).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  catch { return "0,00"; }
}

type Employee = { id: string; firstName: string; lastName: string };
type Props = { companyId: string; employees: Employee[] };

const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

export function ArcReportView({ companyId, employees }: Props) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [year, setYear] = useState(new Date().getFullYear() - 1); // ARC = año anterior
  const [data, setData] = useState<ArcReportData | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isPdf, startPdfTransition] = useTransition();

  function handleLoad() {
    if (!employeeId) return;
    startTransition(async () => {
      const res = await getArcReportAction(companyId, employeeId, year);
      if (res.success) setData(res.data);
      else toast.error(res.error);
    });
  }

  function handlePdf() {
    if (!employeeId) return;
    startPdfTransition(async () => {
      const res = await exportArcPdfAction(companyId, employeeId, year);
      if (res.success) {
        const blob = new Blob([Uint8Array.from(atob(res.buffer), (c) => c.charCodeAt(0))], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const emp = employees.find((e) => e.id === employeeId);
        a.download = `ARC_${year}_${emp?.lastName ?? "empleado"}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Controles */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">Empleado</label>
          <select
            value={employeeId}
            onChange={(e) => { setEmployeeId(e.target.value); setData(null); }}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-55"
          >
            {employees.length === 0 && <option value="">Sin empleados activos</option>}
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.lastName}, {emp.firstName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">Año fiscal</label>
          <select
            value={year}
            onChange={(e) => { setYear(Number(e.target.value)); setData(null); }}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button
          onClick={handleLoad}
          disabled={isPending || !employeeId}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Generar ARC
        </button>
        {data && (
          <button
            onClick={handlePdf}
            disabled={isPdf}
            className="flex items-center gap-2 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {isPdf ? "Generando PDF..." : "Descargar PDF (ARC)"}
          </button>
        )}
      </div>

      {/* Resultado */}
      {data && (
        <div className="space-y-4">
          {!data.utValue && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>Valor de la UT no configurado.</strong> El desgravamen (774 UT) y el ISLR no pueden calcularse.
                Configure el valor en <strong>Configuración de Nómina</strong>.
              </span>
            </div>
          )}

          {/* Header empleado */}
          <div className="rounded-lg border bg-white p-4">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Empleado</p>
            <p className="text-lg font-semibold">{data.employee.lastName}, {data.employee.firstName}</p>
            <p className="text-sm text-zinc-500">
              {data.employee.cedulaType}-{data.employee.cedulaNumber} · Empresa: {data.companyName} · Año: {data.year}
            </p>
          </div>

          {/* Ingresos */}
          <div className="rounded-lg border bg-white">
            <div className="border-b px-4 py-3 font-semibold text-zinc-800">Ingresos del Período</div>
            <div className="divide-y divide-zinc-100 text-sm">
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-zinc-600">Sueldos y Salarios (incl. Horas Extra)</span>
                <span className="tabular-nums">Bs. {fmt(data.totalEarnings)}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-zinc-600">Utilidades (Art. 131 LOTTT)</span>
                <span className="tabular-nums">Bs. {fmt(data.profitAmount)}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-zinc-600">Bono Vacacional (Art. 223 LOTTT)</span>
                <span className="tabular-nums">Bs. {fmt(data.vacationBonus)}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5 bg-zinc-50 font-semibold">
                <span>Total Ingresos Brutos</span>
                <span className="tabular-nums">Bs. {fmt(data.totalGrossIncome)}</span>
              </div>
            </div>
          </div>

          {/* Cálculo ISLR */}
          <div className="rounded-lg border bg-white">
            <div className="border-b px-4 py-3 font-semibold text-zinc-800">Cálculo ISLR — Decreto 1.808 (Tarifa 1)</div>
            <div className="divide-y divide-zinc-100 text-sm">
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-zinc-600">Total Ingresos Brutos</span>
                <span className="tabular-nums">Bs. {fmt(data.totalGrossIncome)}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-zinc-600">Desgravamen Único (774 UT — Art. 60 D.1808)</span>
                <span className="tabular-nums">
                  {data.utValue ? `Bs. ${fmt(data.desgravamen)}` : "— UT no configurada"}
                </span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-zinc-600">Enriquecimiento Neto Gravable</span>
                <span className="tabular-nums">Bs. {fmt(data.taxableIncome)}</span>
              </div>
              {data.utValue && (
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-zinc-600">Enriquecimiento Neto Gravable (en UT)</span>
                  <span className="tabular-nums">{fmt(data.taxableIncomeUT)} UT</span>
                </div>
              )}
              <div className="flex justify-between px-4 py-2.5 bg-zinc-50 font-semibold">
                <span>ISLR Calculado (Tarifa 1)</span>
                <span className="tabular-nums">Bs. {fmt(data.islrAmount)}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5 bg-blue-50 font-bold text-blue-800">
                <span>ISLR Retenido por la Empresa</span>
                <span className="tabular-nums">Bs. {fmt(data.withheldAmount)}</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-zinc-400">
            Este ARC es de carácter informativo para el empleado. Basado en ingresos reales del año {data.year} registrados en ContaFlow.
          </p>
        </div>
      )}
    </div>
  );
}
