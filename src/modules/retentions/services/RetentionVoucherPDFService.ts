// src/modules/retentions/services/RetentionVoucherPDFService.ts
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer"
import React from "react"
import type { Decimal } from "decimal.js"
import { fmtDate } from "@/lib/format"

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
  retentionType: "IVA" | "ISLR" | "AMBAS"
  invoiceNumber: string
  invoiceDate: Date
  invoiceAmount: Decimal | string   // monto total factura
  taxableBase: Decimal | string     // base imponible
  retainedAmount: Decimal | string  // total retenido
  // Desglose por tipo (obligatorio para AMBAS; opcional en tipos simples)
  ivaRetention?: Decimal | string
  ivaRetentionPct?: number
  islrAmount?: Decimal | string
  islrRetentionPct?: number
  incesAmount?: Decimal | string
  incesRetentionPct?: number
  fatAmount?: Decimal | string
  fatRetentionPct?: number
  // Usado en IVA-only / ISLR-only (tasa única)
  retentionRate?: number
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
  // Tabla de facturas (sección encabezado de factura)
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
  cellType: { padding: "3pt 4pt", flex: 1.4, fontSize: 8 },
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
function fmtAmount(val: Decimal | string | null | undefined): string {
  if (val == null) return "0.00"
  return Number(val).toFixed(2)
}

type RetentionLine = {
  label: string
  base: string
  rate: string
  amount: string
}

function buildRetentionLines(params: RetentionVoucherParams): RetentionLine[] {
  if (params.retentionType === "IVA") {
    return [{
      label: "Retención IVA",
      base: fmtAmount(params.taxableBase),
      rate: `${params.ivaRetentionPct ?? params.retentionRate ?? 0}%`,
      amount: fmtAmount(params.ivaRetention ?? params.retainedAmount),
    }]
  }
  if (params.retentionType === "ISLR") {
    return [{
      label: "Ret. ISLR Dec. 1808",
      base: fmtAmount(params.taxableBase),
      rate: `${params.islrRetentionPct ?? params.retentionRate ?? 0}%`,
      amount: fmtAmount(params.islrAmount ?? params.retainedAmount),
    }]
  }
  // AMBAS — una fila por tipo con monto > 0
  const lines: RetentionLine[] = []
  if (params.ivaRetention && Number(params.ivaRetention) > 0) {
    lines.push({
      label: "IVA",
      base: fmtAmount(params.taxableBase),
      rate: `${params.ivaRetentionPct ?? 0}%`,
      amount: fmtAmount(params.ivaRetention),
    })
  }
  if (params.islrAmount && Number(params.islrAmount) > 0) {
    lines.push({
      label: "ISLR Dec. 1808",
      base: fmtAmount(params.taxableBase),
      rate: `${params.islrRetentionPct ?? 0}%`,
      amount: fmtAmount(params.islrAmount),
    })
  }
  if (params.incesAmount && Number(params.incesAmount) > 0) {
    lines.push({
      label: "INCES",
      base: fmtAmount(params.taxableBase),
      rate: `${params.incesRetentionPct ?? 2}%`,
      amount: fmtAmount(params.incesAmount),
    })
  }
  if (params.fatAmount && Number(params.fatAmount) > 0) {
    lines.push({
      label: "FAT",
      base: fmtAmount(params.taxableBase),
      rate: `${params.fatRetentionPct ?? 0.75}%`,
      amount: fmtAmount(params.fatAmount),
    })
  }
  return lines
}

function retentionTypeSummary(params: RetentionVoucherParams): string {
  if (params.retentionType === "IVA") {
    return `Retención IVA ${params.ivaRetentionPct ?? params.retentionRate ?? 0}%`
  }
  if (params.retentionType === "ISLR") {
    return `Retención ISLR - Decreto 1808 - ${params.islrRetentionPct ?? params.retentionRate ?? 0}%`
  }
  const parts = ["IVA", "ISLR"]
  if (params.incesAmount && Number(params.incesAmount) > 0) parts.push("INCES")
  if (params.fatAmount && Number(params.fatAmount) > 0) parts.push("FAT")
  return `Retención AMBAS: ${parts.join(" + ")}`
}

