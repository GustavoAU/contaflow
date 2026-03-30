// src/modules/invoices/services/InvoiceBookPDFService.ts
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer"
import React from "react"
import type { InvoiceBookRow, InvoiceBookSummary } from "./InvoiceService"

// ─── Estilos ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  page: { padding: 30, fontSize: 8, fontFamily: "Helvetica" },
  header: { marginBottom: 12 },
  title: { fontSize: 11, fontWeight: "bold", textAlign: "center" },
  subtitle: { fontSize: 9, textAlign: "center", marginTop: 2 },
  table: { display: "flex", width: "auto" },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#e5e7eb",
    borderBottom: "1pt solid #000",
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "0.5pt solid #d1d5db",
  },
  tableRowAlt: {
    flexDirection: "row",
    backgroundColor: "#f9fafb",
    borderBottom: "0.5pt solid #d1d5db",
  },
  cell: { padding: "3pt 4pt", flex: 1, fontSize: 7 },
  cellRight: { padding: "3pt 4pt", flex: 1, fontSize: 7, textAlign: "right" },
  cellNarrow: { padding: "3pt 4pt", flex: 0.6, fontSize: 7 },
  cellNarrowRight: { padding: "3pt 4pt", flex: 0.6, fontSize: 7, textAlign: "right" },
  cellWide: { padding: "3pt 4pt", flex: 1.6, fontSize: 7 },
  totalsRow: {
    flexDirection: "row",
    borderTop: "1pt solid #000",
    backgroundColor: "#f3f4f6",
    marginTop: 4,
  },
  totalsLabel: { padding: "3pt 4pt", flex: 1, fontSize: 7, fontWeight: "bold" },
  totalsCell: { padding: "3pt 4pt", flex: 1, fontSize: 7, textAlign: "right", fontWeight: "bold" },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 30,
    right: 30,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#6b7280",
  },
})

const TAX_LINE_LABELS: Record<string, string> = {
  IVA_GENERAL: "IVA General",
  IVA_REDUCIDO: "IVA Reducido",
  IVA_ADICIONAL: "IVA Adicional",
  EXENTO: "Exento",
}

// ─── Tipos de parámetros ───────────────────────────────────────────────────────
export type InvoiceBookPDFParams = {
  companyId: string
  companyName: string
  companyRif: string
  periodId: string
  periodLabel: string       // "Enero 2026"
  invoiceType: "SALE" | "PURCHASE"
  invoices: InvoiceBookRow[]
  summary: InvoiceBookSummary
}

// ─── Encabezado de tabla ───────────────────────────────────────────────────────
function TableHeader({ invoiceType }: { invoiceType: "SALE" | "PURCHASE" }) {
  return React.createElement(
    View,
    { style: styles.tableHeader },
    React.createElement(Text, { style: styles.cell }, "Fecha"),
    React.createElement(
      Text,
      { style: styles.cellWide },
      invoiceType === "PURCHASE" ? "Proveedor" : "Cliente",
    ),
    React.createElement(Text, { style: styles.cell }, "RIF"),
    React.createElement(Text, { style: styles.cell }, "N° Factura"),
    React.createElement(Text, { style: styles.cell }, "N° Control"),
    React.createElement(Text, { style: styles.cell }, "Tipo Doc"),
    React.createElement(Text, { style: styles.cell }, "Categoría"),
    React.createElement(Text, { style: styles.cell }, "N° Doc Rel."),
    ...(invoiceType === "PURCHASE"
      ? [React.createElement(Text, { style: styles.cell }, "N° Planilla Imp.")]
      : []),
    React.createElement(Text, { style: styles.cell }, "Impuesto"),
    React.createElement(Text, { style: styles.cellRight }, "Base Imponible"),
    React.createElement(Text, { style: styles.cellNarrowRight }, "Tasa %"),
    React.createElement(Text, { style: styles.cellRight }, "Monto IVA"),
    React.createElement(Text, { style: styles.cellRight }, "IVA Retenido"),
    React.createElement(Text, { style: styles.cell }, "Comprobante IVA"),
    ...(invoiceType === "PURCHASE"
      ? [React.createElement(Text, { style: styles.cellRight }, "ISLR Retenido")]
      : []),
    ...(invoiceType === "SALE"
      ? [
          React.createElement(Text, { style: styles.cellRight }, "Base IGTF"),
          React.createElement(Text, { style: styles.cellRight }, "Monto IGTF"),
        ]
      : []),
  )
}

