// src/components/invoices/invoice-book/export-helpers.ts
// Extraído MECÁNICAMENTE desde InvoiceBook.tsx (sin cambios de lógica) — split por tamaño de archivo.
// Exportación Excel + TXT (SIVIT/SENIAT Providencia 00071) del libro de compras/ventas.

import type { InvoiceBookResult, InvoiceBookRow } from "@/modules/invoices/services/InvoiceService";
import { fmtDate } from "@/lib/format";

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

const TAX_LINE_LABELS: Record<string, string> = {
  IVA_GENERAL: "IVA General",
  IVA_REDUCIDO: "IVA Reducido",
  IVA_ADICIONAL: "IVA Adicional",
  EXENTO: "Exento",
};

export async function exportInvoiceBookExcel(
  result: InvoiceBookResult,
  type: "SALE" | "PURCHASE",
  companyName: string,
  year: number,
  month: number
) {
  const bookName = type === "SALE" ? "Libro de Ventas" : "Libro de Compras";
  const period = `${MONTHS[month - 1]} ${year}`;

  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(bookName.substring(0, 31));

  ws.addRow([companyName]);
  ws.addRow([bookName]);
  ws.addRow([period]);
  ws.addRow([]);
  ws.addRow([
    "Fecha",
    type === "PURCHASE" ? "Proveedor" : "Cliente",
    "RIF",
    "N° Factura",
    "N° Control",
    "Tipo Doc",
    "Categoría",
    "N° Doc Rel.",
    ...(type === "PURCHASE" ? ["N° Planilla Imp."] : []),
    "Impuesto",
    "Base Imponible",
    "Tasa %",
    "Monto IVA",
    "IVA Retenido",
    "Comprobante IVA",
    ...(type === "PURCHASE" ? ["ISLR Retenido"] : []),
    ...(type === "SALE" ? ["Base IGTF", "Monto IGTF"] : []),
    "Total",
  ]);

  result.rows.forEach((row: InvoiceBookRow) => {
    if (row.taxLines.length === 0) {
      const rowTotalExcel = parseFloat(row.igtfAmount);
      ws.addRow([
        fmtDate(row.date),
        row.counterpartName,
        row.counterpartRif,
        row.invoiceNumber,
        row.controlNumber ?? "",
        row.docType,
        row.taxCategory,
        row.relatedDocNumber ?? "",
        ...(type === "PURCHASE" ? [row.importFormNumber ?? ""] : []),
        "—", "", "", "",
        row.ivaRetentionAmount,
        row.ivaRetentionVoucher ?? "",
        ...(type === "PURCHASE" ? [row.islrRetentionAmount] : []),
        ...(type === "SALE" ? [row.igtfBase, row.igtfAmount] : []),
        rowTotalExcel > 0 ? rowTotalExcel : "—",
      ]);
    } else {
      const rowTotalExcel = row.taxLines.reduce(
        (acc, l) => acc + parseFloat(l.base) + parseFloat(l.amount),
        0
      ) + parseFloat(row.igtfAmount);
      row.taxLines.forEach((line, idx) => {
        ws.addRow([
          idx === 0 ? fmtDate(row.date) : "",
          idx === 0 ? row.counterpartName : "",
          idx === 0 ? row.counterpartRif : "",
          idx === 0 ? row.invoiceNumber : "",
          idx === 0 ? (row.controlNumber ?? "") : "",
          idx === 0 ? row.docType : "",
          idx === 0 ? row.taxCategory : "",
          idx === 0 ? (row.relatedDocNumber ?? "") : "",
          ...(type === "PURCHASE" ? [idx === 0 ? (row.importFormNumber ?? "") : ""] : []),
          TAX_LINE_LABELS[line.taxType] ?? line.taxType,
          line.base,
          line.rate,
          line.amount,
          idx === 0 ? row.ivaRetentionAmount : "",
          idx === 0 ? (row.ivaRetentionVoucher ?? "") : "",
          ...(type === "PURCHASE" ? [idx === 0 ? row.islrRetentionAmount : ""] : []),
          ...(type === "SALE"
            ? [idx === 0 ? row.igtfBase : "", idx === 0 ? row.igtfAmount : ""]
            : []),
          idx === 0 ? rowTotalExcel : "",
        ]);
      });
    }
  });

  const s = result.summary;
  ws.addRow([]);
  ws.addRow([
    "TOTALES", "", "", "", "", "", "", "",
    ...(type === "PURCHASE" ? [""] : []),
    "",
    s.totalBaseGeneral, "",
    s.totalIvaGeneral,
    s.totalIvaRetention, "",
    ...(type === "PURCHASE" ? [s.totalIslrRetention] : []),
    ...(type === "SALE" ? ["", s.totalIgtf] : []),
    result.rows.reduce((acc, row) => {
      return acc + row.taxLines.reduce((a, l) => a + parseFloat(l.base) + parseFloat(l.amount), 0) + parseFloat(row.igtfAmount);
    }, 0),
  ]);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${bookName} - ${period}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ALERTA 5: Exportación TXT compatible con SIVIT/SENIAT (Providencia 00071)
// Formato: pipe-delimited, una línea por factura, fecha DD/MM/YYYY, decimales con punto
// Verificar campos exactos con versión vigente de SIVIT antes de carga al portal
export function exportInvoiceBookTXT(
  result: InvoiceBookResult,
  type: "SALE" | "PURCHASE",
  companyName: string,
  year: number,
  month: number
) {
  const DOC_TYPE: Record<string, string> = {
    FACTURA:      "01",
    NOTA_DEBITO:  "02",
    NOTA_CREDITO: "03",
  };

  const fmtNum = (v: string | number) =>
    parseFloat(String(v)).toFixed(2);

  const fmtDateSivit = (d: Date | string) => {
    const dt = d instanceof Date ? d : new Date(d);
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = dt.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  // Cabecera del archivo
  const header = [
    `# ContaFlow — ${type === "SALE" ? "Libro de Ventas" : "Libro de Compras"}`,
    `# Empresa: ${companyName}`,
    `# Período: ${MONTHS[month - 1]} ${year}`,
    `# Formato SIVIT/SENIAT — Providencia 00071`,
    `# RIF|Nombre|Nro.Factura|Nro.Control|Fecha|TipoDoc|Base16%|IVA16%|Base8%|IVA8%|Exento|IVARetenido${type === "PURCHASE" ? "|ISLRRetenido" : "|BaseIGTF|IGTF"}`,
  ].join("\n");

  const lines = result.rows.map((row) => {
    // Agregar bases e IVA por alícuota
    let base16 = 0, iva16 = 0, base8 = 0, iva8 = 0, exento = 0;
    for (const tl of row.taxLines) {
      if (tl.taxType === "IVA_GENERAL" || tl.taxType === "IVA_ADICIONAL") {
        base16 += parseFloat(tl.base);
        iva16  += parseFloat(tl.amount);
      } else if (tl.taxType === "IVA_REDUCIDO") {
        base8 += parseFloat(tl.base);
        iva8  += parseFloat(tl.amount);
      } else {
        exento += parseFloat(tl.base);
      }
    }

    const fields = [
      row.counterpartRif ?? "",
      row.counterpartName,
      row.invoiceNumber,
      row.controlNumber ?? "",
      fmtDateSivit(row.date),
      DOC_TYPE[row.docType] ?? "01",
      fmtNum(base16),
      fmtNum(iva16),
      fmtNum(base8),
      fmtNum(iva8),
      fmtNum(exento),
      fmtNum(row.ivaRetentionAmount),
      ...(type === "PURCHASE"
        ? [fmtNum(row.islrRetentionAmount)]
        : [fmtNum(row.igtfBase), fmtNum(row.igtfAmount)]),
    ];

    return fields.join("|");
  });

  const s = result.summary;
  const footer = [
    "",
    `# TOTALES`,
    [
      "TOTAL", "", "", "", "", "",
      fmtNum(s.totalBaseGeneral),
      fmtNum(s.totalIvaGeneral),
      fmtNum(s.totalBaseReduced),
      fmtNum(s.totalIvaReduced),
      fmtNum(s.totalExempt),
      fmtNum(s.totalIvaRetention),
      ...(type === "PURCHASE"
        ? [fmtNum(s.totalIslrRetention)]
        : ["", fmtNum(s.totalIgtf)]),
    ].join("|"),
  ].join("\n");

  const content = [header, ...lines, footer].join("\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `libro-${type === "SALE" ? "ventas" : "compras"}-${year}-${String(month).padStart(2, "0")}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
