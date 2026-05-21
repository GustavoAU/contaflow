// src/components/invoices/InvoiceBook.tsx
"use client";

import { useState, useTransition, useEffect } from "react";
import { Loader2Icon, InboxIcon, PlusIcon, ScanIcon } from "lucide-react";
import React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  getInvoiceBookAction,
  exportInvoiceBookPDFAction,
  exportInvoiceVoucherPDFAction,
} from "@/modules/invoices/actions/invoice.actions";
import type { InvoiceBookResult, InvoiceBookRow } from "@/modules/invoices/services/InvoiceService";
import { CreditDebitNotesPanel } from "@/components/invoices/CreditDebitNotesPanel";
import { MoneyBadge } from "@/components/ui/MoneyBadge";
import { fmtDate } from "@/lib/format";

type Props = {
  companyId: string;
  companyName: string;
  defaultType?: "SALE" | "PURCHASE";
  activePeriodMonth?: number;
  activePeriodYear?: number;
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

export function InvoiceBook({ companyId, companyName, defaultType = "PURCHASE", activePeriodMonth, activePeriodYear }: Props) {
  const [isPending, startTransition] = useTransition();
  const [isPendingPDF, startTransitionPDF] = useTransition();
  const [isPendingVoucher, startTransitionVoucher] = useTransition();
  const [pendingVoucherId, setPendingVoucherId] = useState<string | null>(null);
  const [type, setType] = useState<"SALE" | "PURCHASE">(defaultType);
  const [year, setYear] = useState(activePeriodYear ?? currentYear);
  const [month, setMonth] = useState(activePeriodMonth ?? currentMonth);
  const [result, setResult] = useState<InvoiceBookResult | null>(null);
  const [expandedNcNdId, setExpandedNcNdId] = useState<string | null>(null);

  useEffect(() => {
    startTransition(async () => {
      const res = await getInvoiceBookAction({ companyId, type, year, month });
      if (res.success) setResult(res.data);
      else toast.error(res.error);
    });
  }, [companyId, type, year, month]);

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

  function handleExportInvoiceVoucher(invoiceId: string, invoiceNumber: string) {
    setPendingVoucherId(invoiceId);
    startTransitionVoucher(async () => {
      const res = await exportInvoiceVoucherPDFAction(invoiceId, companyId);
      setPendingVoucherId(null);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      const blob = new Blob([new Uint8Array(res.buffer)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `factura-${invoiceNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  async function handleExportExcel() {
    if (!result) return;

    const bookName = type === "SALE" ? "Libro de Ventas" : "Libro de Compras";
    const period = `${MONTHS[month - 1]} ${year}`;

    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(bookName.substring(0, 31));

    ws.addRow([companyName]);
    ws.addRow([bookName]);
    ws.addRow([period]);
    ws.addRow([]);
    ws.addRow([
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
      "Total",
    ]);

    result.rows.forEach((row: InvoiceBookRow) => {
      if (row.taxLines.length === 0) {
        const rowTotalExcel = parseFloat(row.igtfAmount);
        ws.addRow([
          fmtDate(row.date),
          row.counterpartName,
          row.counterpartRif,
          row.invoiceNumber,
          row.controlNumber ?? "",
          row.docType,
          row.taxCategory,
          row.relatedDocNumber ?? "",
          ...(type === "PURCHASE" ? [row.importFormNumber ?? ""] : []),
          "—", "", "", "",
          row.ivaRetentionAmount,
          row.ivaRetentionVoucher ?? "",
          ...(type === "PURCHASE" ? [row.islrRetentionAmount] : []),
          ...(type === "SALE" ? [row.igtfBase, row.igtfAmount] : []),
          rowTotalExcel > 0 ? rowTotalExcel : "—",
        ]);
      } else {
        const rowTotalExcel = row.taxLines.reduce(
          (acc, l) => acc + parseFloat(l.base) + parseFloat(l.amount),
          0
        ) + parseFloat(row.igtfAmount);
        row.taxLines.forEach((line, idx) => {
          ws.addRow([
            idx === 0 ? fmtDate(row.date) : "",
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
            idx === 0 ? rowTotalExcel : "",
          ]);
        });
      }
    });

    const s = result.summary;
    ws.addRow([]);
    ws.addRow([
      "TOTALES", "", "", "", "", "", "", "",
      ...(type === "PURCHASE" ? [""] : []),
      "",
      s.totalBaseGeneral, "",
      s.totalIvaGeneral,
      s.totalIvaRetention, "",
      ...(type === "PURCHASE" ? [s.totalIslrRetention] : []),
      ...(type === "SALE" ? ["", s.totalIgtf] : []),
      result.rows.reduce((acc, row) => {
        return acc + row.taxLines.reduce((a, l) => a + parseFloat(l.base) + parseFloat(l.amount), 0) + parseFloat(row.igtfAmount);
      }, 0),
    ]);

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bookName} - ${period}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
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
                    onClick={() => { setType(t); setResult(null); }}
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

            {/* Loading indicator replaces the former "Consultar" button */}
            <div className="flex h-9 w-9 items-center justify-center" aria-live="polite" aria-label={isPending ? "Cargando datos…" : undefined}>
              {isPending && <Loader2Icon className="h-4 w-4 animate-spin text-zinc-400" aria-hidden />}
            </div>

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

        {/* Skeleton — visible while loading with no previous result */}
        {isPending && !result && (
          <div className="rounded-lg border bg-white">
            <div className="border-b px-6 py-4">
              <div className="h-5 w-44 animate-pulse rounded bg-zinc-100" />
              <div className="mt-1.5 h-3.5 w-32 animate-pulse rounded bg-zinc-100" />
            </div>
            <div className="divide-y divide-zinc-100">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-3.5">
                  <div className="h-3 w-20 animate-pulse rounded bg-zinc-100" />
                  <div className="h-3 w-36 animate-pulse rounded bg-zinc-100" />
                  <div className="h-3 w-24 animate-pulse rounded bg-zinc-100" />
                  <div className="h-3 w-16 animate-pulse rounded bg-zinc-100" />
                  <div className="ml-auto h-3 w-20 animate-pulse rounded bg-zinc-100" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabla */}
        {result && (
          <div className={`rounded-lg border bg-white transition-opacity ${isPending ? "pointer-events-none opacity-60" : ""}`}>
            <div className="border-b px-6 py-4">
              <h2 className="font-semibold">{bookTitle}</h2>
              <p className="text-sm text-zinc-500">
                {MONTHS[month - 1]} {year} — {result.rows.length} factura(s)
              </p>
            </div>

            {result.rows.length === 0 ? (
              <div className="flex flex-col items-center gap-4 px-5 py-12 text-center">
                <InboxIcon className="h-10 w-10 text-zinc-200" aria-hidden />
                <div>
                  <p className="text-sm font-medium text-zinc-500">
                    No hay facturas en {MONTHS[month - 1]} {year}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">
                    Registra o escanea una factura para que aparezca aquí.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/company/${companyId}/invoices/new`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Nueva Factura
                  </Link>
                  <Link
                    href={`/company/${companyId}/invoices/upload`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
                  >
                    <ScanIcon className="h-4 w-4" />
                    Escanear
                  </Link>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-separate border-spacing-0">
                  <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
                    <tr className="[&>th]:border-b [&>th]:border-zinc-200">
                      <th className="sticky left-0 z-10 bg-zinc-50 px-4 py-3 text-left w-25">Fecha</th>
                      <th className="sticky left-25 z-10 bg-zinc-50 px-4 py-3 text-left min-w-50">
                        {type === "PURCHASE" ? "Proveedor" : "Cliente"}
                      </th>
                      <th className="px-4 py-3 text-left">RIF</th>
                      <th className="px-4 py-3 text-left">N° Factura</th>
                      <th className="px-4 py-3 text-left">N° Control</th>
                      <th className="px-4 py-3 text-left"></th>
                      <th className="px-4 py-3 text-left">Impuesto</th>
                      <th className="px-4 py-3 text-right">Base</th>
                      <th className="px-4 py-3 text-right">Tasa %</th>
                      <th className="px-4 py-3 text-right">IVA</th>
                      <th className="px-4 py-3 text-right">IVA Ret.</th>
                      {type === "PURCHASE" && <th className="px-4 py-3 text-right">ISLR Ret.</th>}
                      {type === "SALE" && <th className="px-4 py-3 text-right">IGTF</th>}
                      <th className="px-4 py-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => {
                      const isFactura = row.docType === "FACTURA";
                      const ncNdOpen = expandedNcNdId === row.id;
                      const totalBase = row.taxLines.reduce((acc, l) => acc + parseFloat(l.base), 0);
                      const totalIva  = row.taxLines.reduce((acc, l) => acc + parseFloat(l.amount), 0);
                      const igtf = parseFloat(row.igtfAmount);
                      const rowTotal = totalBase + totalIva + igtf;


                      // Botón NC/ND solo para FACTURAs
                      const ncNdButton = isFactura ? (
                        <button
                          type="button"
                          onClick={() => setExpandedNcNdId(ncNdOpen ? null : row.id)}
                          title={ncNdOpen ? "Ocultar NC/ND" : "Ver Notas de Crédito/Débito vinculadas"}
                          className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${ncNdOpen ? "bg-purple-100 text-purple-700" : "text-purple-600 hover:bg-purple-50"}`}
                        >
                          NC/ND
                        </button>
                      ) : null;

                      const expansionRow = ncNdOpen ? (
                        <tr key={`ncnd-${row.id}`} className="bg-zinc-50">
                          <td colSpan={13} className="border-t p-0">
                            <CreditDebitNotesPanel companyId={companyId} invoiceId={row.id} />
                          </td>
                        </tr>
                      ) : null;

                      return (
                        <React.Fragment key={row.id}>
                          {row.taxLines.length === 0 ? (
                            <tr className="bg-white hover:bg-zinc-50 [&>td]:border-b [&>td]:border-zinc-100">
                              <td className="sticky left-0 z-10 bg-white px-4 py-3 whitespace-nowrap">
                                {fmtDate(row.date)}
                              </td>
                              <td className="sticky left-25 z-10 bg-white px-4 py-3 min-w-50"
                                  title={row.counterpartName}>
                                {row.counterpartName}
                              </td>
                              <td className="px-4 py-3 font-mono text-xs">{row.counterpartRif}</td>
                              <td className="px-4 py-3 font-mono text-xs">
                                <div className="flex flex-col gap-0.5">
                                  <span>{row.invoiceNumber}</span>
                                  {(row.docType === "NOTA_CREDITO" || row.docType === "NOTA_DEBITO") &&
                                    row.relatedDocNumber && (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                                        &#8594; Factura {row.relatedDocNumber}
                                      </span>
                                    )}
                                </div>
                              </td>
                              <td className="px-4 py-3 font-mono text-xs">
                                {row.controlNumber ?? "—"}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleExportInvoiceVoucher(row.id, row.invoiceNumber)}
                                    disabled={isPendingVoucher && pendingVoucherId === row.id}
                                    title="Descargar PDF de factura"
                                    className="rounded px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                                    aria-label={`Descargar PDF factura ${row.invoiceNumber}`}
                                  >
                                    {isPendingVoucher && pendingVoucherId === row.id ? "…" : "PDF"}
                                  </button>
                                  {ncNdButton}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-zinc-400">—</td>
                              <td className="px-4 py-3 text-right font-mono">—</td>
                              <td className="px-4 py-3 text-right font-mono">—</td>
                              <td className="px-4 py-3 text-right font-mono">—</td>
                              <td className="px-4 py-3 text-right font-mono text-orange-700">
                                Bs. {row.ivaRetentionAmount}
                              </td>
                              {type === "PURCHASE" && (
                                <td className="px-4 py-3 text-right font-mono text-orange-700">
                                  Bs. {row.islrRetentionAmount}
                                </td>
                              )}
                              {type === "SALE" && (
                                <td className="px-4 py-3 text-right font-mono text-yellow-700">
                                  Bs. {row.igtfAmount}
                                </td>
                              )}
                              <td className="px-4 py-3 text-right font-semibold">
                                {rowTotal > 0
                                  ? <MoneyBadge amount={rowTotal} currency="VES" exchangeRate={row.exchangeRate ?? undefined} />
                                  : "—"}
                              </td>
                            </tr>
                          ) : (
                            row.taxLines.map((line, idx) => (
                              <tr key={`${row.id}-${line.id}`} className="bg-white hover:bg-zinc-50 [&>td]:border-b [&>td]:border-zinc-100">
                            <td className="sticky left-0 z-10 bg-white px-4 py-3 whitespace-nowrap">
                              {idx === 0 ? fmtDate(row.date) : ""}
                            </td>
                            <td className="sticky left-25 z-10 bg-white px-4 py-3 min-w-50"
                                title={idx === 0 ? row.counterpartName : undefined}>
                              {idx === 0 ? row.counterpartName : ""}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs">
                              {idx === 0 ? row.counterpartRif : ""}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs">
                              {idx === 0 ? (
                                <div className="flex flex-col gap-0.5">
                                  <span>{row.invoiceNumber}</span>
                                  {(row.docType === "NOTA_CREDITO" || row.docType === "NOTA_DEBITO") &&
                                    row.relatedDocNumber && (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                                        &#8594; Factura {row.relatedDocNumber}
                                      </span>
                                    )}
                                </div>
                              ) : ""}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs">
                              {idx === 0 ? (row.controlNumber ?? "—") : ""}
                            </td>
                            <td className="px-4 py-3">
                              {idx === 0 && (
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleExportInvoiceVoucher(row.id, row.invoiceNumber)}
                                    disabled={isPendingVoucher && pendingVoucherId === row.id}
                                    title="Descargar PDF de factura"
                                    className="rounded px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                                    aria-label={`Descargar PDF factura ${row.invoiceNumber}`}
                                  >
                                    {isPendingVoucher && pendingVoucherId === row.id ? "…" : "PDF"}
                                  </button>
                                  {ncNdButton}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                                {TAX_LINE_LABELS[line.taxType] ?? line.taxType}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <MoneyBadge amount={line.base} currency="VES" exchangeRate={row.exchangeRate ?? undefined} />
                            </td>
                            <td className="px-4 py-3 text-right font-mono">{line.rate}%</td>
                            <td className="px-4 py-3 text-right">
                              <MoneyBadge amount={line.amount} currency="VES" exchangeRate={row.exchangeRate ?? undefined} />
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-orange-700">
                              {idx === 0 ? `Bs. ${row.ivaRetentionAmount}` : ""}
                            </td>
                            {type === "PURCHASE" && (
                              <td className="px-4 py-3 text-right font-mono text-orange-700">
                                {idx === 0 ? `Bs. ${row.islrRetentionAmount}` : ""}
                              </td>
                            )}
                            {type === "SALE" && (
                              <td className="px-4 py-3 text-right font-mono text-yellow-700">
                                {idx === 0 ? `Bs. ${row.igtfAmount}` : ""}
                              </td>
                            )}
                            <td className="px-4 py-3 text-right font-semibold">
                              {idx === 0 && (
                                <MoneyBadge amount={rowTotal} currency="VES" exchangeRate={row.exchangeRate ?? undefined} />
                              )}
                            </td>
                          </tr>
                            ))
                          )}
                          {expansionRow}
                        </React.Fragment>
                      );
                    })}
                  </tbody>

                  {/* Totales */}
                  <tfoot className="bg-zinc-50 font-semibold">
                    <tr>
                      <td colSpan={6} className="px-4 py-3 text-right text-xs text-zinc-500">
                        TOTALES
                      </td>
                      <td className="px-4 py-3"></td>{/* Impuesto col */}
                      <td className="px-4 py-3 text-right">
                        <MoneyBadge amount={result.summary.totalBaseGeneral} currency="VES" />
                      </td>
                      <td className="px-4 py-3"></td>{/* Tasa% col */}
                      <td className="px-4 py-3 text-right">
                        <MoneyBadge amount={result.summary.totalIvaGeneral} currency="VES" />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-orange-700">
                        Bs. {result.summary.totalIvaRetention}
                      </td>
                      {type === "PURCHASE" && (
                        <td className="px-4 py-3 text-right font-mono text-orange-700">
                          Bs. {result.summary.totalIslrRetention}
                        </td>
                      )}
                      {type === "SALE" && (
                        <td className="px-4 py-3 text-right font-mono text-yellow-700">
                          Bs. {result.summary.totalIgtf}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right font-bold">
                        <MoneyBadge
                          amount={result.rows.reduce((acc, row) => {
                            const rt = row.taxLines.reduce(
                              (a, l) => a + parseFloat(l.base) + parseFloat(l.amount),
                              0
                            ) + parseFloat(row.igtfAmount);
                            return acc + rt;
                          }, 0)}
                          currency="VES"
                        />
                      </td>
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
