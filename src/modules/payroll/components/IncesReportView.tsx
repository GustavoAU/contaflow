// src/modules/payroll/components/IncesReportView.tsx
// Fase NOM-E: Vista de la Planilla INCES trimestral.
"use client";

import { useState, useTransition } from "react";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PeriodSelector } from "./PeriodSelector";
import { getIncesReportAction, exportIncesPdfAction } from "../actions/payroll-reports.actions";
import type { IncesReportData } from "../services/PayrollReportService";

const QUARTER_LABELS = ["", "I Trimestre", "II Trimestre", "III Trimestre", "IV Trimestre"];

function fmt(val: unknown): string {
  try { return parseFloat(String(val)).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  catch { return "0,00"; }
}

type Props = { companyId: string };

export function IncesReportView({ companyId }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.ceil((now.getMonth() + 1) / 3));
  const [data, setData] = useState<IncesReportData | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isPdf, startPdfTransition] = useTransition();

  function handleLoad() {
    startTransition(async () => {
      const res = await getIncesReportAction(companyId, year, quarter);
      if (res.success) setData(res.data);
      else toast.error(res.error);
    });
  }

  function handlePdf() {
    startPdfTransition(async () => {
      const res = await exportIncesPdfAction(companyId, year, quarter);
      if (res.success) {
        const blob = new Blob([Uint8Array.from(atob(res.buffer), (c) => c.charCodeAt(0))], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `INCES_${year}_Q${quarter}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <PeriodSelector mode="quarter" year={year} quarter={quarter}
          onChange={(y, q) => { setYear(y); setQuarter(q); setData(null); }} />
        <button onClick={handleLoad} disabled={isPending}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
          {isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Generar reporte
        </button>
        {data && (
          <button onClick={handlePdf} disabled={isPdf}
            className="flex items-center gap-2 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60">
            <Download className="h-4 w-4" />
            {isPdf ? "Generando PDF..." : "Descargar PDF"}
          </button>
        )}
      </div>

      {data && (
        <div className="space-y-4">
          <div className="rounded-lg border bg-white">
            <div className="border-b px-4 py-3">
              <h3 className="font-semibold text-zinc-800">INCES — {QUARTER_LABELS[data.quarter]} {data.year}</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Ley INCES Art. 30: 2% trabajadores + 0.5% patrono sobre utilidades</p>
            </div>
            {data.rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-zinc-400">Sin empleados activos.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-xs text-zinc-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Empleado</th>
                      <th className="px-4 py-2 text-left">Cédula</th>
                      <th className="px-4 py-2 text-right">Salario Trim.</th>
                      <th className="px-4 py-2 text-right">INCES Obrero (2%)</th>
                      <th className="px-4 py-2 text-right">Utilidades año</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {data.rows.map((row) => (
                      <tr key={row.employeeId} className="hover:bg-zinc-50">
                        <td className="px-4 py-2 font-medium">{row.lastName}, {row.firstName}</td>
                        <td className="px-4 py-2 text-zinc-600">{row.cedulaType}-{row.cedulaNumber}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmt(row.salaryBase)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmt(row.incesWorkerAmount)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmt(row.profitAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-zinc-100 font-semibold">
                    <tr>
                      <td className="px-4 py-2" colSpan={3}>TOTALES</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(data.totalWorkerAmount)}</td>
                      <td className="px-4 py-2 text-right tabular-nums"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Resumen patronal */}
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm">
            <p className="font-medium text-blue-800 mb-1">Aporte Patronal INCES</p>
            <div className="flex justify-between text-blue-700">
              <span>0.5% sobre utilidades del año</span>
              <span className="font-mono font-semibold">Bs. {fmt(data.totalEmployerProfitContrib)}</span>
            </div>
            <div className="flex justify-between font-bold text-blue-900 border-t border-blue-200 mt-2 pt-2">
              <span>Total del período (obreros + patrono)</span>
              <span className="font-mono">Bs. {fmt(data.totalAmount)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
