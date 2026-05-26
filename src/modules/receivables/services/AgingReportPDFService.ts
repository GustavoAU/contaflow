// src/modules/receivables/services/AgingReportPDFService.ts
// PDF: Reporte de Antigüedad de Saldos (CxC / CxP) — A4 landscape

import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import type { AgingReport, AgingBucket, AgingBucketSummary, ReceivableRow } from "./ReceivableService";

const e = React.createElement;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(value: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function fmtDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("es-VE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const BUCKET_LABELS: Record<AgingBucket, string> = {
  CURRENT: "Corriente",
  OVERDUE_31_60: "31-60 dias",
  OVERDUE_61_90: "61-90 dias",
  OVERDUE_91_120: "91-120 dias",
  OVERDUE_120_PLUS: "+120 dias",
};

const BUCKET_COLORS: Record<AgingBucket, string> = {
  CURRENT:          "#16a34a",
  OVERDUE_31_60:    "#ca8a04",
  OVERDUE_61_90:    "#d97706",
  OVERDUE_91_120:   "#ea580c",
  OVERDUE_120_PLUS: "#dc2626",
};

const BUCKET_BG: Record<AgingBucket, string> = {
  CURRENT:          "#f0fdf4",
  OVERDUE_31_60:    "#fefce8",
  OVERDUE_61_90:    "#fffbeb",
  OVERDUE_91_120:   "#fff7ed",
  OVERDUE_120_PLUS: "#fef2f2",
};

const BUCKET_ORDER: AgingBucket[] = [
  "CURRENT",
  "OVERDUE_31_60",
  "OVERDUE_61_90",
  "OVERDUE_91_120",
  "OVERDUE_120_PLUS",
];

// ─── Estilos ──────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  page:            { padding: 32, fontSize: 8, fontFamily: "Helvetica" },
  // Encabezado
  header:          { marginBottom: 12, borderBottom: "1pt solid #e5e7eb", paddingBottom: 8 },
  title:           { fontSize: 13, fontWeight: "bold", color: "#111827" },
  companyLine:     { fontSize: 8, color: "#374151", marginTop: 2 },
  dateLabel:       { fontSize: 7, color: "#9ca3af", marginTop: 1 },
  // Tarjetas de bucket
  bucketsRow:      { flexDirection: "row", marginBottom: 12 },
  bucketCard:      { flex: 1, borderRadius: 4, padding: 6, border: "1pt solid #e5e7eb", marginRight: 4 },
  bucketLabel:     { fontSize: 7, fontWeight: "bold", marginBottom: 2 },
  bucketCount:     { fontSize: 16, fontWeight: "bold", marginBottom: 1 },
  bucketAmt:       { fontSize: 7 },
  // Resumen totales
  totalsRow:       { flexDirection: "row", marginBottom: 12, backgroundColor: "#f9fafb", padding: 8, borderRadius: 4 },
  totalItem:       { marginRight: 20 },
  totalLabel:      { fontSize: 7, color: "#6b7280" },
  totalValue:      { fontSize: 9, fontWeight: "bold", fontFamily: "Helvetica", color: "#111827" },
  // Tabla
  tableHeader:     { flexDirection: "row", backgroundColor: "#1f2937", padding: 4 },
  tableHeaderText: { fontSize: 7, fontWeight: "bold", color: "#ffffff" },
  tableRow:        { flexDirection: "row", borderBottom: "0.5pt solid #e5e7eb", padding: 3 },
  tableRowAlt:     { flexDirection: "row", backgroundColor: "#f9fafb", borderBottom: "0.5pt solid #e5e7eb", padding: 3 },
  cellText:        { fontSize: 7, color: "#374151" },
  cellMono:        { fontSize: 7, color: "#374151", fontFamily: "Helvetica" },
  cellMuted:       { fontSize: 7, color: "#9ca3af" },
  cellRight:       { textAlign: "right" },
  // Badge
  badge:           { borderRadius: 10, paddingLeft: 4, paddingRight: 4, paddingTop: 1, paddingBottom: 1 },
  badgeText:       { fontSize: 6, fontWeight: "bold" },
  // Footer
  footer:          { position: "absolute", bottom: 20, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", borderTop: "0.5pt solid #e5e7eb", paddingTop: 6 },
  footerText:      { fontSize: 6, color: "#9ca3af" },
});

