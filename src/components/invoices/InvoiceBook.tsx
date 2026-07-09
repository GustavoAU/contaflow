// src/components/invoices/InvoiceBook.tsx
"use client";

import { useState, useTransition, useEffect } from "react";
import { Loader2Icon, InboxIcon, PlusIcon, ScanIcon, UploadIcon } from "lucide-react";
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
import { DUPLICATE_SESSION_KEY } from "@/components/invoices/InvoiceForm";
import { InvoiceBatchImportDialog } from "@/components/invoices/InvoiceBatchImportDialog";
import { exportInvoiceBookExcel, exportInvoiceBookTXT } from "./invoice-book/export-helpers";
import { InvoiceBookTable } from "./invoice-book/InvoiceBookTable";
import { InvoiceBookSummaryPanel } from "./invoice-book/InvoiceBookSummaryPanel";

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

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

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

  function handleExportExcel() {
    if (!result) return;
    void exportInvoiceBookExcel(result, type, companyName, year, month);
  }

  function handleExportTXT() {
    if (!result) return;
    exportInvoiceBookTXT(result, type, companyName, year, month);
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
              <InvoiceBookTable
                result={result}
                type={type}
                companyId={companyId}
                expandedNcNdId={expandedNcNdId}
                onToggleNcNd={(rowId) => setExpandedNcNdId(expandedNcNdId === rowId ? null : rowId)}
                pendingVoucherId={pendingVoucherId}
                isPendingVoucher={isPendingVoucher}
                onExportVoucher={handleExportInvoiceVoucher}
                onDuplicate={handleDuplicate}
              />
            )}
          </div>
        )}

        {/* ALERTA 6: Subtotales por alícuota — requerido por Providencia 00071 */}
        {result && result.rows.length > 0 && (
          <InvoiceBookSummaryPanel result={result} type={type} />
        )}
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
