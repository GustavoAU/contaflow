"use client";

// src/modules/documents/components/DocumentList.tsx
// Q3-1: Vista unificada de documentos — facturas + retenciones.
// Filtros: tipo, rango de fechas, búsqueda libre.
// Acciones: Descargar PDF (on-demand) + Compartir link temporal (JWT 7d).

import { useState, useTransition, useCallback, useEffect } from "react";
import {
  FileTextIcon,
  DownloadIcon,
  Share2Icon,
  Loader2Icon,
  CheckIcon,
  SearchIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listDocumentsAction, generateDocShareTokenAction } from "../actions/document.actions";
import { exportInvoiceVoucherPDFAction } from "@/modules/invoices/actions/invoice.actions";
import { exportRetentionVoucherPDFAction } from "@/modules/retentions/actions/retention.actions";
import type { DocumentRow, DocumentType } from "../services/DocumentService";
import type { DocShareType } from "@/lib/document-share-jwt";
import { formatAmount } from "@/lib/format";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<DocumentType, string> = {
  FACTURA_VENTA:   "Factura Venta",
  FACTURA_COMPRA:  "Factura Compra",
  RETENCION_IVA:   "Retención IVA",
  RETENCION_ISLR:  "Retención ISLR",
  RETENCION_AMBAS: "Retención IVA+ISLR",
};

