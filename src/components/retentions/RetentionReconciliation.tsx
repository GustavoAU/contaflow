// src/components/retentions/RetentionReconciliation.tsx
// H-15: Vista de conciliación Retenciones ↔ Libro de Compras (Prov. 0049 Art. 11)
"use client";

import { useState, useTransition } from "react";
import { CheckCircle2Icon, XCircleIcon, AlertTriangleIcon, LinkIcon } from "lucide-react";
import { getRetentionReconciliationAction, type ReconciliationRow } from "@/modules/retentions/actions/retention.actions";

type Props = {
  companyId: string;
  defaultYear?: number;
  defaultMonth?: number;
};

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const STATUS_CFG: Record<ReconciliationRow["status"], { label: string; icon: React.ReactNode; className: string }> = {
  MATCHED:                  { label: "Coincide",               icon: <CheckCircle2Icon className="h-4 w-4" aria-hidden />, className: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  RETENTION_WITHOUT_INVOICE:{ label: "Sin factura",            icon: <AlertTriangleIcon className="h-4 w-4" aria-hidden />, className: "text-amber-700 bg-amber-50 border-amber-200" },
  INVOICE_WITHOUT_RETENTION:{ label: "Sin comprobante",        icon: <XCircleIcon className="h-4 w-4" aria-hidden />,       className: "text-red-700 bg-red-50 border-red-200" },
  MISMATCH:                 { label: "Descuadre de monto",     icon: <XCircleIcon className="h-4 w-4" aria-hidden />,       className: "text-red-700 bg-red-50 border-red-200" },
};

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

export function RetentionReconciliation({ companyId, defaultYear, defaultMonth }: Props) {
  const [year, setYear] = useState(defaultYear ?? currentYear);
  const [month, setMonth] = useState(defaultMonth ?? currentMonth);
  const [rows, setRows] = useState<ReconciliationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleLoad() {
    setError(null);
    startTransition(async () => {
      const result = await getRetentionReconciliationAction(companyId, year, month);
      if (result.success) {
        setRows(result.data);
      } else {
        setError(result.error);
      }
    });
  }

  const matched = rows?.filter((r) => r.status === "MATCHED").length ?? 0;
  const issues = rows ? rows.length - matched : 0;

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-600">Mes</label>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {MONTHS.map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-600">Año</label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={handleLoad}
          disabled={isPending}
          aria-busy={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
        >
          {isPending ? "Cargando…" : "Conciliar período"}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {rows !== null && (
        <>
          {/* Resumen */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800">
              <CheckCircle2Icon className="h-4 w-4" aria-hidden />
              {matched} conciliada(s)
            </div>
            {issues > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-800">
                <XCircleIcon className="h-4 w-4" aria-hidden />
                {issues} con alerta(s)
              </div>
            )}
            {rows.length === 0 && (
              <p className="text-sm text-zinc-500">No hay retenciones ni facturas con retención en este período.</p>
            )}
          </div>

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border bg-white">
              <table className="min-w-full text-sm border-separate border-spacing-0">
                <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
                  <tr className="[&>th]:border-b [&>th]:border-zinc-200">
                    <th scope="col" className="px-4 py-3 text-left whitespace-nowrap">Estado</th>
                    <th scope="col" className="px-4 py-3 text-left whitespace-nowrap">Comprobante RIVA</th>
                    <th scope="col" className="px-4 py-3 text-left whitespace-nowrap">Status ret.</th>
                    <th scope="col" className="px-4 py-3 text-left whitespace-nowrap">IVA Retenido (ret.)</th>
                    <th scope="col" className="px-4 py-3 text-left">
                      <span className="flex items-center gap-1">
                        <LinkIcon className="h-3.5 w-3.5" aria-hidden />
                        Factura Libro Compras
                      </span>
                    </th>
                    <th scope="col" className="px-4 py-3 text-left whitespace-nowrap">Proveedor</th>
                    <th scope="col" className="px-4 py-3 text-left whitespace-nowrap">IVA Ret. (factura)</th>
                    <th scope="col" className="px-4 py-3 text-left whitespace-nowrap">Comprobante (factura)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => {
                    const cfg = STATUS_CFG[row.status];
                    return (
                      <tr
                        key={idx}
                        className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
                            {cfg.icon}
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                          {row.voucherNumber ?? <span className="text-zinc-400">—</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {row.retentionStatus ? (
                            <span className={`rounded px-1.5 py-0.5 text-10 font-medium ${
                              row.retentionStatus === "ENTERADO"
                                ? "bg-emerald-50 text-emerald-700"
                                : row.retentionStatus === "PENDING"
                                ? "bg-amber-50 text-amber-700"
                                : "bg-zinc-100 text-zinc-600"
                            }`}>
                              {row.retentionStatus}
                            </span>
                          ) : <span className="text-zinc-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs whitespace-nowrap">
                          {row.retentionIvaRetention
                            ? `Bs. ${row.retentionIvaRetention}`
                            : <span className="text-zinc-400">—</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                          {row.invoiceNumber ?? <span className="text-zinc-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs max-w-48 truncate">
                          {row.counterpartName ?? (
                            <span className="text-zinc-400">{row.counterpartRif ?? "—"}</span>
                          )}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono text-xs whitespace-nowrap ${
                          row.status === "MISMATCH" ? "font-bold text-red-600" : ""
                        }`}>
                          {row.invoiceIvaRetentionAmount
                            ? `Bs. ${row.invoiceIvaRetentionAmount}`
                            : <span className="text-zinc-400">—</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                          {row.invoiceIvaRetentionVoucher ?? (
                            row.status === "INVOICE_WITHOUT_RETENTION"
                              ? <span className="text-red-500 text-xs font-medium">Sin comprobante</span>
                              : <span className="text-zinc-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {issues > 0 && (
            <p className="text-xs text-zinc-500">
              <strong>Nota:</strong> Las alertas deben resolverse antes de presentar la Forma 30. Una retención sin factura o una factura sin comprobante es una inconsistencia sancionable bajo COT Art. 102 y Prov. 0049 Art. 11.
            </p>
          )}
        </>
      )}
    </div>
  );
}