// ─── Widths columnas (landscape A4 ~770pt usable) ─────────────────────────────

const W = {
  counterpart: 140,
  invoice:      70,
  date:         52,
  dueDate:      52,
  total:        74,
  paid:         74,
  pending:      74,
  bucket:       64,
};

// ─── Sub-componentes (React.createElement) ───────────────────────────────────

function BucketCard({ summary }: { summary: AgingBucketSummary }) {
  const color = BUCKET_COLORS[summary.bucket];
  const bg    = BUCKET_BG[summary.bucket];
  return e(View, { style: [S.bucketCard, { backgroundColor: bg }] },
    e(Text, { style: [S.bucketLabel,  { color }] }, BUCKET_LABELS[summary.bucket]),
    e(Text, { style: [S.bucketCount,  { color }] }, String(summary.count)),
    e(Text, { style: [S.bucketAmt,    { color }] },
      summary.count === 0 ? "—" : `Bs. ${fmt(summary.totalPendingVes)}`
    )
  );
}

function TableHeader({ reportType }: { reportType: "CXC" | "CXP" }) {
  const counterpartLabel = reportType === "CXC" ? "Cliente" : "Proveedor";
  return e(View, { style: S.tableHeader },
    e(Text, { style: [S.tableHeaderText, { width: W.counterpart }] }, counterpartLabel),
    e(Text, { style: [S.tableHeaderText, { width: W.invoice }]     }, "Factura / Control"),
    e(Text, { style: [S.tableHeaderText, { width: W.date }]        }, "Fecha"),
    e(Text, { style: [S.tableHeaderText, { width: W.dueDate }]     }, "Vencimiento"),
    e(Text, { style: [S.tableHeaderText, { width: W.total,   textAlign: "right" }] }, "Total Bs."),
    e(Text, { style: [S.tableHeaderText, { width: W.paid,    textAlign: "right" }] }, "Pagado Bs."),
    e(Text, { style: [S.tableHeaderText, { width: W.pending, textAlign: "right" }] }, "Pendiente Bs."),
    e(Text, { style: [S.tableHeaderText, { width: W.bucket }]      }, "Antiguedad"),
  );
}

function TableRow({ row, isAlt }: { row: ReceivableRow; isAlt: boolean }) {
  const rowStyle   = isAlt ? S.tableRowAlt : S.tableRow;
  const color      = BUCKET_COLORS[row.bucket];
  const bucketBg   = BUCKET_BG[row.bucket];
  const isOverdue  = row.bucket !== "CURRENT";

  return e(View, { style: rowStyle, wrap: false },
    // Contraparte
    e(View, { style: { width: W.counterpart } },
      e(Text, { style: S.cellText  }, row.counterpartName),
      row.counterpartRif
        ? e(Text, { style: S.cellMuted }, row.counterpartRif)
        : null
    ),
    // Factura
    e(View, { style: { width: W.invoice } },
      e(Text, { style: S.cellMono }, row.invoiceNumber),
      row.controlNumber
        ? e(Text, { style: S.cellMuted }, row.controlNumber)
        : null
    ),
    // Fecha
    e(Text, { style: [S.cellText, { width: W.date  }] }, fmtDate(row.invoiceDate)),
    // Vencimiento
    e(Text, { style: [S.cellText, { width: W.dueDate, color: isOverdue ? color : "#374151" }] }, fmtDate(row.dueDate)),
    // Total
    e(Text, { style: [S.cellMono, S.cellRight, { width: W.total }] }, fmt(row.totalAmountVes)),
    // Pagado
    e(Text, { style: [S.cellMuted, S.cellRight, { width: W.paid }] }, fmt(row.paidAmountVes)),
    // Pendiente
    e(Text, { style: [S.cellMono, S.cellRight, { width: W.pending, color: isOverdue ? color : "#111827", fontWeight: "bold" }] }, fmt(row.pendingAmountVes)),
    // Badge
    e(View, { style: { width: W.bucket, justifyContent: "center" } },
      e(View, { style: [S.badge, { backgroundColor: bucketBg }] },
        e(Text, { style: [S.badgeText, { color }] },
          `${BUCKET_LABELS[row.bucket]}${row.daysOverdue > 0 ? ` (${row.daysOverdue}d)` : ""}`
        )
      )
    )
  );
}

