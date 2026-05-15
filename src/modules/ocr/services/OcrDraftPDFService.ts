// src/modules/ocr/services/OcrDraftPDFService.ts
// Genera un comprobante PDF "BORRADOR" a partir de datos extraídos por OCR.
// Bloque C ítem 4 — PDF en módulo OCR.
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer"
import React from "react"
import type { ExtractedInvoice } from "../schemas/invoice.schema"

export type OcrDraftPDFParams = {
  extracted: ExtractedInvoice
  companyName: string
  companyRif: string
  companyAddress?: string | null
  extractedAt: Date
}

// ─── Labels ───────────────────────────────────────────────────────────────────

const CURRENCY_LABELS: Record<string, string> = {
  VES: "Bolívares (VES)",
  USD: "Dólares (USD)",
  EUR: "Euros (EUR)",
}

const PAYMENT_LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TARJETA: "Tarjeta",
  PAGO_MOVIL: "Pago Móvil",
  ZELLE: "Zelle",
  CASHEA: "Cashea",
  TRANSFERENCIA: "Transferencia",
  OTRO: "Otro",
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: "Helvetica" },

  // Encabezado
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    borderBottom: "1pt solid #374151",
    paddingBottom: 10,
  },
  companyBlock: { flex: 1 },
  companyName: { fontSize: 13, fontWeight: "bold" },
  companyRif: { fontSize: 9, color: "#6b7280", marginTop: 2 },
  companyAddress: { fontSize: 8, color: "#6b7280", marginTop: 1 },
  draftBadge: {
    backgroundColor: "#fef3c7",
    borderLeft: "3pt solid #d97706",
    paddingTop: 4,
    paddingBottom: 4,
    paddingLeft: 8,
    paddingRight: 8,
    alignSelf: "flex-start",
  },
  draftText: { fontSize: 10, fontWeight: "bold", color: "#92400e" },
  draftSub: { fontSize: 7, color: "#b45309", marginTop: 2 },

  // Título
  title: { fontSize: 12, fontWeight: "bold", marginBottom: 2 },
  titleMeta: { fontSize: 8, color: "#6b7280", marginBottom: 10 },

  // Secciones
  sectionHeader: {
    fontSize: 9,
    fontWeight: "bold",
    marginTop: 12,
    marginBottom: 4,
    borderBottom: "0.5pt solid #d1d5db",
    paddingBottom: 2,
    color: "#374151",
  },

  // Grid de información (2 columnas)
  infoGrid: { flexDirection: "row", flexWrap: "wrap" },
  infoCell: { width: "50%", marginBottom: 5 },
  infoCellFull: { width: "100%", marginBottom: 5 },
  infoLabel: { fontSize: 8, color: "#6b7280" },
  infoValue: { fontSize: 9 },

  // Tabla fiscal
  table: { marginTop: 4 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderBottom: "1pt solid #374151",
    borderTop: "1pt solid #374151",
  },
  tableRow: { flexDirection: "row", borderBottom: "0.5pt solid #e5e7eb" },
  cellDesc: { padding: "3pt 4pt", flex: 3, fontSize: 8 },
  cellRight: { padding: "3pt 4pt", flex: 1.2, fontSize: 8, textAlign: "right" },
  cellNarrow: { padding: "3pt 4pt", flex: 0.7, fontSize: 8, textAlign: "right" },

  // Tabla de ítems
  itemHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderBottom: "1pt solid #374151",
    borderTop: "1pt solid #374151",
  },
  itemRow: { flexDirection: "row", borderBottom: "0.5pt solid #e5e7eb" },
  itemDesc: { padding: "3pt 4pt", flex: 4, fontSize: 8 },
  itemNum: { padding: "3pt 4pt", flex: 1, fontSize: 8, textAlign: "right" },

  // Total
  totalsSection: { marginTop: 10, borderTop: "1pt solid #374151" },
  totalsRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 4 },
  totalLabel: { fontSize: 11, fontWeight: "bold", width: 160, textAlign: "right", paddingRight: 8 },
  totalValue: { fontSize: 11, fontWeight: "bold", width: 80, textAlign: "right" },

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

