"use client";

// src/components/reports/JournalExportButton.tsx
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JournalTransaction } from "@/modules/accounting/actions/report.actions";

const TYPE_LABELS: Record<string, string> = {
  DIARIO: "Diario",
  APERTURA: "Apertura",
  AJUSTE: "Ajuste",
  CIERRE: "Cierre",
};

interface Props {
  transactions: JournalTransaction[];
  period: string;
  companyName?: string;
}

export function JournalExportButton({ transactions, period, companyName }: Props) {
  async function handleExport() {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Libro Diario");

    ws.addRow([companyName ?? "Empresa"]);
    ws.addRow(["LIBRO DIARIO"]);
    ws.addRow([`Período: ${period}`]);
    ws.addRow([]);
    ws.addRow(["Número", "Fecha", "Tipo", "Descripción", "Referencia", "Código", "Cuenta", "Débito (Bs.)", "Crédito (Bs.)"]);

    for (const tx of transactions) {
      for (const line of tx.lines) {
        ws.addRow([
          tx.number,
          new Date(tx.date).toLocaleDateString("es-VE"),
          TYPE_LABELS[tx.type] ?? tx.type,
          tx.description,
          tx.reference ?? "",
          line.accountCode,
          line.accountName,
          line.debit ? parseFloat(line.debit) : "",
          line.credit ? parseFloat(line.credit) : "",
        ]);
      }
      ws.addRow([
        "", "", "", "Sumas iguales", "", "", "",
        parseFloat(tx.totalDebit),
        parseFloat(tx.totalCredit),
      ]);
      ws.addRow([]);
    }

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Libro Diario - ${period}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
      <DownloadIcon className="h-4 w-4" />
      Exportar Excel
    </Button>
  );
}
