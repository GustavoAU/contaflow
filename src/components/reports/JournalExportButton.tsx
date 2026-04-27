"use client";

// src/components/reports/JournalExportButton.tsx
import * as XLSX from "xlsx";
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
  function handleExport() {
    const rows: (string | number)[][] = [];

    rows.push([companyName ?? "Empresa", "", "", "", "", ""]);
    rows.push(["LIBRO DIARIO", "", "", "", "", ""]);
    rows.push([`Período: ${period}`, "", "", "", "", ""]);
    rows.push([]);
    rows.push(["Número", "Fecha", "Tipo", "Descripción", "Referencia", "Código", "Cuenta", "Débito (Bs.)", "Crédito (Bs.)"]);

    for (const tx of transactions) {
      for (const line of tx.lines) {
        rows.push([
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
      // fila de sumas iguales
      rows.push([
        "",
        "",
        "",
        "Sumas iguales",
        "",
        "",
        "",
        parseFloat(tx.totalDebit),
        parseFloat(tx.totalCredit),
      ]);
      rows.push([]); // separador entre asientos
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Libro Diario");
    XLSX.writeFile(wb, `Libro Diario - ${period}.xlsx`);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
      <DownloadIcon className="h-4 w-4" />
      Exportar Excel
    </Button>
  );
}
