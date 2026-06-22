// src/modules/cajachica/services/CajaCajaExportService.ts
//
// Export de conveniencia por caja (arqueo): CSV para análisis + PDF imprimible.
// NO es un reporte fiscal SENIAT (no se transmite ni se archiva en Object Storage),
// por lo que NO aplica R-2; sigue el patrón on-demand de los *PDFService del repo.
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { fmtDate } from "@/lib/format";

// Shapes alineados con los serializers existentes (CajaCajaSummary/Movement/Deposit).
export type ExportCaja = {
  name: string;
  accountCode: string;
  accountName: string;
  currency: string;
  status: string;
  custodianName: string | null;
  totalDeposited: string;
  totalApprovedMovements: string;
  totalPendingMovements: string;
  availableBalance: string;
};
export type ExportMovement = {
  date: string;
  voucherNumber: string;
  concept: string;
  expenseAccountCode: string;
  expenseAccountName: string;
  providerRif: string | null;
  supportingDocumentId?: string | null;
  amount: string;
  currency: string;
  status: string;
};
export type ExportDeposit = {
  date: string;
  amount: string;
  description: string;
  status: string;
};

export type CajaCajaExportData = {
  companyName: string;
  caja: ExportCaja;
  movements: ExportMovement[];
  deposits: ExportDeposit[];
  generatedAt: Date;
};

// ─── CSV ─────────────────────────────────────────────────────────────────────
function csvCell(v: string | null | undefined): string {
  let s = (v ?? "").toString();
  // Neutralizar CSV/formula injection: una celda que empieza con = + - @ (o tab/CR)
  // es ejecutada como fórmula por Excel/LibreOffice al abrir el archivo. Prefijar con
  // apóstrofo la fuerza a texto. (OWASP CSV Injection.)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  // Escape RFC 4180: envolver en comillas si hay coma, comilla o salto de línea.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: (string | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

export function generateCajaCajaCSV(data: CajaCajaExportData): string {
  const lines: string[] = [];
  lines.push(csvRow(["Caja Chica", data.caja.name]));
  lines.push(csvRow(["Cuenta", `${data.caja.accountCode} - ${data.caja.accountName}`]));
  lines.push(csvRow(["Custodio", data.caja.custodianName ?? "Sin custodio"]));
  lines.push(csvRow(["Moneda", data.caja.currency]));
  lines.push(csvRow(["Estado", data.caja.status]));
  lines.push(csvRow(["Total depositado", data.caja.totalDeposited]));
  lines.push(csvRow(["Gastos aprobados", data.caja.totalApprovedMovements]));
  lines.push(csvRow(["Gastos pendientes", data.caja.totalPendingMovements]));
  lines.push(csvRow(["Saldo disponible", data.caja.availableBalance]));
  lines.push("");

  lines.push(csvRow(["MOVIMIENTOS (GASTOS)"]));
  lines.push(csvRow(["Fecha", "Comprobante", "Concepto", "Cuenta gasto", "RIF proveedor", "N° soporte", "Monto", "Moneda", "Estado"]));
  for (const m of data.movements) {
    lines.push(csvRow([
      m.date, m.voucherNumber, m.concept,
      `${m.expenseAccountCode} - ${m.expenseAccountName}`,
      m.providerRif ?? "", m.supportingDocumentId ?? "",
      m.amount, m.currency, m.status,
    ]));
  }
  lines.push("");

  lines.push(csvRow(["DEPÓSITOS (REPOSICIONES)"]));
  lines.push(csvRow(["Fecha", "Descripción", "Monto", "Estado"]));
  for (const d of data.deposits) {
    lines.push(csvRow([d.date, d.description, d.amount, d.status]));
  }

  // BOM para que Excel reconozca UTF-8 (acentos/ñ).
  return "﻿" + lines.join("\r\n");
}

// ─── PDF (arqueo imprimible) ───────────────────────────────────────────────────
const s = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: "#18181b" },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 9, color: "#52525b", marginTop: 2 },
  section: { marginTop: 14, fontSize: 11, fontFamily: "Helvetica-Bold" },
  metaRow: { flexDirection: "row", marginTop: 2 },
  metaLabel: { width: 130, color: "#52525b" },
  metaVal: { flex: 1, fontFamily: "Helvetica-Bold" },
  tHead: { flexDirection: "row", borderBottom: 1, borderColor: "#a1a1aa", paddingBottom: 3, marginTop: 6, fontFamily: "Helvetica-Bold" },
  tRow: { flexDirection: "row", borderBottom: 0.5, borderColor: "#e4e4e7", paddingVertical: 3 },
  right: { textAlign: "right" },
  empty: { marginTop: 6, color: "#71717a", fontStyle: "italic" },
  footer: { position: "absolute", bottom: 18, left: 28, right: 28, fontSize: 7, color: "#a1a1aa", textAlign: "center" },
});

