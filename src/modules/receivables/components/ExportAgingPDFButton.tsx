"use client";

// src/modules/receivables/components/ExportAgingPDFButton.tsx

import { useState } from "react";
import { toast } from "sonner";
import {
  exportReceivablesAgingPDFAction,
  exportPayablesAgingPDFAction,
} from "../actions/exportAgingReportPDF.actions";

interface Props {
  companyId: string;
  reportType: "CXC" | "CXP";
  asOf?: Date;
}

export function ExportAgingPDFButton({ companyId, reportType, asOf }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      const asOfStr = asOf?.toISOString();
      const result =
        reportType === "CXC"
          ? await exportReceivablesAgingPDFAction(companyId, asOfStr)
          : await exportPayablesAgingPDFAction(companyId, asOfStr);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      const bytes = Uint8Array.from(atob(result.data.pdf), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF generado correctamente");
    } catch {
      toast.error("Error inesperado al generar el PDF");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={loading}
      aria-busy={loading}
      className="inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
    >
      {loading ? (
        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      )}
      {loading ? "Generando…" : "Exportar PDF"}
    </button>
  );
}