// ─── Helper ───────────────────────────────────────────────────────────────────

function fmtLocal(d: Date): string {
  return d.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric" })
}

// ─── Función exportada ────────────────────────────────────────────────────────

export async function generateOcrDraftPDF(params: OcrDraftPDFParams): Promise<Buffer> {
  const { extracted, companyName, companyRif, companyAddress, extractedAt } = params

  // Construir filas de impuestos
  type TaxRow = { label: string; base: string; rate: string; iva: string }
  const taxRows: TaxRow[] = []
  if (extracted.baseImponibleGeneral ?? extracted.ivaGeneral) {
    taxRows.push({
      label: "IVA General (16%)",
      base: extracted.baseImponibleGeneral ?? "—",
      rate: "16",
      iva: extracted.ivaGeneral ?? "—",
    })
  }
  if (extracted.baseImponibleReducida ?? extracted.ivaReducido) {
    taxRows.push({
      label: "IVA Reducido (8%)",
      base: extracted.baseImponibleReducida ?? "—",
      rate: "8",
      iva: extracted.ivaReducido ?? "—",
    })
  }
  if (extracted.baseImponibleAdicional ?? extracted.ivaAdicional) {
    taxRows.push({
      label: "IVA Adicional (+15%)",
      base: extracted.baseImponibleAdicional ?? "—",
      rate: "15",
      iva: extracted.ivaAdicional ?? "—",
    })
  }

  const hasItems = extracted.items && extracted.items.length > 0

  const doc = React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", orientation: "portrait", style: S.page },

      // ── Encabezado empresa + badge BORRADOR ──
      React.createElement(
        View,
        { style: S.headerRow },
        React.createElement(
          View,
          { style: S.companyBlock },
          React.createElement(Text, { style: S.companyName }, companyName),
          React.createElement(Text, { style: S.companyRif }, `RIF: ${companyRif}`),
          companyAddress
            ? React.createElement(Text, { style: S.companyAddress }, companyAddress)
            : null,
        ),
        React.createElement(
          View,
          { style: S.draftBadge },
          React.createElement(Text, { style: S.draftText }, "BORRADOR"),
          React.createElement(Text, { style: S.draftSub }, "Datos extraídos por IA"),
        ),
      ),

      // ── Título ──
      React.createElement(
        Text,
        { style: S.title },
        "COMPROBANTE DE ESCANEO OCR",
      ),
      React.createElement(
        Text,
        { style: S.titleMeta },
        `Extraído el ${fmtLocal(extractedAt)}  ·  Precisión ~95% — Verificar antes de registrar`,
      ),

      // ── Datos del emisor ──
      React.createElement(Text, { style: S.sectionHeader }, "DATOS DEL EMISOR"),
      React.createElement(
        View,
        { style: S.infoGrid },
        React.createElement(
          View,
          { style: S.infoCell },
          React.createElement(Text, { style: S.infoLabel }, "Razón Social"),
          React.createElement(Text, { style: S.infoValue }, extracted.razonSocial ?? "—"),
        ),
        React.createElement(
          View,
          { style: S.infoCell },
          React.createElement(Text, { style: S.infoLabel }, "RIF"),
          React.createElement(Text, { style: S.infoValue }, extracted.rif ?? "—"),
        ),
        React.createElement(
          View,
          { style: S.infoCell },
          React.createElement(Text, { style: S.infoLabel }, "N° Factura"),
          React.createElement(Text, { style: S.infoValue }, extracted.numeroFactura ?? "—"),
        ),
        React.createElement(
          View,
          { style: S.infoCell },
          React.createElement(Text, { style: S.infoLabel }, "N° Control"),
          React.createElement(Text, { style: S.infoValue }, extracted.numeroControl ?? "—"),
        ),
        React.createElement(
          View,
          { style: S.infoCell },
          React.createElement(Text, { style: S.infoLabel }, "Fecha de Emisión"),
          React.createElement(Text, { style: S.infoValue }, extracted.fechaEmision ?? "—"),
        ),
        React.createElement(
          View,
          { style: S.infoCell },
          React.createElement(Text, { style: S.infoLabel }, "Moneda"),
          React.createElement(
            Text,
            { style: S.infoValue },
            extracted.currency
              ? (CURRENCY_LABELS[extracted.currency] ?? extracted.currency)
              : "—",
          ),
        ),
        extracted.paymentMethod
          ? React.createElement(
              View,
              { style: S.infoCell },
              React.createElement(Text, { style: S.infoLabel }, "Método de Pago"),
              React.createElement(
                Text,
                { style: S.infoValue },
                PAYMENT_LABELS[extracted.paymentMethod] ?? extracted.paymentMethod,
              ),
            )
          : null,
      ),

      // Notas (fuera del grid — ancho completo)
      extracted.notes
        ? React.createElement(
            View,
            { style: S.infoCellFull },
            React.createElement(Text, { style: S.infoLabel }, "Notas"),
            React.createElement(Text, { style: S.infoValue }, extracted.notes),
          )
        : null,

      // ── Detalle fiscal ──
      taxRows.length > 0
        ? React.createElement(
            View,
            { style: S.table },
            React.createElement(Text, { style: S.sectionHeader }, "DETALLE FISCAL"),
            React.createElement(
              View,
              { style: S.tableHeader },
              React.createElement(Text, { style: S.cellDesc }, "Tipo de Impuesto"),
              React.createElement(Text, { style: S.cellRight }, "Base Imponible"),
              React.createElement(Text, { style: S.cellNarrow }, "Alíc."),
              React.createElement(Text, { style: S.cellRight }, "Monto IVA"),
            ),
            ...taxRows.map((row, idx) =>
              React.createElement(
                View,
                { style: S.tableRow, key: idx.toString() },
                React.createElement(Text, { style: S.cellDesc }, row.label),
                React.createElement(Text, { style: S.cellRight }, row.base),
                React.createElement(Text, { style: S.cellNarrow }, `${row.rate}%`),
                React.createElement(Text, { style: S.cellRight }, row.iva),
              ),
            ),
          )
        : null,

      // ── Líneas de factura ──
      hasItems
        ? React.createElement(
            View,
            { style: S.table },
            React.createElement(Text, { style: S.sectionHeader }, "LÍNEAS DE FACTURA"),
            React.createElement(
              View,
              { style: S.itemHeader },
              React.createElement(Text, { style: S.itemDesc }, "Descripción"),
              React.createElement(Text, { style: S.itemNum }, "Cant."),
              React.createElement(Text, { style: S.itemNum }, "P/Unitario"),
              React.createElement(Text, { style: S.itemNum }, "Total"),
            ),
            ...extracted.items!.map((item, idx) =>
              React.createElement(
                View,
                { style: S.itemRow, key: idx.toString() },
                React.createElement(Text, { style: S.itemDesc }, item.description),
                React.createElement(Text, { style: S.itemNum }, item.quantity ?? "—"),
                React.createElement(Text, { style: S.itemNum }, item.unitPrice ?? "—"),
                React.createElement(Text, { style: S.itemNum }, item.totalPrice ?? "—"),
              ),
            ),
          )
        : null,

      // ── Monto total ──
      extracted.montoTotal
        ? React.createElement(
            View,
            { style: S.totalsSection },
            React.createElement(
              View,
              { style: S.totalsRow },
              React.createElement(Text, { style: S.totalLabel }, "MONTO TOTAL:"),
              React.createElement(Text, { style: S.totalValue }, extracted.montoTotal),
            ),
          )
        : null,

      // ── Footer ──
      React.createElement(
        View,
        { style: S.footer, fixed: true },
        React.createElement(
          Text,
          null,
          `ContaFlow · Comprobante OCR${extracted.numeroFactura ? ` · Factura N° ${extracted.numeroFactura}` : ""}`,
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

  return renderToBuffer(doc as Parameters<typeof renderToBuffer>[0])
}
