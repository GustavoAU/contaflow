// src/modules/invoices/services/InvoiceVoucherPDFService.ts
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer"
import React from "react"
import { Decimal } from "decimal.js"

// ─── Tipos de entrada ──────────────────────────────────────────────────────────
export type InvoiceVoucherPDFParams = {
  // Empresa emisora
  companyName: string
  companyRif: string
  companyAddress?: string | null
  // Cabecera de la factura
  invoiceNumber: string
  controlNumber?: string | null
  invoiceType: "SALE" | "PURCHASE"
  docType: string
  date: Date
  // Contraparte
  counterpartName: string
  counterpartRif: string
  // Líneas de impuesto
  taxLines: Array<{
    taxType: string
    base: string
    rate: string
    amount: string
  }>
  // Retenciones (opcionales)
  ivaRetentionAmount?: string
  ivaRetentionVoucher?: string | null
  islrRetentionAmount?: string
  // IGTF (opcional)
  igtfBase?: string
  igtfAmount?: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
const TAX_LINE_LABELS: Record<string, string> = {
  IVA_GENERAL: "IVA General (16%)",
  IVA_REDUCIDO: "IVA Reducido (8%)",
  IVA_ADICIONAL: "IVA Adicional (15%)",
  EXENTO: "Exento / Exonerado",
}

const DOC_TYPE_LABELS: Record<string, string> = {
  FACTURA: "Factura",
  NOTA_DEBITO: "Nota de Débito",
  NOTA_CREDITO: "Nota de Crédito",
  REPORTE_Z: "Reporte Z",
  RESUMEN_VENTAS: "Resumen de Ventas",
  PLANILLA_IMPORTACION: "Planilla de Importación",
  OTRO: "Documento",
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("es-VE")
}

function isPositive(val?: string): boolean {
  return !!val && new Decimal(val).greaterThan(0)
}

// ─── Estilos ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: "Helvetica" },
  // Encabezado empresa
  companyHeader: { marginBottom: 16, borderBottom: "1pt solid #374151", paddingBottom: 10 },
  companyName: { fontSize: 13, fontWeight: "bold" },
  companyRif: { fontSize: 9, color: "#6b7280", marginTop: 2 },
  companyAddress: { fontSize: 8, color: "#6b7280", marginTop: 1 },
  // Título del documento
  docTitleRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  docType: { fontSize: 12, fontWeight: "bold" },
  docMeta: { fontSize: 9, textAlign: "right" },
  docMetaLabel: { fontSize: 9, color: "#6b7280" },
  // Sección info (label + valor)
  sectionHeader: {
    fontSize: 9,
    fontWeight: "bold",
    marginTop: 12,
    marginBottom: 4,
    borderBottom: "0.5pt solid #d1d5db",
    paddingBottom: 2,
    color: "#374151",
  },
  infoRow: { flexDirection: "row", marginBottom: 3 },
  infoLabel: { fontSize: 9, fontWeight: "bold", width: 100 },
  infoValue: { fontSize: 9, flex: 1 },
  // Tabla de líneas de impuesto
  table: { marginTop: 6 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderBottom: "1pt solid #374151",
    borderTop: "1pt solid #374151",
  },
  tableRow: { flexDirection: "row", borderBottom: "0.5pt solid #e5e7eb" },
  cellType: { padding: "3pt 4pt", flex: 2, fontSize: 8 },
  cellRight: { padding: "3pt 4pt", flex: 1, fontSize: 8, textAlign: "right" },
  cellNarrow: { padding: "3pt 4pt", flex: 0.6, fontSize: 8, textAlign: "right" },
  // Totales
  totalsSection: { marginTop: 10, borderTop: "1pt solid #374151" },
  totalsRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 3 },
  totalsLabel: { fontSize: 9, fontWeight: "bold", width: 160, textAlign: "right", paddingRight: 8 },
  totalsValue: { fontSize: 9, fontWeight: "bold", width: 80, textAlign: "right", fontFamily: "Helvetica" },
  totalFinalLabel: { fontSize: 11, fontWeight: "bold", width: 160, textAlign: "right", paddingRight: 8 },
  totalFinalValue: { fontSize: 11, fontWeight: "bold", width: 80, textAlign: "right" },
  // Sección retenciones / IGTF
  retentionSection: {
    marginTop: 10,
    padding: "6pt 8pt",
    backgroundColor: "#fef3c7",
    borderLeft: "3pt solid #d97706",
  },
  retentionTitle: { fontSize: 9, fontWeight: "bold", marginBottom: 4, color: "#92400e" },
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
    color: "#9ca3af",
  },
})