function meta(label: string, val: string) {
  return React.createElement(View, { style: s.metaRow },
    React.createElement(Text, { style: s.metaLabel }, label),
    React.createElement(Text, { style: s.metaVal }, val),
  );
}

export async function generateCajaCajaPDF(data: CajaCajaExportData): Promise<Buffer> {
  const { caja } = data;
  const movCols = [
    { w: "12%", t: "Fecha" }, { w: "16%", t: "Comprob." }, { w: "26%", t: "Concepto" },
    { w: "18%", t: "RIF prov." }, { w: "16%", t: "Monto", r: true }, { w: "12%", t: "Estado" },
  ];
  const depCols = [
    { w: "16%", t: "Fecha" }, { w: "52%", t: "Descripción" },
    { w: "20%", t: "Monto", r: true }, { w: "12%", t: "Estado" },
  ];

  const doc = React.createElement(Document, {},
    React.createElement(Page, { size: "A4", style: s.page },
      React.createElement(Text, { style: s.title }, `Arqueo de Caja Chica — ${caja.name}`),
      React.createElement(Text, { style: s.sub }, `${data.companyName} · Generado ${fmtDate(data.generatedAt)}`),

      meta("Cuenta", `${caja.accountCode} - ${caja.accountName}`),
      meta("Custodio", caja.custodianName ?? "Sin custodio"),
      meta("Estado", caja.status),
      meta("Total depositado", `${caja.totalDeposited} ${caja.currency}`),
      meta("Gastos aprobados", `${caja.totalApprovedMovements} ${caja.currency}`),
      meta("Gastos pendientes", `${caja.totalPendingMovements} ${caja.currency}`),
      meta("Saldo disponible", `${caja.availableBalance} ${caja.currency}`),

      React.createElement(Text, { style: s.section }, "Movimientos (gastos)"),
      data.movements.length === 0
        ? React.createElement(Text, { style: s.empty }, "Sin movimientos.")
        : React.createElement(View, {},
            React.createElement(View, { style: s.tHead },
              ...movCols.map((c) => React.createElement(Text, { key: c.t, style: [{ width: c.w }, c.r ? s.right : {}] }, c.t)),
            ),
            ...data.movements.map((m, i) =>
              React.createElement(View, { key: i, style: s.tRow },
                React.createElement(Text, { style: { width: "12%" } }, m.date),
                React.createElement(Text, { style: { width: "16%" } }, m.voucherNumber),
                React.createElement(Text, { style: { width: "26%" } }, m.concept),
                React.createElement(Text, { style: { width: "18%" } }, m.providerRif ?? "—"),
                React.createElement(Text, { style: [{ width: "16%" }, s.right] }, `${m.amount}`),
                React.createElement(Text, { style: { width: "12%" } }, m.status),
              ),
            ),
          ),

      React.createElement(Text, { style: s.section }, "Depósitos (reposiciones)"),
      data.deposits.length === 0
        ? React.createElement(Text, { style: s.empty }, "Sin depósitos.")
        : React.createElement(View, {},
            React.createElement(View, { style: s.tHead },
              ...depCols.map((c) => React.createElement(Text, { key: c.t, style: [{ width: c.w }, c.r ? s.right : {}] }, c.t)),
            ),
            ...data.deposits.map((d, i) =>
              React.createElement(View, { key: i, style: s.tRow },
                React.createElement(Text, { style: { width: "16%" } }, d.date),
                React.createElement(Text, { style: { width: "52%" } }, d.description),
                React.createElement(Text, { style: [{ width: "20%" }, s.right] }, `${d.amount}`),
                React.createElement(Text, { style: { width: "12%" } }, d.status),
              ),
            ),
          ),

      React.createElement(Text, { style: s.footer, fixed: true },
        "Documento interno de control (arqueo de caja chica). No es un comprobante fiscal SENIAT."),
    ),
  );

  return renderToBuffer(doc);
}