// ─── Documento principal ──────────────────────────────────────────────────────

interface AgingReportPDFProps {
  report: AgingReport;
  companyName: string;
  companyRif: string | null;
}

function AgingReportDocument({ report, companyName, companyRif }: AgingReportPDFProps) {
  const reportLabel   = report.type === "CXC" ? "Cuentas por Cobrar" : "Cuentas por Pagar";
  const orderedSummary = BUCKET_ORDER
    .map((b) => report.bucketSummary.find((s) => s.bucket === b))
    .filter((s): s is AgingBucketSummary => s !== undefined);

  const today = new Date().toISOString().slice(0, 10);

  const headerEl = e(View, { style: S.header },
    e(Text, { style: S.title },       `Reporte de Antiguedad de Saldos - ${reportLabel}`),
    e(Text, { style: S.companyLine }, `${companyName}${companyRif ? ` · RIF: ${companyRif}` : ""}`),
    e(Text, { style: S.dateLabel },   `Corte: ${fmtDate(report.asOf)} · Generado: ${today}`)
  );

  const bucketsEl = e(View, { style: S.bucketsRow },
    ...orderedSummary.map((s) => e(BucketCard, { key: s.bucket, summary: s }))
  );

  const totalsEl = e(View, { style: S.totalsRow },
    e(View, { style: S.totalItem },
      e(Text, { style: S.totalLabel }, "Total cartera"),
      e(Text, { style: S.totalValue }, `Bs. ${fmt(report.grandTotalPendingVes)}`)
    ),
    e(View, { style: S.totalItem },
      e(Text, { style: S.totalLabel }, "Corriente"),
      e(Text, { style: [S.totalValue, { color: "#16a34a" }] }, `Bs. ${fmt(report.grandTotalCurrentVes)}`)
    ),
    e(View, { style: S.totalItem },
      e(Text, { style: S.totalLabel }, "Vencido"),
      e(Text, { style: [S.totalValue, { color: "#dc2626" }] }, `Bs. ${fmt(report.grandTotalOverdueVes)}`)
    ),
    e(View, { style: S.totalItem },
      e(Text, { style: S.totalLabel }, "Facturas"),
      e(Text, { style: S.totalValue }, String(report.rows.length))
    )
  );

  const tableEl = e(React.Fragment, null,
    e(TableHeader, { reportType: report.type }),
    ...report.rows.map((row, i) => e(TableRow, { key: row.invoiceId, row, isAlt: i % 2 === 1 }))
  );

  const footerEl = e(View, { style: S.footer, fixed: true },
    e(Text, { style: S.footerText }, `ContaFlow · Antiguedad ${report.type} · ${companyName}`),
    e(Text, {
      style: S.footerText,
      render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
        `Pag. ${pageNumber} / ${totalPages}`,
    })
  );

  const pageEl = e(Page, { size: "A4", orientation: "landscape", style: S.page },
    headerEl,
    bucketsEl,
    totalsEl,
    tableEl,
    footerEl
  );

  return e(Document, {
    title:   `Reporte Antiguedad ${report.type} - ${companyName}`,
    author:  "ContaFlow",
    subject: `Antiguedad de Saldos ${reportLabel}`,
  }, pageEl);
}

// ─── Función pública ──────────────────────────────────────────────────────────

export async function generateAgingReportPDF(params: AgingReportPDFProps): Promise<Buffer> {
  // Llamada directa (no como componente React) — mismo patrón que FinancialStatementsPDFService
  const doc = AgingReportDocument(params);
  return renderToBuffer(doc) as Promise<Buffer>;
}
