// src/components/invoices/InvoiceBook.tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { getInvoiceBookAction, exportInvoiceBookPDFAction } from "@/modules/invoices/actions/invoice.actions";
import type { InvoiceBookResult, InvoiceBookRow } from "@/modules/invoices/services/InvoiceService";
import * as XLSX from "xlsx";

type Props = {
  companyId: string;
  companyName: string;
  defaultType?: "SALE" | "PURCHASE";
};

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const TAX_LINE_LABELS: Record<string, string> = {
  IVA_GENERAL: "IVA General",
  IVA_REDUCIDO: "IVA Reducido",
  IVA_ADICIONAL: "IVA Adicional",
  EXENTO: "Exento",
};

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

export function InvoiceBook({ companyId, companyName, defaultType = "PURCHASE" }: Props) {
  const [isPending, startTransition] = useTransition();
  const [isPendingPDF, startTransitionPDF] = useTransition();
  const [type, setType] = useState<"SALE" | "PURCHASE">(defaultType);
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [result, setResult] = useState<InvoiceBookResult | null>(null);

  function handleSearch() {
    startTransition(async () => {
      const res = await getInvoiceBookAction({ companyId, type, year, month });
      if (res.success) {
        setResult(res.data);
      } else {
        toast.error(res.error);
      }
    });
  }

  function handleExportPDF() {
    startTransitionPDF(async () => {
      const result = await exportInvoiceBookPDFAction({ companyId, type, year, month });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const blob = new Blob([new Uint8Array(result.buffer)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `libro-${type === "SALE" ? "ventas" : "compras"}-${year}-${String(month).padStart(2, "0")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function handleExportExcel() {
    if (!result) return;

    const bookName = type === "SALE" ? "Libro de Ventas" : "Libro de Compras";
    const period = `${MONTHS[month - 1]} ${year}`;

    const headerRows = [[companyName], [bookName], [period], []];

    const colHeaders = [
      "Fecha",
      type === "PURCHASE" ? "Proveedor" : "Cliente",
      "RIF",
      "N° Factura",
      "N° Control",
      "Tipo Doc",
      "Categoría",
      "N° Doc Rel.",
      ...(type === "PURCHASE" ? ["N° Planilla Imp."] : []),
      "Impuesto",
      "Base Imponible",
      "Tasa %",
      "Monto IVA",
      "IVA Retenido",
      "Comprobante IVA",
      ...(type === "PURCHASE" ? ["ISLR Retenido"] : []),
      ...(type === "SALE" ? ["Base IGTF", "Monto IGTF"] : []),
    ];

    // Expandir cada factura por sus taxLines
    const dataRows: (string | number)[][] = [];
    result.rows.forEach((row: InvoiceBookRow) => {
      if (row.taxLines.length === 0) {
        dataRows.push([
          new Date(row.date).toLocaleDateString("es-VE"),
          row.counterpartName,
          row.counterpartRif,
          row.invoiceNumber,
          row.controlNumber ?? "",
          row.docType,
          row.taxCategory,
          row.relatedDocNumber ?? "",
          ...(type === "PURCHASE" ? [row.importFormNumber ?? ""] : []),
          "—",
          "",
          "",
          "",
          row.ivaRetentionAmount,
          row.ivaRetentionVoucher ?? "",
          ...(type === "PURCHASE" ? [row.islrRetentionAmount] : []),
          ...(type === "SALE" ? [row.igtfBase, row.igtfAmount] : []),
        ]);
      } else {
        row.taxLines.forEach((line, idx) => {
          dataRows.push([
            idx === 0 ? new Date(row.date).toLocaleDateString("es-VE") : "",
            idx === 0 ? row.counterpartName : "",
            idx === 0 ? row.counterpartRif : "",
            idx === 0 ? row.invoiceNumber : "",
            idx === 0 ? (row.controlNumber ?? "") : "",
            idx === 0 ? row.docType : "",
            idx === 0 ? row.taxCategory : "",
            idx === 0 ? (row.relatedDocNumber ?? "") : "",
            ...(type === "PURCHASE" ? [idx === 0 ? (row.importFormNumber ?? "") : ""] : []),
            TAX_LINE_LABELS[line.taxType] ?? line.taxType,
            line.base,
            line.rate,
            line.amount,
            idx === 0 ? row.ivaRetentionAmount : "",
            idx === 0 ? (row.ivaRetentionVoucher ?? "") : "",
            ...(type === "PURCHASE" ? [idx === 0 ? row.islrRetentionAmount : ""] : []),
            ...(type === "SALE"
              ? [idx === 0 ? row.igtfBase : "", idx === 0 ? row.igtfAmount : ""]
              : []),
          ]);
        });
      }
    });

    const s = result.summary;
    const totalRow = [
      "TOTALES",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      ...(type === "PURCHASE" ? [""] : []),
      "",
      s.totalBaseGeneral,
      "",
      s.totalIvaGeneral,
      s.totalIvaRetention,
      "",
      ...(type === "PURCHASE" ? [s.totalIslrRetention] : []),
      ...(type === "SALE" ? ["", s.totalIgtf] : []),
    ];

    const wsData = [...headerRows, colHeaders, ...dataRows, [], totalRow];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, bookName.substring(0, 31));
    XLSX.writeFile(wb, `${bookName} - ${period}.xlsx`);
  }

  const bookTitle = type === "SALE" ? "Libro de Ventas" : "Libro de Compras";

  return (
    <>
      <div className="space-y-6">
        {/* Controles */}
        <div className="rounded-lg border bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">Libro</label>
              <div className="flex rounded-lg border p-1">
                {(["PURCHASE", "SALE"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setType(t);
                      setResult(null);
                    }}
                    className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                      type === t ? "bg-blue-600 text-white" : "text-zinc-600 hover:bg-zinc-100"
                    }`}
                  >
                    {t === "PURCHASE" ? "Compras" : "Ventas"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">Mes</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                {MONTHS.map((m, i) => (
                  <option key={i + 1} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">Año</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <Button onClick={handleSearch} disabled={isPending}>
              {isPending ? "Cargando..." : "Consultar"}
            </Button>

            {result && result.rows.length > 0 && (
              <>
                <Button variant="outline" onClick={handleExportExcel}>
                  Exportar Excel
                </Button>
                <Button
                  variant="outline"
                  onClick={handleExportPDF}
                  disabled={isPendingPDF || isPending}
                  className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                  aria-label="Exportar libro como PDF"
                >
                  {isPendingPDF ? "Generando PDF..." : "Exportar PDF"}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Tabla */}
        {result && (
          <div className="rounded-lg border bg-white">
            <div className="border-b px-6 py-4">
              <h2 className="font-semibold">{bookTitle}</h2>
              <p className="text-sm text-zinc-500">
                {MONTHS[month - 1]} {year} — {result.rows.length} factura(s)
              </p>
            </div>

            {result.rows.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-zinc-400">
                  No hay facturas registradas para este período
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Fecha</th>
                      <th className="px-4 py-3 text-left">
                        {type === "PURCHASE" ? "Proveedor" : "Cliente"}
                      </th>
                      <th className="px-4 py-3 text-left">RIF</th>
                      <th className="px-4 py-3 text-left">N° Factura</th>
                      <th className="px-4 py-3 text-left">N° Control</th>
                      <th className="px-4 py-3 text-left">Impuesto</th>
                      <th className="px-4 py-3 text-right">Base</th>
                      <th className="px-4 py-3 text-right">Tasa %</th>
                      <th className="px-4 py-3 text-right">IVA</th>
                      <th className="px-4 py-3 text-right">IVA Ret.</th>
                      {type === "PURCHASE" && <th className="px-4 py-3 text-right">ISLR Ret.</th>}
                      {type === "SALE" && <th className="px-4 py-3 text-right">IGTF</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {result.rows.map((row) =>
                      row.taxLines.length === 0 ? (
                        <tr key={row.id} className="hover:bg-zinc-50">
                          <td className="px-4 py-3 whitespace-nowrap">
                            {new Date(row.date).toLocaleDateString("es-VE")}
                          </td>
                          <td className="px-4 py-3">{row.counterpartName}</td>
                          <td className="px-4 py-3 font-mono text-xs">{row.counterpartRif}</td>
                          <td className="px-4 py-3 font-mono text-xs">{row.invoiceNumber}</td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {row.controlNumber ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-zinc-400">—</td>
                          <td className="px-4 py-3 text-right font-mono">—</td>
                          <td className="px-4 py-3 text-right font-mono">—</td>
                          <td className="px-4 py-3 text-right font-mono">—</td>
                          <td className="px-4 py-3 text-right font-mono text-orange-700">
                            {row.ivaRetentionAmount}
                          </td>
                          {type === "PURCHASE" && (
                            <td className="px-4 py-3 text-right font-mono text-orange-700">
                              {row.islrRetentionAmount}
                            </td>
                          )}
                          {type === "SALE" && (
                            <td className="px-4 py-3 text-right font-mono text-yellow-700">
                              {row.igtfAmount}
                            </td>
                          )}
                        </tr>
                      ) : (
                        row.taxLines.map((line, idx) => (
                          <tr key={`${row.id}-${line.id}`} className="hover:bg-zinc-50">
                            <td className="px-4 py-3 whitespace-nowrap">
                              {idx === 0 ? new Date(row.date).toLocaleDateString("es-VE") : ""}
                            </td>
                            <td className="px-4 py-3">{idx === 0 ? row.counterpartName : ""}</td>
                            <td className="px-4 py-3 font-mono text-xs">
                              {idx === 0 ? row.counterpartRif : ""}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs">
                              {idx === 0 ? row.invoiceNumber : ""}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs">
                              {idx === 0 ? (row.controlNumber ?? "—") : ""}
                            </td>
                            <td className="px-4 py-3">
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                                {TAX_LINE_LABELS[line.taxType] ?? line.taxType}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono">{line.base}</td>
                            <td className="px-4 py-3 text-right font-mono">{line.rate}%</td>
                            <td className="px-4 py-3 text-right font-mono">{line.amount}</td>
                            <td className="px-4 py-3 text-right font-mono text-orange-700">
                              {idx === 0 ? row.ivaRetentionAmount : ""}
                            </td>
                            {type === "PURCHASE" && (
                              <td className="px-4 py-3 text-right font-mono text-orange-700">
                                {idx === 0 ? row.islrRetentionAmount : ""}
                              </td>
                            )}
                            {type === "SALE" && (
                              <td className="px-4 py-3 text-right font-mono text-yellow-700">
                                {idx === 0 ? row.igtfAmount : ""}
                              </td>
                            )}
                          </tr>
                        ))
                      )
                    )}
                  </tbody>

                  {/* Totales */}
                  <tfoot className="bg-zinc-50 font-semibold">
                    <tr>
                      <td colSpan={6} className="px-4 py-3 text-right text-xs text-zinc-500">
                        TOTALES
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {result.summary.totalBaseGeneral}
                      </td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3 text-right font-mono">
                        {result.summary.totalIvaGeneral}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-orange-700">
                        {result.summary.totalIvaRetention}
                      </td>
                      {type === "PURCHASE" && (
                        <td className="px-4 py-3 text-right font-mono text-orange-700">
                          {result.summary.totalIslrRetention}
                        </td>
                      )}
                      {type === "SALE" && (
                        <td className="px-4 py-3 text-right font-mono text-yellow-700">
                          {result.summary.totalIgtf}
                        </td>
                      )}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <Toaster richColors position="top-right" />
    </>
  );
}
