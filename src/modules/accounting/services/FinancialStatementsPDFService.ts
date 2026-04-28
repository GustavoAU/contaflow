// src/modules/accounting/services/FinancialStatementsPDFService.ts
// PDFs legales: Balance General y Estado de Resultados con espacio para firma CPC

import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import type { BalanceSheet, IncomeStatement } from "../actions/report.actions";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(value: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function fmtAbs(value: string): string {
  return fmt(String(Math.abs(parseFloat(value))));
}

// ─── Estilos compartidos ──────────────────────────────────────────────────────

const S = StyleSheet.create({
  page:        { padding: 40, fontSize: 9, fontFamily: "Helvetica" },
  // Título
  title:       { fontSize: 14, fontWeight: "bold", textAlign: "center", marginBottom: 2 },
  subtitle:    { fontSize: 9, textAlign: "center", color: "#374151", marginBottom: 2 },
  dateLabel:   { fontSize: 8, textAlign: "center", color: "#6b7280", marginBottom: 12 },
  // Empresa
  companyBox:  { marginBottom: 14, borderBottom: "1pt solid #e5e7eb", paddingBottom: 8 },
  companyName: { fontSize: 11, fontWeight: "bold" },
  companyMeta: { fontSize: 8, color: "#6b7280", marginTop: 2 },
  // Sección
  sectionHeader: {
    flexDirection: "row",
    backgroundColor: "#1f2937",
    padding: "4pt 6pt",
    marginTop: 10,
  },
  sectionHeaderText: { fontSize: 9, fontWeight: "bold", color: "#ffffff", flex: 1 },
  sectionHeaderAmt:  { fontSize: 9, fontWeight: "bold", color: "#ffffff", textAlign: "right" },
  // Filas de cuenta
  accountRow:    { flexDirection: "row", borderBottom: "0.5pt solid #e5e7eb", padding: "3pt 6pt" },
  accountRowAlt: { flexDirection: "row", backgroundColor: "#f9fafb", borderBottom: "0.5pt solid #e5e7eb", padding: "3pt 6pt" },
  accountCode:   { fontSize: 7, color: "#9ca3af", width: 38, fontFamily: "Helvetica" },
  accountName:   { fontSize: 8, color: "#374151", flex: 1 },
  accountAmt:    { fontSize: 8, textAlign: "right", fontFamily: "Helvetica", width: 80 },
  // Subtotal
  subtotalRow: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderTop: "1pt solid #374151",
    padding: "4pt 6pt",
  },
  subtotalLabel: { fontSize: 8, fontWeight: "bold", flex: 1 },
  subtotalAmt:   { fontSize: 8, fontWeight: "bold", textAlign: "right", fontFamily: "Helvetica", width: 80 },
  // Cuadre / resultado
  balanceBox: {
    marginTop: 12,
    borderTop: "2pt solid #1f2937",
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  balanceLabel: { fontSize: 9, fontWeight: "bold" },
  balanceAmt:   { fontSize: 9, fontWeight: "bold", fontFamily: "Helvetica" },
  // Firma
  signatureSection: { marginTop: 40, borderTop: "0.5pt solid #d1d5db", paddingTop: 14 },
  signatureRow:     { flexDirection: "row", justifyContent: "space-between" },
  signatureBlock:   { width: "44%" },
  signatureLine:    { borderBottom: "1pt solid #374151", marginBottom: 4, height: 28 },
  signatureRole:    { fontSize: 8, fontWeight: "bold", color: "#374151" },
  signatureDetail:  { fontSize: 7, color: "#6b7280", marginTop: 2 },
  signatureNote:    { fontSize: 7, color: "#9ca3af", textAlign: "center", marginTop: 12 },
});

// ─── Componentes auxiliares ───────────────────────────────────────────────────

function DocHeader(params: { companyName: string; companyRif: string | null; title: string; subtitle: string; dateLabel: string }) {
  return React.createElement(
    View,
    { style: S.companyBox },
    React.createElement(Text, { style: S.title }, params.title),
    React.createElement(Text, { style: S.subtitle }, params.subtitle),
    React.createElement(Text, { style: S.dateLabel }, params.dateLabel),
    React.createElement(Text, { style: S.companyName }, params.companyName),
    React.createElement(Text, { style: S.companyMeta },
      `RIF: ${params.companyRif ?? "—"}`
    ),
  );
}

function SectionBlock(sectionTitle: string, rows: { id: string; code: string; name: string; balance: string }[], totalLabel: string, total: string) {
  return React.createElement(
    View,
    null,
    React.createElement(
      View,
      { style: S.sectionHeader },
      React.createElement(Text, { style: S.sectionHeaderText }, sectionTitle),
    ),
    ...rows.map((row, i) =>
      React.createElement(
        View,
        { key: row.id, style: i % 2 === 0 ? S.accountRow : S.accountRowAlt },
        React.createElement(Text, { style: S.accountCode }, row.code === "—" ? "" : row.code),
        React.createElement(Text, { style: S.accountName }, row.name),
        React.createElement(Text, { style: S.accountAmt }, fmtAbs(row.balance)),
      ),
    ),
    React.createElement(
      View,
      { style: S.subtotalRow },
      React.createElement(Text, { style: S.subtotalLabel }, totalLabel),
      React.createElement(Text, { style: S.subtotalAmt }, `${fmt(total)} Bs.`),
    ),
  );
}

function SignatureBlock() {
  return React.createElement(
    View,
    { style: S.signatureSection },
    React.createElement(
      View,
      { style: S.signatureRow },
      // Representante Legal
      React.createElement(
        View,
        { style: S.signatureBlock },
        React.createElement(View, { style: S.signatureLine }),
        React.createElement(Text, { style: S.signatureRole }, "Representante Legal"),
        React.createElement(Text, { style: S.signatureDetail }, "Nombre: __________________________________"),
        React.createElement(Text, { style: S.signatureDetail }, "C.I.: ____________________________________"),
      ),
      // Contador Público Colegiado
      React.createElement(
        View,
        { style: S.signatureBlock },
        React.createElement(View, { style: S.signatureLine }),
        React.createElement(Text, { style: S.signatureRole }, "Contador Público Colegiado (C.P.C.)"),
        React.createElement(Text, { style: S.signatureDetail }, "Nombre: __________________________________"),
        React.createElement(Text, { style: S.signatureDetail }, "C.P.C. No.: ______  RIF: __________________"),
      ),
    ),
    React.createElement(
      Text,
      { style: S.signatureNote },
      "Certifico que la presente información es fiel reflejo de los libros contables de la empresa, " +
      "de conformidad con los Principios de Contabilidad de Aceptación General en Venezuela (VEN-NIF).",
    ),
  );
}

// ─── Balance General PDF ──────────────────────────────────────────────────────

export interface BalanceSheetPDFParams {
  companyName: string;
  companyRif: string | null;
  dateTo: string;
  data: BalanceSheet;
}

export async function generateBalanceSheetPDF(params: BalanceSheetPDFParams): Promise<Buffer> {
  const { companyName, companyRif, dateTo, data } = params;

  const doc = React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "LETTER", style: S.page },
      DocHeader({
        companyName,
        companyRif,
        title: "BALANCE GENERAL",
        subtitle: "Estado de Situación Financiera",
        dateLabel: `Al ${dateTo}`,
      }),

      SectionBlock("ACTIVOS", data.assets, "Total Activos", data.totalAssets),
      SectionBlock("PASIVOS", data.liabilities, "Total Pasivos", data.totalLiabilities),
      SectionBlock("PATRIMONIO", data.equity, "Total Patrimonio", data.totalEquity),

      React.createElement(
        View,
        { style: S.balanceBox },
        React.createElement(Text, { style: S.balanceLabel }, "TOTAL PASIVOS + PATRIMONIO"),
        React.createElement(
          Text,
          { style: { ...S.balanceAmt, color: data.isBalanced ? "#15803d" : "#dc2626" } },
          `${fmt(data.totalLiabilitiesAndEquity)} Bs.  ${data.isBalanced ? "✓ Cuadrado" : "⚠ Descuadrado"}`,
        ),
      ),

      SignatureBlock(),
    ),
  );

  return renderToBuffer(doc) as Promise<Buffer>;
}