// ─── Componentes ───────────────────────────────────────────────────────────────

function CompanyHeader({ p }: { p: InvoiceVoucherPDFParams }) {
  return React.createElement(
    View,
    { style: styles.companyHeader },
    React.createElement(Text, { style: styles.companyName }, p.companyName),
    React.createElement(Text, { style: styles.companyRif }, `RIF: ${p.companyRif}`),
    p.companyAddress
      ? React.createElement(Text, { style: styles.companyAddress }, p.companyAddress)
      : null,
  )
}

function DocTitle({ p }: { p: InvoiceVoucherPDFParams }) {
  const docLabel = DOC_TYPE_LABELS[p.docType] ?? p.docType
  const typeLabel = p.invoiceType === "SALE" ? "Emisión" : "Recepción"

  return React.createElement(
    View,
    { style: styles.docTitleRow },
    React.createElement(Text, { style: styles.docType }, docLabel.toUpperCase()),
    React.createElement(
      View,
      null,
      React.createElement(
        Text,
        { style: styles.docMeta },
        `N° ${p.invoiceNumber}`,
      ),
      p.controlNumber
        ? React.createElement(
            Text,
            { style: styles.docMeta },
            `Control: ${p.controlNumber}`,
          )
        : null,
      React.createElement(Text, { style: styles.docMeta }, `Fecha: ${fmtDate(p.date)}`),
      React.createElement(Text, { style: styles.docMetaLabel }, typeLabel),
    ),
  )
}

function CounterpartSection({ p }: { p: InvoiceVoucherPDFParams }) {
  const label = p.invoiceType === "PURCHASE" ? "Proveedor" : "Cliente"
  return React.createElement(
    View,
    null,
    React.createElement(Text, { style: styles.sectionHeader }, label.toUpperCase()),
    React.createElement(
      View,
      { style: styles.infoRow },
      React.createElement(Text, { style: styles.infoLabel }, "Nombre:"),
      React.createElement(Text, { style: styles.infoValue }, p.counterpartName),
    ),
    React.createElement(
      View,
      { style: styles.infoRow },
      React.createElement(Text, { style: styles.infoLabel }, "RIF:"),
      React.createElement(Text, { style: styles.infoValue }, p.counterpartRif),
    ),
  )
}

function TaxLinesTable({ p }: { p: InvoiceVoucherPDFParams }) {
  return React.createElement(
    View,
    { style: styles.table },
    React.createElement(Text, { style: styles.sectionHeader }, "DETALLE FISCAL"),
    // Cabecera
    React.createElement(
      View,
      { style: styles.tableHeader },
      React.createElement(Text, { style: styles.cellType }, "Tipo de Impuesto"),
      React.createElement(Text, { style: styles.cellRight }, "Base Imponible"),
      React.createElement(Text, { style: styles.cellNarrow }, "Alícuota"),
      React.createElement(Text, { style: styles.cellRight }, "Monto IVA"),
    ),
    // Filas
    ...p.taxLines.map((line, idx) =>
      React.createElement(
        View,
        { style: styles.tableRow, key: idx.toString() },
        React.createElement(
          Text,
          { style: styles.cellType },
          TAX_LINE_LABELS[line.taxType] ?? line.taxType,
        ),
        React.createElement(Text, { style: styles.cellRight }, line.base),
        React.createElement(Text, { style: styles.cellNarrow }, `${line.rate}%`),
        React.createElement(Text, { style: styles.cellRight }, line.amount),
      ),
    ),
  )
}