const TYPE_COLORS: Record<DocumentType, string> = {
  FACTURA_VENTA:   "bg-blue-50 text-blue-700 border-blue-200",
  FACTURA_COMPRA:  "bg-purple-50 text-purple-700 border-purple-200",
  RETENCION_IVA:   "bg-amber-50 text-amber-700 border-amber-200",
  RETENCION_ISLR:  "bg-orange-50 text-orange-700 border-orange-200",
  RETENCION_AMBAS: "bg-red-50 text-red-700 border-red-200",
};

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("es-VE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

function isInvoiceType(t: DocumentType): boolean {
  return t === "FACTURA_VENTA" || t === "FACTURA_COMPRA";
}

function toDocShareType(t: DocumentType): DocShareType {
  return isInvoiceType(t) ? "INVOICE" : "RETENTION";
}

// ─── Componente ───────────────────────────────────────────────────────────────

type Props = {
  companyId: string;
  initialItems: DocumentRow[];
  initialTotal: number;
};

export function DocumentList({ companyId, initialItems, initialTotal }: Props) {
  const [items, setItems]   = useState<DocumentRow[]>(initialItems);
  const [total, setTotal]   = useState(initialTotal);
  const [page, setPage]     = useState(1);

  // Filtros
  const [docType, setDocType]   = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [search, setSearch]     = useState("");

  // Estados de operaciones por ID
  const [downloading, setDownloading] = useState<string | null>(null);
  const [sharing, setSharing]         = useState<string | null>(null);
  const [copied, setCopied]           = useState<string | null>(null);

  const [isLoading, startLoading] = useTransition();

  // ── Cargar con filtros ───────────────────────────────────────────────────
  const load = useCallback(
    (pg: number) => {
      startLoading(async () => {
        const res = await listDocumentsAction(companyId, {
          docType: docType || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          search: search || undefined,
          page: pg,
        });
        if (res.success) {
          setItems(res.data.items);
          setTotal(res.data.total);
          setPage(pg);
        } else {
          toast.error(res.error);
        }
      });
    },
    [companyId, docType, dateFrom, dateTo, search],
  );

  // Auto-reload cuando cambian los filtros (debounced via useEffect)
  useEffect(() => {
    const id = setTimeout(() => load(1), 300);
    return () => clearTimeout(id);
  }, [load]);

  // ── Descargar PDF ────────────────────────────────────────────────────────
  async function handleDownload(row: DocumentRow) {
    setDownloading(row.id);
    try {
      let result: { success: boolean; buffer?: number[]; error?: string };
      if (isInvoiceType(row.documentType)) {
        result = await exportInvoiceVoucherPDFAction(row.id, companyId);
      } else {
        result = await exportRetentionVoucherPDFAction(row.id, companyId);
      }

      if (!result.success || !result.buffer) {
        toast.error(result.error ?? "Error al generar el PDF");
        return;
      }

      const blob = new Blob([new Uint8Array(result.buffer)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${TYPE_LABELS[row.documentType].replace(/ /g, "-").toLowerCase()}-${row.number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(null);
    }
  }

  // ── Compartir link temporal ──────────────────────────────────────────────
  async function handleShare(row: DocumentRow) {
    setSharing(row.id);
    try {
      const res = await generateDocShareTokenAction(
        companyId,
        toDocShareType(row.documentType),
        row.id,
      );
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      await navigator.clipboard.writeText(res.data.url);
      setCopied(row.id);
      const expDate = new Date(res.data.expiresAt).toLocaleDateString("es-VE");
      toast.success(`Enlace copiado — válido hasta ${expDate}`);
      setTimeout(() => setCopied(null), 3000);
    } finally {
      setSharing(null);
    }
  }

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-4">
      {/* ── Filtros ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        {/* Búsqueda */}
        <div className="relative flex-1 min-w-48">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400 pointer-events-none" />
          <Input
            placeholder="Número, contraparte, RIF..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Tipo */}
        <Select value={docType} onValueChange={setDocType}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Todos los tipos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Todos los tipos</SelectItem>
            <SelectItem value="FACTURA_VENTA">Facturas de Venta</SelectItem>
            <SelectItem value="FACTURA_COMPRA">Facturas de Compra</SelectItem>
            <SelectItem value="RETENCION_IVA">Retenciones IVA</SelectItem>
            <SelectItem value="RETENCION_ISLR">Retenciones ISLR</SelectItem>
            <SelectItem value="RETENCION_AMBAS">Retenciones IVA+ISLR</SelectItem>
          </SelectContent>
        </Select>

        {/* Rango de fechas */}
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          title="Desde"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          title="Hasta"
        />
      </div>

      {/* ── Contador + estado ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {isLoading ? (
            <span className="flex items-center gap-1.5">
              <Loader2Icon className="size-3.5 animate-spin" />
              Buscando...
            </span>
          ) : (
            `${total} documento${total !== 1 ? "s" : ""}`
          )}
        </span>
        {totalPages > 1 && (
          <span>Página {page} de {totalPages}</span>
        )}
      </div>

      {/* ── Tabla ────────────────────────────────────────────────────────── */}
      {items.length === 0 && !isLoading ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <FileTextIcon className="size-10 opacity-30" />
          <p className="text-sm">No hay documentos con los filtros aplicados.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900 border-b">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-400 text-xs uppercase tracking-wide">
                  Tipo
                </th>
                <th scope="col" className="px-4 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-400 text-xs uppercase tracking-wide">
                  Número
                </th>
                <th scope="col" className="px-4 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-400 text-xs uppercase tracking-wide">
                  Contraparte
                </th>
                <th scope="col" className="px-4 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-400 text-xs uppercase tracking-wide">
                  Fecha
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium text-zinc-600 dark:text-zinc-400 text-xs uppercase tracking-wide">
                  Monto (Bs.)
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium text-zinc-600 dark:text-zinc-400 text-xs uppercase tracking-wide">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50 transition-colors">
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[row.documentType]}`}>
                      {TYPE_LABELS[row.documentType]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                    {row.number}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300 max-w-48 truncate" title={row.counterpart}>
                    {row.counterpart}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400 text-xs whitespace-nowrap">
                    {fmtDate(row.date)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-700 dark:text-zinc-300">
                    {row.currency !== "VES" && (
                      <span className="text-xs text-zinc-400 mr-1">{row.currency}</span>
                    )}
                    {formatAmount(row.amountVes)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Descargar */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleDownload(row)}
                        disabled={downloading === row.id}
                        aria-busy={downloading === row.id}
                        title="Descargar PDF"
                      >
                        {downloading === row.id ? (
                          <Loader2Icon className="size-3.5 animate-spin" />
                        ) : (
                          <DownloadIcon className="size-3.5" />
                        )}
                        <span className="ml-1 hidden sm:inline">PDF</span>
                      </Button>

                      {/* Compartir link */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleShare(row)}
                        disabled={sharing === row.id}
                        aria-busy={sharing === row.id}
                        title="Copiar link temporal (7 días)"
                      >
                        {sharing === row.id ? (
                          <Loader2Icon className="size-3.5 animate-spin" />
                        ) : copied === row.id ? (
                          <CheckIcon className="size-3.5 text-green-600" />
                        ) : (
                          <Share2Icon className="size-3.5" />
                        )}
                        <span className="ml-1 hidden sm:inline">
                          {copied === row.id ? "Copiado" : "Compartir"}
                        </span>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Paginación ───────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(page - 1)}
            disabled={page <= 1 || isLoading}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(page + 1)}
            disabled={page >= totalPages || isLoading}
          >
            Siguiente
          </Button>
        </div>
      )}

      {/* ── Nota sobre links compartidos ─────────────────────────────────── */}
      <p className="text-xs text-muted-foreground border-t pt-3">
        <Share2Icon className="size-3 inline mr-1 opacity-60" />
        Los links compartidos son válidos por <strong>7 días</strong> y no requieren acceso al sistema.
        Útiles para auditorías SENIAT o enviar comprobantes a clientes.
      </p>
    </div>
  );
}