// ─── Fila de datos ─────────────────────────────────────────────────────────────
function InvoiceRow({
  row,
  invoiceType,
  rowIndex,
}: {
  row: InvoiceBookRow
  invoiceType: "SALE" | "PURCHASE"
  rowIndex: number
}) {
  const dateStr = new Date(row.date).toLocaleDateString("es-VE")
  const rowStyle = rowIndex % 2 === 0 ? styles.tableRow : styles.tableRowAlt

  if (row.taxLines.length === 0) {
    return React.createElement(
      View,
      { style: rowStyle },
      React.createElement(Text, { style: styles.cell }, dateStr),
      React.createElement(Text, { style: styles.cellWide }, row.counterpartName),
      React.createElement(Text, { style: styles.cell }, row.counterpartRif),
      React.createElement(Text, { style: styles.cell }, row.invoiceNumber),
      React.createElement(Text, { style: styles.cell }, row.controlNumber ?? ""),
      React.createElement(Text, { style: styles.cell }, row.docType),
      React.createElement(Text, { style: styles.cell }, row.taxCategory),
      React.createElement(Text, { style: styles.cell }, row.relatedDocNumber ?? ""),
      ...(invoiceType === "PURCHASE"
        ? [React.createElement(Text, { style: styles.cell }, row.importFormNumber ?? "")]
        : []),
      React.createElement(Text, { style: styles.cell }, "—"),
      React.createElement(Text, { style: styles.cellRight }, ""),
      React.createElement(Text, { style: styles.cellNarrowRight }, ""),
      React.createElement(Text, { style: styles.cellRight }, ""),
      React.createElement(Text, { style: styles.cellRight }, row.ivaRetentionAmount),
      React.createElement(Text, { style: styles.cell }, row.ivaRetentionVoucher ?? ""),
      ...(invoiceType === "PURCHASE"
        ? [React.createElement(Text, { style: styles.cellRight }, row.islrRetentionAmount)]
        : []),
      ...(invoiceType === "SALE"
        ? [
            React.createElement(Text, { style: styles.cellRight }, row.igtfBase),
            React.createElement(Text, { style: styles.cellRight }, row.igtfAmount),
          ]
        : []),
    )
  }

  return React.createElement(
    View,
    null,
    ...row.taxLines.map((line, idx) =>
      React.createElement(
        View,
        { style: rowStyle, key: line.id },
        React.createElement(Text, { style: styles.cell }, idx === 0 ? dateStr : ""),
        React.createElement(
          Text,
          { style: styles.cellWide },
          idx === 0 ? row.counterpartName : "",
        ),
        React.createElement(Text, { style: styles.cell }, idx === 0 ? row.counterpartRif : ""),
        React.createElement(Text, { style: styles.cell }, idx === 0 ? row.invoiceNumber : ""),
        React.createElement(
          Text,
          { style: styles.cell },
          idx === 0 ? (row.controlNumber ?? "") : "",
        ),
        React.createElement(Text, { style: styles.cell }, idx === 0 ? row.docType : ""),
        React.createElement(Text, { style: styles.cell }, idx === 0 ? row.taxCategory : ""),
        React.createElement(
          Text,
          { style: styles.cell },
          idx === 0 ? (row.relatedDocNumber ?? "") : "",
        ),
        ...(invoiceType === "PURCHASE"
          ? [
              React.createElement(
                Text,
                { style: styles.cell },
                idx === 0 ? (row.importFormNumber ?? "") : "",
              ),
            ]
          : []),
        React.createElement(
          Text,
          { style: styles.cell },
          TAX_LINE_LABELS[line.taxType] ?? line.taxType,
        ),
        React.createElement(Text, { style: styles.cellRight }, line.base),
        React.createElement(Text, { style: styles.cellNarrowRight }, line.rate),
        React.createElement(Text, { style: styles.cellRight }, line.amount),
        React.createElement(
          Text,
          { style: styles.cellRight },
          idx === 0 ? row.ivaRetentionAmount : "",
        ),
        React.createElement(
          Text,
          { style: styles.cell },
          idx === 0 ? (row.ivaRetentionVoucher ?? "") : "",
        ),
        ...(invoiceType === "PURCHASE"
          ? [
              React.createElement(
                Text,
                { style: styles.cellRight },
                idx === 0 ? row.islrRetentionAmount : "",
              ),
            ]
          : []),
        ...(invoiceType === "SALE"
          ? [
              React.createElement(
                Text,
                { style: styles.cellRight },
                idx === 0 ? row.igtfBase : "",
              ),
              React.createElement(
                Text,
                { style: styles.cellRight },
                idx === 0 ? row.igtfAmount : "",
              ),
            ]
          : []),
      ),
    ),
  )
}

