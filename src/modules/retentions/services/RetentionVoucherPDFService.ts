// src/modules/retentions/services/RetentionVoucherPDFService.ts
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer"
import React from "react"
import type { Decimal } from "decimal.js"

// ─── Tipos de entrada ──────────────────────────────────────────────────────────
export type RetentionVoucherParams = {
  // Agente de retención (empresa)
  companyName: string
  companyRif: string
  companyAddress?: string
  // Datos de la retención
  voucherNumber: string             // formato "00-XXXXXXXX"
  issueDate: Date
  providerName: string
  providerRif: string
  periodLabel: string               // "Enero 2026"
  retentionType: "IVA" | "ISLR"
  retentionRate: number             // 75, 100, 2, 3, 5, etc.
  invoiceNumber: string
  invoiceDate: Date
  invoiceAmount: Decimal | string   // monto total factura
  taxableBase: Decimal | string     // base imponible
  retainedAmount: Decimal | string  // monto retenido
}

// ─── Estilos ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: "Helvetica" },
  title: { fontSize: 14, fontWeight: "bold", textAlign: "center", marginBottom: 6 },
  sectionHeader: {
    fontSize: 9,
    fontWeight: "bold",
    marginTop: 14,
    marginBottom: 4,
    borderBottom: "0.5pt solid #6b7280",
    paddingBottom: 2,
  },
  // Filas de datos info (label + valor)
  infoRow: { flexDirection: "row", marginBottom: 3 },
  infoLabel: { fontSize: 9, fontWeight: "bold", width: 120 },
  infoValue: { fontSize: 9, flex: 1 },
  // Tabla de facturas
  table: { display: "flex", width: "auto", marginTop: 4 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#e5e7eb",
    borderBottom: "1pt solid #374151",
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
  cellMed: { padding: "3pt 4pt", flex: 1.2, fontSize: 8 },
  cellRight: { padding: "3pt 4pt", flex: 1, fontSize: 8, textAlign: "right" },
  cellNarrow: { padding: "3pt 4pt", flex: 0.7, fontSize: 8, textAlign: "right" },
  // Totales
  totalsRow: {
    flexDirection: "row",
    borderTop: "1pt solid #374151",
    backgroundColor: "#f3f4f6",
    marginTop: 4,
  },
  totalsLabel: { padding: "3pt 4pt", flex: 2.4, fontSize: 9, fontWeight: "bold" },
  totalsCell: { padding: "3pt 4pt", flex: 1, fontSize: 9, textAlign: "right", fontWeight: "bold" },
  totalsCellDouble: { padding: "3pt 4pt", flex: 0.7, fontSize: 9, textAlign: "right", fontWeight: "bold" },
  // Tipo de retención
  retentionTypeRow: {
    flexDirection: "row",
    marginTop: 10,
    padding: "4pt 6pt",
    backgroundColor: "#f3f4f6",
    borderLeft: "3pt solid #374151",
  },
  retentionTypeLabel: { fontSize: 9, fontWeight: "bold", marginRight: 6 },
  retentionTypeValue: { fontSize: 9 },
  // Footer
  footer: {
    position: "absolute",
    bottom: 28,
    left: 40,
    right: 40,
    borderTop: "0.5pt solid #d1d5db",
    paddingTop: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#6b7280",
  },
  footerNote: {
    position: "absolute",
    bottom: 44,
    left: 40,
    right: 40,
    fontSize: 8,
    textAlign: "center",
    color: "#374151",
    fontStyle: "italic",
  },
})

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("es-VE")
}

function fmtAmount(val: Decimal | string): string {
  return Number(val).toFixed(2)
}

function retentionTypeLabel(type: "IVA" | "ISLR", rate: number): string {
  if (type === "IVA") {
    return `Retención IVA ${rate}%`
  }
  return `Retención ISLR - Decreto 1808 - ${rate}%`
}

// ─── Componente encabezado ────────────────────────────────────────────────────
function VoucherHeader({ params }: { params: RetentionVoucherParams }) {
  return React.createElement(
    View,
    null,
    // Título
    React.createElement(Text, { style: styles.title }, "COMPROBANTE DE RETENCIÓN"),
    // Datos agente de retención
    React.createElement(
      View,
      { style: styles.infoRow },
      React.createElement(Text, { style: styles.infoLabel }, "Agente de Retención:"),
      React.createElement(Text, { style: styles.infoValue }, params.companyName),
    ),
    React.createElement(
      View,
      { style: styles.infoRow },
      React.createElement(Text, { style: styles.infoLabel }, "RIF:"),
      React.createElement(Text, { style: styles.infoValue }, params.companyRif),
    ),
    params.companyAddress
      ? React.createElement(
          View,
          { style: styles.infoRow },
          React.createElement(Text, { style: styles.infoLabel }, "Dirección:"),
          React.createElement(Text, { style: styles.infoValue }, params.companyAddress),
        )
      : null,
    // Número de comprobante y fecha
    React.createElement(
      View,
      { style: styles.infoRow },
      React.createElement(Text, { style: styles.infoLabel }, "N° Comprobante:"),
      React.createElement(Text, { style: styles.infoValue }, params.voucherNumber),
    ),
    React.createElement(
      View,
      { style: styles.infoRow },
      React.createElement(Text, { style: styles.infoLabel }, "Fecha de Emisión:"),
      React.createElement(Text, { style: styles.infoValue }, fmtDate(params.issueDate)),
    ),
  )
}

