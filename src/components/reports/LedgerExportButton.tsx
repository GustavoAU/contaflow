"use client";

// src/components/reports/LedgerExportButton.tsx
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LedgerAccount } from "@/modules/accounting/actions/report.actions";

const TYPE_LABELS: Record<string, string> = {
  ASSET: "Activo",
  LIABILITY: "Pasivo",
  EQUITY: "Patrimonio",
  REVENUE: "Ingreso",
  EXPENSE: "Gasto",
};

interface Props {
  accounts: LedgerAccount[];
  period: string;
  companyName?: string;
}

export function LedgerExportButton({ accounts, period, companyName }: Props) {
  async function handleExport() {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Libro Mayor");

    ws.addRow([companyName ?? "Empresa"]);
    ws.addRow(["LIBRO MAYOR"]);
    ws.addRow([`Período: ${period}`]);
    ws.addRow([]);
    ws.addRow(["Código", "Cuenta", "Tipo", "Débito (Bs.)", "Crédito (Bs.)", "Saldo (Bs.)"]);

    for (const account of accounts) {
      ws.addRow([
        account.code,
        account.name,
        TYPE_LABELS[account.type] ?? account.type,
        parseFloat(account.totalDebit),
        parseFloat(account.totalCredit),
        parseFloat(account.balance),
      ]);
      ws.addRow(["", "Fecha", "Número", "Descripción", "Débito (Bs.)", "Crédito (Bs.)", "Saldo acumulado (Bs.)"]);

      for (const entry of account.entries) {
        ws.addRow([
          "",
          new Date(entry.date).toLocaleDateString("es-VE", { timeZone: "UTC" }),
          entry.number,
          entry.description,
          entry.debit ? parseFloat(entry.debit) : "",
          entry.credit ? parseFloat(entry.credit) : "",
          parseFloat(entry.balance),
        ]);
      }

      ws.addRow([]);
    }

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Libro Mayor - ${period}.xlsx`;
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
