"use client";

// src/components/reports/LedgerPDFExportButton.tsx

import { useTransition } from "react";
import { FileTextIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportLedgerPDFAction } from "@/modules/accounting/actions/exportFinancialStatementPDF.actions";

interface Props {
  companyId: string;
  dateFrom?: string;
  dateTo?: string;
  disabled?: boolean;
}

export function LedgerPDFExportButton({ companyId, dateFrom, dateTo, disabled }: Props) {
  const [isPending, startTransition] = useTransition();

  function handleExport() {
    startTransition(async () => {
      const result = await exportLedgerPDFAction(companyId, dateFrom, dateTo);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      // Decode base64 → Blob → trigger download
      const byteChars = atob(result.data.pdf);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteArray], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.data.filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={disabled ?? isPending}
      aria-busy={isPending}
      className="gap-2"
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <FileTextIcon className="h-4 w-4" aria-hidden="true" />
      )}
      {isPending ? "Generando..." : "Exportar PDF"}
    </Button>
  );
}