// ─── Estado de Resultados PDF ─────────────────────────────────────────────────

export interface IncomeStatementPDFParams {
  companyName: string;
  companyRif: string | null;
  dateFrom: string;
  dateTo: string;
  data: IncomeStatement;
}

export async function generateIncomeStatementPDF(params: IncomeStatementPDFParams): Promise<Buffer> {
  const { companyName, companyRif, dateFrom, dateTo, data } = params;

  const net = parseFloat(data.netIncome);
  const isProfit = net >= 0;

  const doc = React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "LETTER", style: S.page },
      DocHeader({
        companyName,
        companyRif,
        title: "ESTADO DE RESULTADOS",
        subtitle: "Estado de Ganancias y Pérdidas",
        dateLabel: `Del ${dateFrom} al ${dateTo}`,
      }),

      SectionBlock("INGRESOS", data.revenues, "Total Ingresos", data.totalRevenues),
      SectionBlock("GASTOS", data.expenses, "Total Gastos", data.totalExpenses),

      React.createElement(
        View,
        { style: { ...S.balanceBox, marginTop: 16 } },
        React.createElement(
          Text,
          { style: S.balanceLabel },
          isProfit ? "UTILIDAD DEL PERÍODO" : "PÉRDIDA DEL PERÍODO",
        ),
        React.createElement(
          Text,
          { style: { ...S.balanceAmt, color: isProfit ? "#15803d" : "#dc2626" } },
          `${fmt(Math.abs(net).toFixed(2))} Bs.`,
        ),
      ),

      SignatureBlock(),
    ),
  );

  return renderToBuffer(doc) as Promise<Buffer>;
}