// ─── Fila de totales ───────────────────────────────────────────────────────────
function TotalsRow({
  summary,
  invoiceType,
}: {
  summary: InvoiceBookSummary
  invoiceType: "SALE" | "PURCHASE"
}) {
  // Número de columnas vacías antes de Base Imponible:
  // Fecha, Proveedor/Cliente, RIF, N° Factura, N° Control, Tipo Doc, Categoría, N° Doc Rel.
  // + N° Planilla Imp. (solo PURCHASE), Impuesto
  const leadingCols = invoiceType === "PURCHASE" ? 10 : 9

  return React.createElement(
    View,
    { style: styles.totalsRow },
    React.createElement(Text, { style: { ...styles.totalsLabel, flex: leadingCols } }, "TOTALES"),
    React.createElement(Text, { style: styles.totalsCell }, summary.totalBaseGeneral),
    React.createElement(Text, { style: styles.cellNarrowRight }, ""),
    React.createElement(Text, { style: styles.totalsCell }, summary.totalIvaGeneral),
    React.createElement(Text, { style: styles.totalsCell }, summary.totalIvaRetention),
    React.createElement(Text, { style: styles.cell }, ""),
    ...(invoiceType === "PURCHASE"
      ? [React.createElement(Text, { style: styles.totalsCell }, summary.totalIslrRetention)]
      : []),
    ...(invoiceType === "SALE"
      ? [
          React.createElement(Text, { style: styles.cell }, ""),
          React.createElement(Text, { style: styles.totalsCell }, summary.totalIgtf),
        ]
      : []),
  )
}

// ─── Documento PDF ─────────────────────────────────────────────────────────────
function InvoiceBookDocument({ params }: { params: InvoiceBookPDFParams }) {
  const bookTitle =
    params.invoiceType === "SALE" ? "Libro de Ventas" : "Libro de Compras"

  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A3", orientation: "landscape", style: styles.page },
      // ── Encabezado ────────────────────────────────────────────────────────
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(Text, { style: styles.title }, params.companyName),
        React.createElement(
          Text,
          { style: styles.subtitle },
          `RIF: ${params.companyRif}`,
        ),
        React.createElement(Text, { style: styles.subtitle }, bookTitle),
        React.createElement(
          Text,
          { style: styles.subtitle },
          `Período: ${params.periodLabel}`,
        ),
      ),
      // ── Tabla ─────────────────────────────────────────────────────────────
      React.createElement(
        View,
        { style: styles.table },
        React.createElement(TableHeader, { invoiceType: params.invoiceType }),
        ...params.invoices.map((row, idx) =>
          React.createElement(InvoiceRow, {
            key: row.id,
            row,
            invoiceType: params.invoiceType,
            rowIndex: idx,
          }),
        ),
        React.createElement(TotalsRow, {
          summary: params.summary,
          invoiceType: params.invoiceType,
        }),
      ),
      // ── Footer con paginación ─────────────────────────────────────────────
      React.createElement(
        View,
        { style: styles.footer, fixed: true },
        React.createElement(
          Text,
          null,
          `${params.companyName} — ${bookTitle} — ${params.periodLabel}`,
        ),
        React.createElement(
          Text,
          { render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
            `Página ${pageNumber} de ${totalPages}` },
          null,
        ),
      ),
    ),
  )
}

// ─── Función exportada ─────────────────────────────────────────────────────────
/**
 * Genera el Libro de Compras o Ventas en formato PDF (Providencia 0071 SENIAT).
 *
 * Postcondiciones: retorna Buffer con PDF válido, listo para Response con
 * Content-Type: application/pdf
 *
 * Notas: llamar solo desde Server Action o Route Handler — no desde componente
 * cliente. Usa renderToBuffer() de @react-pdf/renderer (API server-side, sin DOM).
 * Las columnas coinciden exactamente con handleExportExcel() en InvoiceBook.tsx.
 */
export async function generateInvoiceBookPDF(params: InvoiceBookPDFParams): Promise<Buffer> {
  const element = React.createElement(InvoiceBookDocument, { params })
  return renderToBuffer(element as Parameters<typeof renderToBuffer>[0])
}
