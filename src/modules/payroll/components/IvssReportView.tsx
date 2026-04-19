// src/modules/payroll/components/IvssReportView.tsx
// Fase NOM-E: Vista de la Planilla IVSS mensual con descarga PDF.
"use client";

import { useState, useTransition } from "react";
import { Download, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PeriodSelector } from "./PeriodSelector";
import {
  getIvssReportAction,
  exportIvssPdfAction,
} from "../actions/payroll-reports.actions";
import type { IvssReportData } from "../services/PayrollReportService";

const MONTHS = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function fmt(val: unknown): string {
  try { return parseFloat(String(val)).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  catch { return "0,00"; }
}

type Props = { companyId: string };

export function IvssReportView({ companyId }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<IvssReportData | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isPdf, startPdfTransition] = useTransition();

  function handleLoad() {
    startTransition(async () => {
      const res = await getIvssReportAction(companyId, year, month);
      if (res.success) setData(res.data);
      else toast.error(res.error);
    });
  }

  function handlePdf() {
    startPdfTransition(async () => {
      const res = await exportIvssPdfAction(companyId, year, month);
      if (res.success) {
        const blob = new Blob([Uint8Array.from(atob(res.buffer), (c) => c.charCodeAt(0))], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `IVSS_${year}_${String(month).padStart(2, "0")}.pdf`;
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
        <PeriodSelector mode="month" year={year} month={month}
          onChange={(y, m) => { setYear(y); setMonth(m); setData(null); }} />
        <button
          onClick={handleLoad}
          disabled={isPending}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Generar reporte
        </button>
        {data && (
          <button
            onClick={handlePdf}
            disabled={isPdf}
            className="flex items-center gap-2 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {isPdf ? "Generando PDF..." : "Descargar PDF"}
          </button>
        )}
      </div>

      {data && (
        <div className="space-y-4">
          {!data.utCapApplied && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>Valor de la UT no configurado.</strong> El techo salarial IVSS (LSS Art. 62: 10 UT) no fue aplicado.
                Configure el valor en <strong>Configuración de Nómina → Valor de la UT</strong>.
              </span>
            </div>
          )}

          <div className="rounded-lg border bg-white">
            <div className="border-b px-4 py-3">
              <h3 className="font-semibold text-zinc-800">
                Planilla IVSS — {MONTHS[data.month]} {data.year}
              </h3>
              {data.utValue && (
                <p className="text-xs text-zinc-500 mt-0.5">Valor UT: Bs. {fmt(data.utValue)} · Techo: Bs. {fmt(parseFloat(data.utValue.toString()) * 10)}</p>
              )}
            </div>

            {data.rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-zinc-400">Sin empleados activos en el período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-xs text-zinc-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Empleado</th>
                      <th className="px-4 py-2 text-left">Cédula</th>
                      <th className="px-4 py-2 text-right">Semanas</th>
                      <th className="px-4 py-2 text-right">Salario Base</th>
                      <th className="px-4 py-2 text-right">IVSS Obrero (4%)</th>
                      <th className="px-4 py-2 text-right">IVSS Patronal (9%)</th>
                      <th className="px-4 py-2 text-right font-semibold">Total IVSS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {data.rows.map((row) => (
                      <tr key={row.employeeId} className="hover:bg-zinc-50">
                        <td className="px-4 py-2 font-medium">{row.lastName}, {row.firstName}</td>
                        <td className="px-4 py-2 text-zinc-600">{row.cedulaType}-{row.cedulaNumber}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{row.weeksWorked}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmt(row.salaryBase)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmt(row.ivssWorkerAmount)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmt(row.ivssEmployerAmount)}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold">{fmt(row.ivssTotalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-zinc-100 font-semibold text-zinc-800">
                    <tr>
                      <td className="px-4 py-2" colSpan={4}>TOTALES</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(data.totalWorkerAmount)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(data.totalEmployerAmount)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(data.totalAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
