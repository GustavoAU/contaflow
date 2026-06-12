// src/components/invoices/InvoiceBook.tsx
"use client";

import { useState, useTransition, useEffect } from "react";
import { Loader2Icon, InboxIcon, PlusIcon, ScanIcon, CopyIcon, UploadIcon } from "lucide-react";
import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { DUPLICATE_SESSION_KEY } from "@/components/invoices/InvoiceForm";
import { InvoiceBatchImportDialog } from "@/components/invoices/InvoiceBatchImportDialog";

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

// ─── Badge estado SENIAT (PA-121) ─────────────────────────────────────────────

type SeniatStatus = "PENDING" | "SENT" | "FAILED";

const SENIAT_BADGE: Record<SeniatStatus, { label: string; title: string; className: string }> = {
  SENT:    { label: "SENIAT ✓", title: "Transmitido al SENIAT",        className: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  PENDING: { label: "SENIAT ◌", title: "Pendiente de transmisión",     className: "bg-amber-50 text-amber-700 border border-amber-200" },
  FAILED:  { label: "SENIAT ✗", title: "Error en transmisión SENIAT",  className: "bg-red-50 text-red-700 border border-red-200" },
};

function SeniatBadge({ status }: { status: SeniatStatus }) {
  const cfg = SENIAT_BADGE[status];
  return (
    <span
      title={cfg.title}
      aria-label={cfg.title}
      className={`rounded px-1.5 py-0.5 text-10 font-semibold whitespace-nowrap ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

export function InvoiceBook({ companyId, companyName, defaultType = "PURCHASE", activePeriodMonth, activePeriodYear }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isPendingPDF, startTransitionPDF] = useTransition();
  const [isPendingVoucher, startTransitionVoucher] = useTransition();
  const [pendingVoucherId, setPendingVoucherId] = useState<string | null>(null);
  const [type, setType] = useState<"SALE" | "PURCHASE">(defaultType);
  const [year, setYear] = useState(activePeriodYear ?? currentYear);
  const [month, setMonth] = useState(activePeriodMonth ?? currentMonth);
  // H-004: modo rango de fechas para fiscalizaciones multimensuales
  const [filterMode, setFilterMode] = useState<"period" | "range">("period");
  const [rangeStart, setRangeStart] = useState(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [rangeEnd, setRangeEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<InvoiceBookResult | null>(null);
  const [expandedNcNdId, setExpandedNcNdId] = useState<string | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);

  useEffect(() => {
    startTransition(async () => {
      const filter = filterMode === "range"
        ? { companyId, type, startDate: rangeStart, endDate: rangeEnd }
        : { companyId, type, year, month };
      const res = await getInvoiceBookAction(filter);
      if (res.success) setResult(res.data);
      else toast.error(res.error);
    });
  }, [companyId, type, year, month, filterMode, rangeStart, rangeEnd]);

  function handleDuplicate(row: InvoiceBookRow) {
    try {
      sessionStorage.setItem(
        DUPLICATE_SESSION_KEY,
        JSON.stringify({
          type,
          currency: row.currency as "VES" | "USD" | "EUR",
          docType: row.docType,
          taxCategory: row.taxCategory,
          counterpartName: row.counterpartName,
          counterpartRif: row.counterpartRif,
          taxLines: row.taxLines.map((tl) => ({
            taxType: tl.taxType,
            base: tl.base,
            rate: tl.rate,
            amount: tl.amount,
          })),
        }),
      );
      router.push(`/company/${companyId}/invoices/new`);
    } catch {
      toast.error("No se pudo duplicar la factura");
    }
  }

  function handleExportPDF() {
    startTransitionPDF(async () => {
      const result = await exportInvoiceBookPDFAction({ companyId, type, year, month });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      // M9: PDF en Vercel Blob — abrimos la URL directamente (no buffer en memoria)
      const a = document.createElement("a");
      a.href = result.url;
      a.download = `libro-${type === "SALE" ? "ventas" : "compras"}-${year}-${String(month).padStart(2, "0")}.pdf`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
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

  // ALERTA 5: Exportación TXT compatible con SIVIT/SENIAT (Providencia 00071)
  // Formato: pipe-delimited, una línea por factura, fecha DD/MM/YYYY, decimales con punto
  // Verificar campos exactos con versión vigente de SIVIT antes de carga al portal
  function handleExportTXT() {
    if (!result) return;

    const DOC_TYPE: Record<string, string> = {
      FACTURA:      "01",
      NOTA_DEBITO:  "02",
      NOTA_CREDITO: "03",
    };

    const fmtNum = (v: string | number) =>
      parseFloat(String(v)).toFixed(2);

    const fmtDateSivit = (d: Date | string) => {
      const dt = d instanceof Date ? d : new Date(d);
      const dd = String(dt.getUTCDate()).padStart(2, "0");
      const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const yyyy = dt.getUTCFullYear();
      return `${dd}/${mm}/${yyyy}`;
    };

    // Cabecera del archivo
    const header = [
      `# ContaFlow — ${type === "SALE" ? "Libro de Ventas" : "Libro de Compras"}`,
      `# Empresa: ${companyName}`,
      `# Período: ${MONTHS[month - 1]} ${year}`,
      `# Formato SIVIT/SENIAT — Providencia 00071`,
      `# RIF|Nombre|Nro.Factura|Nro.Control|Fecha|TipoDoc|Base16%|IVA16%|Base8%|IVA8%|Exento|IVARetenido${type === "PURCHASE" ? "|ISLRRetenido" : "|BaseIGTF|IGTF"}`,
    ].join("\n");

    const lines = result.rows.map((row) => {
      // Agregar bases e IVA por alícuota
      let base16 = 0, iva16 = 0, base8 = 0, iva8 = 0, exento = 0;
      for (const tl of row.taxLines) {
        if (tl.taxType === "IVA_GENERAL" || tl.taxType === "IVA_ADICIONAL") {
          base16 += parseFloat(tl.base);
          iva16  += parseFloat(tl.amount);
        } else if (tl.taxType === "IVA_REDUCIDO") {
          base8 += parseFloat(tl.base);
          iva8  += parseFloat(tl.amount);
        } else {
          exento += parseFloat(tl.base);
        }
      }

      const fields = [
        row.counterpartRif ?? "",
        row.counterpartName,
        row.invoiceNumber,
        row.controlNumber ?? "",
        fmtDateSivit(row.date),
        DOC_TYPE[row.docType] ?? "01",
        fmtNum(base16),
        fmtNum(iva16),
        fmtNum(base8),
        fmtNum(iva8),
        fmtNum(exento),
        fmtNum(row.ivaRetentionAmount),
        ...(type === "PURCHASE"
          ? [fmtNum(row.islrRetentionAmount)]
          : [fmtNum(row.igtfBase), fmtNum(row.igtfAmount)]),
      ];

      return fields.join("|");
    });

    const s = result.summary;
    const footer = [
      "",
      `# TOTALES`,
      [
        "TOTAL", "", "", "", "", "",
        fmtNum(s.totalBaseGeneral),
        fmtNum(s.totalIvaGeneral),
        fmtNum(s.totalBaseReduced),
        fmtNum(s.totalIvaReduced),
        fmtNum(s.totalExempt),
        fmtNum(s.totalIvaRetention),
        ...(type === "PURCHASE"
          ? [fmtNum(s.totalIslrRetention)]
          : ["", fmtNum(s.totalIgtf)]),
      ].join("|"),
    ].join("\n");

    const content = [header, ...lines, footer].join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `libro-${type === "SALE" ? "ventas" : "compras"}-${year}-${String(month).padStart(2, "0")}.txt`;
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

            {/* H-004: toggle Período / Rango */}
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">Filtro</label>
              <div className="flex rounded-lg border p-1">
                {(["period", "range"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setFilterMode(m); setResult(null); }}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      filterMode === m ? "bg-zinc-800 text-white" : "text-zinc-600 hover:bg-zinc-100"
                    }`}
                  >
                    {m === "period" ? "Período" : "Rango"}
                  </button>
                ))}
              </div>
            </div>

            {filterMode === "period" ? (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600">Mes</label>
                  <select
                    value={month}
                    onChange={(e) => setMonth(Number(e.target.value))}
                    className="rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    {MONTHS.map((m, i) => (
                      <option key={i + 1} value={i + 1}>{m}</option>
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
                    {/* COT Art. 55-56: fiscalizaciones hasta 4 años retroactivos */}
                    {Array.from({ length: 6 }, (_, i) => currentYear - 4 + i).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600">Desde</label>
                  <input
                    type="date"
                    value={rangeStart}
                    onChange={(e) => setRangeStart(e.target.value)}
                    className="rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600">
                    Hasta <span className="font-normal text-zinc-400">(máx 366 días)</span>
                  </label>
                  <input
                    type="date"
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(e.target.value)}
                    className="rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </>
            )}

            {/* Loading indicator */}
            <div className="flex h-9 w-9 items-center justify-center" aria-live="polite" aria-label={isPending ? "Cargando datos…" : undefined}>
              {isPending && <Loader2Icon className="h-4 w-4 animate-spin text-zinc-400" aria-hidden />}
            </div>

            <Button
              variant="outline"
              onClick={() => setShowImportDialog(true)}
              className="gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
              title="Importar facturas desde archivo CSV"
            >
              <UploadIcon className="h-3.5 w-3.5" />
              Importar lote
            </Button>

            {result && result.rows.length > 0 && (
              <>
                <Button variant="outline" onClick={handleExportExcel}>
                  Exportar Excel
                </Button>
                <Button
                  variant="outline"
                  onClick={handleExportTXT}
                  className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                  aria-label="Exportar libro en formato TXT compatible con SIVIT/SENIAT"
                  title="Formato TXT compatible con portal SENIAT (SIVIT). Verificar campos con versión vigente antes de cargar."
                >
                  Exportar TXT (SIVIT)
                </Button>
                {/* PDF export solo en modo Período — requiere year/month exacto */}
                {filterMode === "period" && (
                  <Button
                    variant="outline"
                    onClick={handleExportPDF}
                    disabled={isPendingPDF || isPending}
                    className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                    aria-label="Exportar libro como PDF"
                  >
                    {isPendingPDF ? "Generando PDF..." : "Exportar PDF"}
                  </Button>
                )}
                {/* H-4: enlace al ZIP SIVIT completo (LV.txt + LC.txt + historial) */}
                <Link
                  href={`/company/${companyId}/export`}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                  title="Descarga ZIP con LV.txt + LC.txt para cargar directamente al portal SIVIT del SENIAT"
                >
                  ZIP SIVIT completo →
                </Link>
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
                <div className="flex flex-wrap justify-center gap-2">
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
                  {/* H-9: acceso rápido a importación masiva desde estado vacío */}
                  <button
                    type="button"
                    onClick={() => setShowImportDialog(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50"
                    title="Importar múltiples facturas desde archivo CSV"
                  >
                    <UploadIcon className="h-4 w-4" />
                    Importar lote
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border-separate border-spacing-0">
                  <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
                    <tr className="[&>th]:border-b [&>th]:border-zinc-200">
                      <th scope="col" className="px-4 py-3 text-left w-25 whitespace-nowrap">Fecha</th>
                      <th scope="col" className="sticky left-0 z-10 bg-zinc-50 px-4 py-3 text-left min-w-50">
                        {type === "PURCHASE" ? "Proveedor" : "Cliente"}
                      </th>
                      <th scope="col" className="px-4 py-3 text-left whitespace-nowrap">RIF</th>
                      <th scope="col" className="px-4 py-3 text-left whitespace-nowrap">N° Factura</th>
                      <th scope="col" className="px-4 py-3 text-left whitespace-nowrap">N° Control</th>
                      <th scope="col" className="px-4 py-3 text-left"></th>
                      <th scope="col" className="px-4 py-3 text-left whitespace-nowrap">Impuesto</th>
                      <th scope="col" className="px-4 py-3 text-right whitespace-nowrap min-w-44">Base</th>
                      <th scope="col" className="px-4 py-3 text-right whitespace-nowrap min-w-20">Tasa %</th>
                      <th scope="col" className="px-4 py-3 text-right whitespace-nowrap min-w-44">IVA</th>
                      <th scope="col" className="px-4 py-3 text-right whitespace-nowrap min-w-44">IVA Ret.</th>
                      {type === "PURCHASE" && <th scope="col" className="px-4 py-3 text-right whitespace-nowrap min-w-44">ISLR Ret.</th>}
                      {type === "SALE" && <th scope="col" className="px-4 py-3 text-right whitespace-nowrap min-w-44">IGTF</th>}
                      <th scope="col" className="px-4 py-3 text-right whitespace-nowrap min-w-44">Total</th>
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
                              <td className="px-4 py-3 whitespace-nowrap">
                                {fmtDate(row.date)}
                              </td>
                              <td className="sticky left-0 z-10 bg-white px-4 py-3 min-w-50"
                                  title={row.counterpartName}>
                                {row.counterpartName}
                              </td>
                              <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{row.counterpartRif}</td>
                              <td className="px-4 py-3 font-mono text-xs">
                                <div className="flex flex-col gap-0.5">
                                  <span>{row.invoiceNumber}</span>
                                  {(row.docType === "NOTA_CREDITO" || row.docType === "NOTA_DEBITO") &&
                                    row.relatedDocNumber && (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-10 font-medium text-amber-800">
                                        &#8594; Factura {row.relatedDocNumber}
                                      </span>
                                    )}
                                </div>
                              </td>
                              <td className="px-4 py-3 font-mono text-xs">
                                {row.controlNumber ?? "—"}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-1 items-center">
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
                                  <button
                                    type="button"
                                    onClick={() => handleDuplicate(row)}
                                    title="Duplicar esta factura (pre-llena el formulario con los mismos datos)"
                                    className="rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
                                    aria-label={`Duplicar factura ${row.invoiceNumber}`}
                                  >
                                    <CopyIcon className="inline h-3 w-3" />
                                  </button>
                                  {ncNdButton}
                                  {type === "SALE" && row.seniatStatus && (
                                    <SeniatBadge status={row.seniatStatus} />
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-zinc-400">—</td>
                              <td className="px-4 py-3 text-right font-mono whitespace-nowrap">—</td>
                              <td className="px-4 py-3 text-right font-mono whitespace-nowrap">—</td>
                              <td className="px-4 py-3 text-right font-mono whitespace-nowrap">—</td>
                              <td className="px-4 py-3 text-right text-orange-700 whitespace-nowrap">
                                <MoneyBadge amount={row.ivaRetentionAmount} currency="VES" align="right" />
                              </td>
                              {type === "PURCHASE" && (
                                <td className="px-4 py-3 text-right text-orange-700 whitespace-nowrap">
                                  <MoneyBadge amount={row.islrRetentionAmount} currency="VES" align="right" />
                                </td>
                              )}
                              {type === "SALE" && (
                                <td className="px-4 py-3 text-right text-yellow-700 whitespace-nowrap">
                                  <MoneyBadge amount={row.igtfAmount} currency="VES" align="right" />
                                </td>
                              )}
                              <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">
                                {rowTotal > 0
                                  ? <MoneyBadge amount={rowTotal} currency="VES" exchangeRate={row.exchangeRate ?? undefined} />
                                  : "—"}
                              </td>
                            </tr>
                          ) : (
                            row.taxLines.map((line, idx) => (
                              <tr key={`${row.id}-${line.id}`} className="bg-white hover:bg-zinc-50 [&>td]:border-b [&>td]:border-zinc-100">
                            <td className="px-4 py-3 whitespace-nowrap">
                              {idx === 0 ? fmtDate(row.date) : ""}
                            </td>
                            <td className="sticky left-0 z-10 bg-white px-4 py-3 min-w-50"
                                title={idx === 0 ? row.counterpartName : undefined}>
                              {idx === 0 ? row.counterpartName : ""}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                              {idx === 0 ? row.counterpartRif : ""}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs">
                              {idx === 0 ? (
                                <div className="flex flex-col gap-0.5">
                                  <span>{row.invoiceNumber}</span>
                                  {(row.docType === "NOTA_CREDITO" || row.docType === "NOTA_DEBITO") &&
                                    row.relatedDocNumber && (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-10 font-medium text-amber-800">
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
                                <div className="flex flex-wrap gap-1 items-center">
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
                                  <button
                                    type="button"
                                    onClick={() => handleDuplicate(row)}
                                    title="Duplicar esta factura"
                                    className="rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
                                    aria-label={`Duplicar factura ${row.invoiceNumber}`}
                                  >
                                    <CopyIcon className="inline h-3 w-3" />
                                  </button>
                                  {ncNdButton}
                                  {type === "SALE" && row.seniatStatus && (
                                    <SeniatBadge status={row.seniatStatus} />
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                                {TAX_LINE_LABELS[line.taxType] ?? line.taxType}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <MoneyBadge amount={line.base} currency="VES" exchangeRate={row.exchangeRate ?? undefined} />
                            </td>
                            <td className="px-4 py-3 text-right font-mono whitespace-nowrap">{line.rate}%</td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <MoneyBadge amount={line.amount} currency="VES" exchangeRate={row.exchangeRate ?? undefined} />
                            </td>
                            <td className="px-4 py-3 text-right text-orange-700 whitespace-nowrap">
                              {idx === 0 ? <MoneyBadge amount={row.ivaRetentionAmount} currency="VES" align="right" /> : ""}
                            </td>
                            {type === "PURCHASE" && (
                              <td className="px-4 py-3 text-right text-orange-700 whitespace-nowrap">
                                {idx === 0 ? <MoneyBadge amount={row.islrRetentionAmount} currency="VES" align="right" /> : ""}
                              </td>
                            )}
                            {type === "SALE" && (
                              <td className="px-4 py-3 text-right text-yellow-700 whitespace-nowrap">
                                {idx === 0 ? <MoneyBadge amount={row.igtfAmount} currency="VES" align="right" /> : ""}
                              </td>
                            )}
                            <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">
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
                  <tfoot className="bg-zinc-50 font-semibold text-sm">
                    <tr className="[&>td]:border-t-2 [&>td]:border-zinc-200">
                      <td className="px-4 py-3" />
                      <td className="sticky left-0 z-10 bg-zinc-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-zinc-500 whitespace-nowrap">
                        TOTALES
                      </td>
                      <td colSpan={4} className="px-4 py-3" />
                      <td className="px-4 py-3" />{/* Impuesto col */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <MoneyBadge amount={result.summary.totalBaseGeneral} currency="VES" />
                      </td>
                      <td className="px-4 py-3" />{/* Tasa% col */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <MoneyBadge amount={result.summary.totalIvaGeneral} currency="VES" />
                      </td>
                      <td className="px-4 py-3 text-right text-orange-700 whitespace-nowrap">
                        <MoneyBadge amount={result.summary.totalIvaRetention} currency="VES" align="right" />
                      </td>
                      {type === "PURCHASE" && (
                        <td className="px-4 py-3 text-right text-orange-700 whitespace-nowrap">
                          <MoneyBadge amount={result.summary.totalIslrRetention} currency="VES" align="right" />
                        </td>
                      )}
                      {type === "SALE" && (
                        <td className="px-4 py-3 text-right text-yellow-700 whitespace-nowrap">
                          <MoneyBadge amount={result.summary.totalIgtf} currency="VES" align="right" />
                        </td>
                      )}
                      <td className="px-4 py-3 text-right font-bold whitespace-nowrap">
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

        {/* ALERTA 6: Subtotales por alícuota — requerido por Providencia 00071 */}
        {result && result.rows.length > 0 && (() => {
          const s = result.summary;
          const hasReduced    = parseFloat(s.totalBaseReduced) > 0;
          const hasAdditional = parseFloat(s.totalBaseAdditional) > 0;
          const hasExempt     = parseFloat(s.totalExempt) > 0;
          const hasIslr       = type === "PURCHASE" && parseFloat(s.totalIslrRetention) > 0;
          const hasIgtf       = type === "SALE"     && parseFloat(s.totalIgtf) > 0;

          const Row = ({ label, base, iva, baseLabel = "Base", ivaLabel = "IVA" }: {
            label: string; base: string; iva: string; baseLabel?: string; ivaLabel?: string;
          }) => (
            <div className="flex items-center justify-between gap-4 py-1.5 text-sm border-b border-zinc-100 last:border-0">
              <span className="text-zinc-600 whitespace-nowrap">{label}</span>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="text-10 font-medium text-zinc-400 uppercase tracking-wide">{baseLabel}</p>
                  <MoneyBadge amount={base} currency="VES" />
                </div>
                <div className="text-right min-w-22.5">
                  <p className="text-10 font-medium text-zinc-400 uppercase tracking-wide">{ivaLabel}</p>
                  <MoneyBadge amount={iva} currency="VES" />
                </div>
              </div>
            </div>
          );

          return (
            <div className="rounded-lg border bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-zinc-500">
                Resumen del Período — Subtotales por Alícuota
              </h3>
              <div className="divide-y divide-zinc-100">
                <Row label="Operaciones gravadas al 16%" base={s.totalBaseGeneral} iva={s.totalIvaGeneral} />
                {hasReduced    && <Row label="Operaciones gravadas al 8% (Reducido)" base={s.totalBaseReduced} iva={s.totalIvaReduced} />}
                {hasAdditional && <Row label="Operaciones gravadas al 31% (Lujo)" base={s.totalBaseAdditional} iva={s.totalIvaAdditional} />}
                {hasExempt && (
                  <div className="flex items-center justify-between gap-4 py-1.5 text-sm border-b border-zinc-100">
                    <span className="text-zinc-600">Operaciones exentas / no sujetas</span>
                    <MoneyBadge amount={s.totalExempt} currency="VES" />
                  </div>
                )}
                {parseFloat(s.totalIvaRetention) > 0 && (
                  <div className="flex items-center justify-between gap-4 py-1.5 text-sm border-b border-zinc-100 text-orange-700">
                    <span>IVA Retenido (comprobantes)</span>
                    <MoneyBadge amount={s.totalIvaRetention} currency="VES" />
                  </div>
                )}
                {hasIslr && (
                  <div className="flex items-center justify-between gap-4 py-1.5 text-sm border-b border-zinc-100 text-orange-700">
                    <span>ISLR Retenido</span>
                    <MoneyBadge amount={s.totalIslrRetention} currency="VES" />
                  </div>
                )}
                {hasIgtf && (
                  <div className="flex items-center justify-between gap-4 py-1.5 text-sm border-b border-zinc-100 text-yellow-700">
                    <span>IGTF (3%)</span>
                    <MoneyBadge amount={s.totalIgtf} currency="VES" />
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      <Toaster richColors position="top-right" />

      <InvoiceBatchImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        companyId={companyId}
      />
    </>
  );
}
