// src/modules/payroll/components/BanavihReportView.tsx
// Fase NOM-E: Vista de la Planilla Banavih/FAOV mensual.
"use client";

import { useState, useTransition } from "react";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PeriodSelector } from "./PeriodSelector";
import { getBanavihReportAction, exportBanavihPdfAction, exportBanavihExcelAction, exportBanavihTxtAction } from "../actions/payroll-reports.actions";
import type { BanavihReportData } from "../services/PayrollReportService";

const MONTHS = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function fmt(val: unknown): string {
  try { return parseFloat(String(val)).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  catch { return "0,00"; }
}

type Props = { companyId: string };

export function BanavihReportView({ companyId }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<BanavihReportData | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isPdf, startPdfTransition] = useTransition();
  const [isXls, startXlsTransition] = useTransition();
  const [isTxt, startTxtTransition] = useTransition();

  function handleLoad() {
    startTransition(async () => {
      const res = await getBanavihReportAction(companyId, year, month);
      if (res.success) setData(res.data);
      else toast.error(res.error);
    });
  }

  function handlePdf() {
    startPdfTransition(async () => {
      const res = await exportBanavihPdfAction(companyId, year, month);
      if (res.success) {
        const blob = new Blob([Uint8Array.from(atob(res.buffer), (c) => c.charCodeAt(0))], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Banavih_${year}_${String(month).padStart(2, "0")}.pdf`;
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
        <button onClick={handleLoad} disabled={isPending}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
          {isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Generar reporte
        </button>
        {data && (
          <>
            <button onClick={handlePdf} disabled={isPdf}
              className="flex items-center gap-2 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60">
              <Download className="h-4 w-4" />
              {isPdf ? "Generando..." : "PDF"}
            </button>
            <button onClick={() => startXlsTransition(async () => {
              const res = await exportBanavihExcelAction(companyId, year, month);
              if (res.success) {
                const blob = new Blob([Uint8Array.from(atob(res.buffer), (c) => c.charCodeAt(0))], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
                const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `FAOV_${year}_${String(month).padStart(2, "0")}.xlsx` });
                a.click();
              } else { toast.error(res.error); }
            })} disabled={isXls}
              className="flex items-center gap-2 rounded-md border border-green-300 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-60">
              <Download className="h-4 w-4" />
              {isXls ? "Generando..." : "Excel"}
            </button>
            <button onClick={() => startTxtTransition(async () => {
              const res = await exportBanavihTxtAction(companyId, year, month);
              if (res.success) {
                const blob = new Blob([res.txt], { type: "text/plain;charset=utf-8" });
                const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: res.filename });
                a.click();
              } else { toast.error(res.error); }
            })} disabled={isTxt}
              className="flex items-center gap-2 rounded-md border border-blue-300 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-60">
              <Download className="h-4 w-4" />
              {isTxt ? "Generando..." : "TXT BANAVIH"}
            </button>
          </>
        )}
      </div>

      {data && (
        <div className="rounded-lg border bg-white">
          <div className="border-b px-4 py-3">
            <h3 className="font-semibold text-zinc-800">Banavih / FAOV — {MONTHS[data.month]} {data.year}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">LAH Art. 172: 1% trabajador + 1% patronal</p>
          </div>
          {data.rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-400">Sin empleados activos.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-500">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left">Empleado</th>
                    <th scope="col" className="px-4 py-2 text-left">Cédula</th>
                    <th scope="col" className="px-4 py-2 text-right">Salario Base</th>
                    <th scope="col" className="px-4 py-2 text-right">FAOV Trabajador (1%)</th>
                    <th scope="col" className="px-4 py-2 text-right">FAOV Patronal (1%)</th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">Total FAOV</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {data.rows.map((row) => (
                    <tr key={row.employeeId} className="hover:bg-zinc-50">
                      <td className="px-4 py-2 font-medium">{row.lastName}, {row.firstName}</td>
                      <td className="px-4 py-2 text-zinc-600">{row.cedulaType}-{row.cedulaNumber}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(row.salaryBase)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(row.faovWorkerAmount)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(row.faovEmployerAmount)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{fmt(row.faovTotalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-zinc-100 font-semibold">
                  <tr>
                    <td className="px-4 py-2" colSpan={3}>TOTALES</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(data.totalWorkerAmount)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(data.totalEmployerAmount)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(data.totalAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