// ─── Componente encabezado ────────────────────────────────────────────────────
function VoucherHeader({ params }: { params: RetentionVoucherParams }) {
  return React.createElement(
    View,
    null,
    React.createElement(Text, { style: styles.title }, "COMPROBANTE DE RETENCIÓN"),
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

// ─── Tabla de encabezado de factura ──────────────────────────────────────────
function InvoiceInfoTable({ params }: { params: RetentionVoucherParams }) {
  return React.createElement(
    View,
    { style: styles.table },
    React.createElement(
      View,
      { style: styles.tableHeader },
      React.createElement(Text, { style: styles.cellMed }, "N° Factura"),
      React.createElement(Text, { style: styles.cellMed }, "Fecha"),
      React.createElement(Text, { style: styles.cellRight }, "Monto Factura"),
    ),
    React.createElement(
      View,
      { style: styles.tableRow },
      React.createElement(Text, { style: styles.cellMed }, params.invoiceNumber),
      React.createElement(Text, { style: styles.cellMed }, fmtDate(params.invoiceDate)),
      React.createElement(Text, { style: styles.cellRight }, fmtAmount(params.invoiceAmount)),
    ),
  )
}

// ─── Tabla de desglose de retenciones ─────────────────────────────────────────
function RetentionBreakdownTable({ params }: { params: RetentionVoucherParams }) {
  const lines = buildRetentionLines(params)
  return React.createElement(
    View,
    { style: styles.table },
    // Encabezado
    React.createElement(
      View,
      { style: styles.tableHeader },
      React.createElement(Text, { style: styles.cellType }, "Tipo de Retención"),
      React.createElement(Text, { style: styles.cellRight }, "Base Imponible"),
      React.createElement(Text, { style: styles.cellNarrow }, "Alícuota"),
      React.createElement(Text, { style: styles.cellRight }, "Monto Retenido"),
    ),
    // Una fila por tipo
    ...lines.map((line, i) =>
      React.createElement(
        View,
        { key: String(i), style: i % 2 === 0 ? styles.tableRow : styles.tableRowAlt },
        React.createElement(Text, { style: styles.cellType }, line.label),
        React.createElement(Text, { style: styles.cellRight }, line.base),
        React.createElement(Text, { style: styles.cellNarrow }, line.rate),
        React.createElement(Text, { style: styles.cellRight }, line.amount),
      )
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
      React.createElement(Text, { style: styles.totalsCellDouble }, ""),
      React.createElement(Text, { style: styles.totalsCell }, fmtAmount(params.taxableBase)),
    ),
    React.createElement(
      View,
      { style: styles.totalsRow },
      React.createElement(Text, { style: styles.totalsLabel }, "TOTAL MONTO RETENIDO"),
      React.createElement(Text, { style: styles.cellRight }, ""),
      React.createElement(Text, { style: styles.totalsCellDouble }, ""),
      React.createElement(Text, { style: styles.totalsCell }, fmtAmount(params.retainedAmount)),
    ),
    React.createElement(
      View,
      { style: styles.retentionTypeRow },
      React.createElement(Text, { style: styles.retentionTypeLabel }, "Tipo de Retención:"),
      React.createElement(Text, { style: styles.retentionTypeValue }, retentionTypeSummary(params)),
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
      React.createElement(VoucherHeader, { params }),
      React.createElement(ProviderSection, { params }),
      React.createElement(Text, { style: styles.sectionHeader }, "FACTURA RETENIDA"),
      React.createElement(InvoiceInfoTable, { params }),
      React.createElement(Text, { style: styles.sectionHeader }, "DESGLOSE DE RETENCIONES"),
      React.createElement(RetentionBreakdownTable, { params }),
      React.createElement(Text, { style: styles.sectionHeader }, "RESUMEN"),
      React.createElement(TotalsSection, { params }),
      React.createElement(
        Text,
        { style: styles.footerNote, fixed: true },
        "Este comprobante es válido sin firma ni sello",
      ),
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
export async function generateRetentionVoucherPDF(
  params: RetentionVoucherParams,
): Promise<Buffer> {
  const element = React.createElement(RetentionVoucherDocument, { params })
  return renderToBuffer(element as Parameters<typeof renderToBuffer>[0])
}