// ─── Componente datos del proveedor ──────────────────────────────────────────
function ProviderSection({ params }: { params: RetentionVoucherParams }) {
  return React.createElement(
    View,
    null,
    React.createElement(Text, { style: styles.sectionHeader }, "DATOS DEL PROVEEDOR"),
    React.createElement(
      View,
      { style: styles.infoRow },
      React.createElement(Text, { style: styles.infoLabel }, "Proveedor:"),
      React.createElement(Text, { style: styles.infoValue }, params.providerName),
    ),
    React.createElement(
      View,
      { style: styles.infoRow },
      React.createElement(Text, { style: styles.infoLabel }, "RIF Proveedor:"),
      React.createElement(Text, { style: styles.infoValue }, params.providerRif),
    ),
    React.createElement(
      View,
      { style: styles.infoRow },
      React.createElement(Text, { style: styles.infoLabel }, "Período Fiscal:"),
      React.createElement(Text, { style: styles.infoValue }, params.periodLabel),
    ),
  )
}

// ─── Componente tabla de facturas ─────────────────────────────────────────────
function InvoicesTable({ params }: { params: RetentionVoucherParams }) {
  return React.createElement(
    View,
    { style: styles.table },
    // Encabezado
    React.createElement(
      View,
      { style: styles.tableHeader },
      React.createElement(Text, { style: styles.cellMed }, "N° Factura"),
      React.createElement(Text, { style: styles.cellMed }, "Fecha"),
      React.createElement(Text, { style: styles.cellRight }, "Monto Factura"),
      React.createElement(Text, { style: styles.cellRight }, "Base Imponible"),
      React.createElement(Text, { style: styles.cellNarrow }, "Alícuota"),
      React.createElement(Text, { style: styles.cellRight }, "Monto Retenido"),
    ),
    // Fila de datos
    React.createElement(
      View,
      { style: styles.tableRow },
      React.createElement(Text, { style: styles.cellMed }, params.invoiceNumber),
      React.createElement(Text, { style: styles.cellMed }, fmtDate(params.invoiceDate)),
      React.createElement(Text, { style: styles.cellRight }, fmtAmount(params.invoiceAmount)),
      React.createElement(Text, { style: styles.cellRight }, fmtAmount(params.taxableBase)),
      React.createElement(Text, { style: styles.cellNarrow }, `${params.retentionRate}%`),
      React.createElement(Text, { style: styles.cellRight }, fmtAmount(params.retainedAmount)),
    ),
  )
}

// ─── Componente totales ───────────────────────────────────────────────────────
function TotalsSection({ params }: { params: RetentionVoucherParams }) {
  return React.createElement(
    View,
    null,
    React.createElement(
      View,
      { style: styles.totalsRow },
      React.createElement(Text, { style: styles.totalsLabel }, "TOTAL BASE IMPONIBLE"),
      React.createElement(Text, { style: styles.cellRight }, ""),
      React.createElement(Text, { style: styles.totalsCell }, fmtAmount(params.taxableBase)),
      React.createElement(Text, { style: styles.totalsCellDouble }, ""),
      React.createElement(Text, { style: styles.cellRight }, ""),
    ),
    React.createElement(
      View,
      { style: styles.totalsRow },
      React.createElement(Text, { style: styles.totalsLabel }, "TOTAL MONTO RETENIDO"),
      React.createElement(Text, { style: styles.cellRight }, ""),
      React.createElement(Text, { style: styles.cellRight }, ""),
      React.createElement(Text, { style: styles.totalsCellDouble }, ""),
      React.createElement(Text, { style: styles.totalsCell }, fmtAmount(params.retainedAmount)),
    ),
    // Tipo de retención
    React.createElement(
      View,
      { style: styles.retentionTypeRow },
      React.createElement(Text, { style: styles.retentionTypeLabel }, "Tipo de Retención:"),
      React.createElement(
        Text,
        { style: styles.retentionTypeValue },
        retentionTypeLabel(params.retentionType, params.retentionRate),
      ),
    ),
  )
}

// ─── Documento completo ───────────────────────────────────────────────────────
function RetentionVoucherDocument({ params }: { params: RetentionVoucherParams }) {
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", orientation: "portrait", style: styles.page },
      // Encabezado
      React.createElement(VoucherHeader, { params }),
      // Proveedor
      React.createElement(ProviderSection, { params }),
      // Tabla de facturas
      React.createElement(Text, { style: styles.sectionHeader }, "FACTURAS RETENIDAS"),
      React.createElement(InvoicesTable, { params }),
      // Totales
      React.createElement(Text, { style: styles.sectionHeader }, "RESUMEN"),
      React.createElement(TotalsSection, { params }),
      // Nota de validez
      React.createElement(
        Text,
        { style: styles.footerNote, fixed: true },
        "Este comprobante es válido sin firma ni sello",
      ),
      // Footer con paginación
      React.createElement(
        View,
        { style: styles.footer, fixed: true },
        React.createElement(
          Text,
          null,
          `${params.companyName} — Comprobante N° ${params.voucherNumber} — ${params.periodLabel}`,
        ),
        React.createElement(
          Text,
          {
            render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
              `Página ${pageNumber} de ${totalPages}`,
          },
          null,
        ),
      ),
    ),
  )
}

// ─── Función exportada ─────────────────────────────────────────────────────────
/**
 * Genera el comprobante de retención en formato PDF
 * (Providencia 0071 SENIAT + Decreto 1808).
 *
 * Postcondiciones: retorna Buffer con PDF válido, listo para Response con
 * Content-Type: application/pdf
 *
 * Notas: llamar solo desde Server Action o Route Handler — no desde componente
 * cliente. Usa renderToBuffer() de @react-pdf/renderer (API server-side, sin DOM).
 */
export async function generateRetentionVoucherPDF(
  params: RetentionVoucherParams,
): Promise<Buffer> {
  const element = React.createElement(RetentionVoucherDocument, { params })
  return renderToBuffer(element as Parameters<typeof renderToBuffer>[0])
}
