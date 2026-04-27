"use client";

// src/components/reports/LedgerExportButton.tsx
import * as XLSX from "xlsx";
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
  function handleExport() {
    const rows: (string | number)[][] = [];

    // Encabezado de documento
    rows.push([companyName ?? "Empresa", "", "", "", "", ""]);
    rows.push(["LIBRO MAYOR", "", "", "", "", ""]);
    rows.push([`Período: ${period}`, "", "", "", "", ""]);
    rows.push([]);
    rows.push(["Código", "Cuenta", "Tipo", "Débito (Bs.)", "Crédito (Bs.)", "Saldo (Bs.)"]);

    for (const account of accounts) {
      // Fila resumen de cuenta
      rows.push([
        account.code,
        account.name,
        TYPE_LABELS[account.type] ?? account.type,
        parseFloat(account.totalDebit),
        parseFloat(account.totalCredit),
        parseFloat(account.balance),
      ]);

      // Encabezado de movimientos
      rows.push(["", "Fecha", "Número", "Descripción", "Débito (Bs.)", "Crédito (Bs.)", "Saldo acumulado (Bs.)"]);

      for (const entry of account.entries) {
        rows.push([
          "",
          new Date(entry.date).toLocaleDateString("es-VE"),
          entry.number,
          entry.description,
          entry.debit ? parseFloat(entry.debit) : "",
          entry.credit ? parseFloat(entry.credit) : "",
          parseFloat(entry.balance),
        ]);
      }

      rows.push([]); // separador entre cuentas
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Libro Mayor");
    XLSX.writeFile(wb, `Libro Mayor - ${period}.xlsx`);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
      <DownloadIcon className="h-4 w-4" />
      Exportar Excel
    </Button>
  );
}
