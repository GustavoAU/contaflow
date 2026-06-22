"use client";

// src/modules/cajachica/components/CajaCajaExportButtons.tsx
// Botones de exportación de arqueo por caja (CSV / PDF). Descarga client-side.
// Las actions usan guardOperations → visible para cualquier usuario que ya ve la caja.

import { useState } from "react";
import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  exportCajaCajaCSVAction,
  exportCajaCajaPDFAction,
} from "../actions/cajachica.actions";

type Props = {
  cajaCajaId: string;
  companyId: string;
};

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function CajaCajaExportButtons({ cajaCajaId, companyId }: Props) {
  const [loadingCSV, setLoadingCSV] = useState(false);
  const [loadingPDF, setLoadingPDF] = useState(false);

  async function handleExportCSV() {
    setLoadingCSV(true);
    try {
      const result = await exportCajaCajaCSVAction(cajaCajaId, companyId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const blob = new Blob([result.data.csv], {
        type: "text/csv;charset=utf-8;",
      });
      triggerDownload(blob, result.data.filename);
    } catch {
      toast.error("No se pudo generar el CSV. Intenta de nuevo.");
    } finally {
      setLoadingCSV(false);
    }
  }

  async function handleExportPDF() {
    setLoadingPDF(true);
    try {
      const result = await exportCajaCajaPDFAction(cajaCajaId, companyId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const bytes = Uint8Array.from(atob(result.data.pdf), (c) =>
        c.charCodeAt(0),
      );
      const blob = new Blob([bytes], { type: "application/pdf" });
      triggerDownload(blob, result.data.filename);
    } catch {
      toast.error("No se pudo generar el PDF. Intenta de nuevo.");
    } finally {
      setLoadingPDF(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-zinc-600 dark:text-zinc-300">Exportar:</span>
      <Button
        size="sm"
        variant="ghost"
        onClick={handleExportCSV}
        disabled={loadingCSV}
        aria-busy={loadingCSV}
        aria-label="Exportar arqueo en CSV"
        className="gap-1.5 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
      >
        {loadingCSV ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
        )}
        CSV
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={handleExportPDF}
        disabled={loadingPDF}
        aria-busy={loadingPDF}
        aria-label="Exportar arqueo en PDF"
        className="gap-1.5 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
      >
        {loadingPDF ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <FileText className="h-3.5 w-3.5" aria-hidden />
        )}
        PDF
      </Button>
    </div>
  );
}