function TotalsSection({ p }: { p: InvoiceVoucherPDFParams }) {
  const totalBase = p.taxLines
    .reduce((acc, l) => acc.plus(l.base), new Decimal(0))
    .toFixed(2)
  const totalIva = p.taxLines
    .reduce((acc, l) => acc.plus(l.amount), new Decimal(0))
    .toFixed(2)
  const totalInvoice = new Decimal(totalBase).plus(totalIva).toFixed(2)

  return React.createElement(
    View,
    { style: styles.totalsSection },
    React.createElement(
      View,
      { style: styles.totalsRow },
      React.createElement(Text, { style: styles.totalsLabel }, "Base Imponible Total:"),
      React.createElement(Text, { style: styles.totalsValue }, totalBase),
    ),
    React.createElement(
      View,
      { style: styles.totalsRow },
      React.createElement(Text, { style: styles.totalsLabel }, "Total IVA:"),
      React.createElement(Text, { style: styles.totalsValue }, totalIva),
    ),
    React.createElement(
      View,
      { style: styles.totalsRow },
      React.createElement(Text, { style: styles.totalFinalLabel }, "TOTAL FACTURA:"),
      React.createElement(Text, { style: styles.totalFinalValue }, totalInvoice),
    ),
  )
}

function RetentionIgtfSection({ p }: { p: InvoiceVoucherPDFParams }) {
  const hasIva = isPositive(p.ivaRetentionAmount)
  const hasIslr = isPositive(p.islrRetentionAmount)
  const hasIgtf = isPositive(p.igtfAmount)

  if (!hasIva && !hasIslr && !hasIgtf) return null

  return React.createElement(
    View,
    { style: styles.retentionSection },
    React.createElement(Text, { style: styles.retentionTitle }, "RETENCIONES / IGTF"),
    hasIva
      ? React.createElement(
          View,
          { style: styles.infoRow },
          React.createElement(Text, { style: styles.infoLabel }, "IVA Retenido:"),
          React.createElement(
            Text,
            { style: styles.infoValue },
            `${p.ivaRetentionAmount}${p.ivaRetentionVoucher ? `  Comprobante: ${p.ivaRetentionVoucher}` : ""}`,
          ),
        )
      : null,
    hasIslr
      ? React.createElement(
          View,
          { style: styles.infoRow },
          React.createElement(Text, { style: styles.infoLabel }, "ISLR Retenido:"),
          React.createElement(Text, { style: styles.infoValue }, p.islrRetentionAmount),
        )
      : null,
    hasIgtf
      ? React.createElement(
          View,
          { style: styles.infoRow },
          React.createElement(Text, { style: styles.infoLabel }, "IGTF:"),
          React.createElement(
            Text,
            { style: styles.infoValue },
            `Base: ${p.igtfBase}  Monto: ${p.igtfAmount}`,
          ),
        )
      : null,
  )
}

// ─── Documento completo ───────────────────────────────────────────────────────
function InvoiceVoucherDocument({ params }: { params: InvoiceVoucherPDFParams }) {
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", orientation: "portrait", style: styles.page },
      React.createElement(CompanyHeader, { p: params }),
      React.createElement(DocTitle, { p: params }),
      React.createElement(CounterpartSection, { p: params }),
      React.createElement(TaxLinesTable, { p: params }),
      React.createElement(TotalsSection, { p: params }),
      React.createElement(RetentionIgtfSection, { p: params }),
      // Footer con paginación
      React.createElement(
        View,
        { style: styles.footer, fixed: true },
        React.createElement(
          Text,
          null,
          `${params.companyName} — ${DOC_TYPE_LABELS[params.docType] ?? params.docType} N° ${params.invoiceNumber}`,
        ),
        React.createElement(
          Text,
          {
            render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
              `Pág. ${pageNumber} / ${totalPages}`,
          },
          null,
        ),
      ),
    ),
  )
}

// ─── Función exportada ─────────────────────────────────────────────────────────
/**
 * Genera el comprobante PDF de una factura individual (A4 portrait).
 * Incluye encabezado de empresa, datos de la contraparte, detalle fiscal
 * por líneas de IVA, totales y sección de retenciones/IGTF si aplica.
 *
 * Notas: llamar solo desde Server Action o Route Handler.
 * Usa renderToBuffer() de @react-pdf/renderer (sin DOM).
 */
export async function generateInvoiceVoucherPDF(
  params: InvoiceVoucherPDFParams,
): Promise<Buffer> {
  const element = React.createElement(InvoiceVoucherDocument, { params })
  return renderToBuffer(element as Parameters<typeof renderToBuffer>[0])
}
