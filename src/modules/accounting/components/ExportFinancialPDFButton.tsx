"use client";

// src/modules/accounting/components/ExportFinancialPDFButton.tsx

import { useState } from "react";
import { toast } from "sonner";
import { exportBalanceSheetPDFAction, exportIncomeStatementPDFAction } from "../actions/exportFinancialStatementPDF.actions";

interface Props {
  companyId: string;
  report: "balance-sheet" | "income-statement";
}

export function ExportFinancialPDFButton({ companyId, report }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      const result =
        report === "balance-sheet"
          ? await exportBalanceSheetPDFAction(companyId)
          : await exportIncomeStatementPDFAction(companyId);

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
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
    >
      {loading ? (
        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      )}
      {loading ? "Generando…" : "Exportar PDF"}
    </button>
  );
}
