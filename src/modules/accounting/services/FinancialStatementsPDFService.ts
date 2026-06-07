// src/modules/accounting/services/FinancialStatementsPDFService.ts
// PDFs legales: Balance General, Estado de Resultados y Libro Mayor con espacio para firma CPC

import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { Decimal } from "decimal.js";
import type { BalanceSheet, IncomeStatement, LedgerAccount, TrialBalanceRow } from "../types/report-types";

// ─── Tipos compartidos ────────────────────────────────────────────────────────

export interface AccountantInfo {
  accountantName?: string | null;
  accountantTitle?: string | null;
  accountantCpcNumber?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(value: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function fmtAccounting(value: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  const abs = new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(num));
  return num < 0 ? `(${abs})` : abs;
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
  // ─── Audit trail ────────────────────────────────────────────────────────────
  auditTrail: {
    marginTop: 20,
    borderTop: "0.5pt solid #e5e7eb",
    paddingTop: 6,
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
  },
  auditTrailText: { fontSize: 6, color: "#9ca3af" },
  // ─── Libro Mayor ────────────────────────────────────────────────────────────
  ledgerAccountHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#eff6ff",
    borderLeft: "3pt solid #2563eb",
    padding: "5pt 6pt",
    marginTop: 14,
    marginBottom: 0,
  },
  ledgerAccountCode: {
    fontSize: 8,
    fontWeight: "bold",
    color: "#2563eb",
    fontFamily: "Helvetica",
    width: 50,
  },
  ledgerAccountName: { fontSize: 9, fontWeight: "bold", color: "#1f2937", flex: 1 },
  ledgerAccountType: {
    fontSize: 7,
    color: "#6b7280",
    backgroundColor: "#e5e7eb",
    padding: "1pt 4pt",
    borderRadius: 3,
  },
  // Cabecera de columnas de la tabla
  ledgerColHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderBottom: "1pt solid #d1d5db",
    padding: "3pt 4pt",
  },
  ledgerColText: { fontSize: 7, fontWeight: "bold", color: "#374151" },
  // Celdas
  colDate:        { width: 60, fontSize: 7, fontFamily: "Helvetica" },
  colNumber:      { width: 55, fontSize: 7, fontFamily: "Helvetica" },
  colDescription: { flex: 1, fontSize: 7 },
  colDebit:       { width: 60, fontSize: 7, textAlign: "right", fontFamily: "Helvetica" },
  colCredit:      { width: 60, fontSize: 7, textAlign: "right", fontFamily: "Helvetica" },
  colBalance:     { width: 65, fontSize: 7, textAlign: "right", fontFamily: "Helvetica" },
  // Filas de la tabla del ledger
  ledgerRow:    { flexDirection: "row", borderBottom: "0.5pt solid #f3f4f6", padding: "2pt 4pt" },
  ledgerRowAlt: { flexDirection: "row", backgroundColor: "#f9fafb", borderBottom: "0.5pt solid #f3f4f6", padding: "2pt 4pt" },
  // Fila especial: saldo anterior
  ledgerOpeningRow: {
    flexDirection: "row",
    backgroundColor: "#fefce8",
    borderBottom: "0.5pt solid #fde68a",
    padding: "2pt 4pt",
  },
  ledgerOpeningText: { fontSize: 7, color: "#92400e", fontWeight: "bold" },
  // Fila de totales de cuenta
  ledgerTotalRow: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderTop: "1pt solid #374151",
    padding: "3pt 4pt",
  },
  ledgerTotalLabel: { fontSize: 7, fontWeight: "bold", color: "#374151", flex: 1 },
  ledgerTotalAmt:   { fontSize: 7, fontWeight: "bold", textAlign: "right", fontFamily: "Helvetica" },
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
        React.createElement(Text, { style: S.accountAmt }, fmtAccounting(row.balance)),
      ),
    ),
    React.createElement(
      View,
      { style: S.subtotalRow },
      React.createElement(Text, { style: S.subtotalLabel }, totalLabel),
      React.createElement(Text, { style: S.subtotalAmt }, `${fmtAccounting(total)} Bs.`),
    ),
  );
}

function SignatureBlock(accountant?: AccountantInfo) {
  const cpcName = accountant?.accountantName ?? "__________________________________";
  const cpcTitle = accountant?.accountantTitle ?? "Contador Público Colegiado";
  const cpcNumber = accountant?.accountantCpcNumber
    ? `C.P.C. No.: ${accountant.accountantCpcNumber}`
    : "C.P.C. No.: ______";
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
        React.createElement(Text, { style: S.signatureRole }, cpcTitle),
        React.createElement(Text, { style: S.signatureDetail }, `Nombre: ${cpcName}`),
        React.createElement(Text, { style: S.signatureDetail }, cpcNumber),
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
  accountant?: AccountantInfo;
}

export async function generateBalanceSheetPDF(params: BalanceSheetPDFParams): Promise<Buffer> {
  const { companyName, companyRif, dateTo, data, accountant } = params;

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

      SignatureBlock(accountant),
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
  accountant?: AccountantInfo;
}

export async function generateIncomeStatementPDF(params: IncomeStatementPDFParams): Promise<Buffer> {
  const { companyName, companyRif, dateFrom, dateTo, data, accountant } = params;

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

      SignatureBlock(accountant),
    ),
  );

  return renderToBuffer(doc) as Promise<Buffer>;
}

// ─── Etiquetas de tipo de cuenta (compartidas por Libro Mayor y Balance de Comprobación) ──

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  ASSET: "Activo",
  CONTRA_ASSET: "Contra-activo",
  LIABILITY: "Pasivo",
  EQUITY: "Patrimonio",
  REVENUE: "Ingreso",
  EXPENSE: "Gasto",
};

// ─── Libro Mayor PDF ──────────────────────────────────────────────────────────

export interface LedgerPDFParams {
  companyName: string;
  companyRif: string | null;
  dateFrom?: string;  // "YYYY-MM-DD" o undefined
  dateTo?: string;
  accounts: LedgerAccount[];
  generatedAt: string; // "DD/MM/YYYY HH:MM" — audit trail PA-121
  accountant?: AccountantInfo;
}

function LedgerColHeader() {
  return React.createElement(
    View,
    { style: S.ledgerColHeader },
    React.createElement(Text, { style: { ...S.ledgerColText, ...S.colDate } }, "Fecha"),
    React.createElement(Text, { style: { ...S.ledgerColText, ...S.colNumber } }, "Número"),
    React.createElement(Text, { style: { ...S.ledgerColText, ...S.colDescription } }, "Descripción"),
    React.createElement(Text, { style: { ...S.ledgerColText, ...S.colDebit } }, "Débito"),
    React.createElement(Text, { style: { ...S.ledgerColText, ...S.colCredit } }, "Crédito"),
    React.createElement(Text, { style: { ...S.ledgerColText, ...S.colBalance } }, "Saldo"),
  );
}

function LedgerAccountBlock(account: LedgerAccount) {
  const typeLabel = ACCOUNT_TYPE_LABELS[account.type] ?? account.type;
  const hasOpening = account.openingBalance !== "0.00";
  const balanceNum = parseFloat(account.balance);
  const balanceColor = balanceNum < 0 ? "#dc2626" : "#1f2937";

  const entryRows = account.entries.map((entry, i) => {
    const rowStyle = i % 2 === 0 ? S.ledgerRow : S.ledgerRowAlt;
    const entryDate = new Date(entry.date).toLocaleDateString("es-VE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    return React.createElement(
      View,
      { key: entry.transactionId + String(i), style: rowStyle },
      React.createElement(Text, { style: S.colDate }, entryDate),
      React.createElement(Text, { style: S.colNumber }, entry.number),
      React.createElement(Text, { style: S.colDescription }, entry.description),
      React.createElement(
        Text,
        { style: S.colDebit },
        entry.debit ? fmt(entry.debit) : "",
      ),
      React.createElement(
        Text,
        { style: S.colCredit },
        entry.credit ? fmt(entry.credit) : "",
      ),
      React.createElement(
        Text,
        { style: { ...S.colBalance, color: parseFloat(entry.balance) < 0 ? "#dc2626" : "#1f2937" } },
        fmt(entry.balance),
      ),
    );
  });

  return React.createElement(
    View,
    { key: account.id },
    // Header de la cuenta
    React.createElement(
      View,
      { style: S.ledgerAccountHeader },
      React.createElement(Text, { style: S.ledgerAccountCode }, account.code),
      React.createElement(Text, { style: S.ledgerAccountName }, account.name),
      React.createElement(Text, { style: S.ledgerAccountType }, typeLabel),
    ),
    // Cabecera de columnas
    LedgerColHeader(),
    // Fila saldo anterior (si aplica)
    ...(hasOpening
      ? [
          React.createElement(
            View,
            { key: "opening", style: S.ledgerOpeningRow },
            React.createElement(Text, { style: { ...S.colDate, ...S.ledgerOpeningText } }, ""),
            React.createElement(Text, { style: { ...S.colNumber, ...S.ledgerOpeningText } }, ""),
            React.createElement(Text, { style: { ...S.colDescription, ...S.ledgerOpeningText } }, "SALDO ANTERIOR"),
            React.createElement(Text, { style: { ...S.colDebit, ...S.ledgerOpeningText } }, ""),
            React.createElement(Text, { style: { ...S.colCredit, ...S.ledgerOpeningText } }, ""),
            React.createElement(
              Text,
              { style: { ...S.colBalance, ...S.ledgerOpeningText } },
              fmt(account.openingBalance),
            ),
          ),
        ]
      : []),
    // Filas de movimientos
    ...entryRows,
    // Fila de totales
    React.createElement(
      View,
      { style: S.ledgerTotalRow },
      React.createElement(Text, { style: { ...S.ledgerTotalLabel, flex: 1 } }, "Total débitos"),
      React.createElement(
        Text,
        { style: { ...S.ledgerTotalAmt, width: 60 } },
        `${fmt(account.totalDebit)} Bs.`,
      ),
      React.createElement(
        Text,
        { style: { ...S.ledgerTotalAmt, width: 60, marginLeft: 60 + 65 } },
        "",
      ),
    ),
    React.createElement(
      View,
      { style: { ...S.ledgerTotalRow, backgroundColor: "#f9fafb" } },
      React.createElement(Text, { style: { ...S.ledgerTotalLabel, flex: 1 } }, "Total créditos"),
      React.createElement(
        Text,
        { style: { ...S.ledgerTotalAmt, width: 60, marginLeft: 60 } },
        `${fmt(account.totalCredit)} Bs.`,
      ),
    ),
    React.createElement(
      View,
      { style: { ...S.ledgerTotalRow, backgroundColor: "#eff6ff" } },
      React.createElement(Text, { style: { ...S.ledgerTotalLabel, flex: 1 } }, "Saldo final"),
      React.createElement(
        Text,
        { style: { ...S.ledgerTotalAmt, width: 65, color: balanceColor } },
        `${fmt(account.balance)} Bs.`,
      ),
    ),
  );
}

export async function generateLedgerPDF(params: LedgerPDFParams): Promise<Buffer> {
  const { companyName, companyRif, dateFrom, dateTo, accounts, generatedAt, accountant } = params;

  const dateLabel =
    dateFrom && dateTo
      ? `Del ${dateFrom} al ${dateTo}`
      : dateFrom
        ? `Desde ${dateFrom}`
        : dateTo
          ? `Hasta ${dateTo}`
          : "Todos los períodos";

  const auditTrail = React.createElement(
    View,
    { style: S.auditTrail },
    React.createElement(
      Text,
      { style: S.auditTrailText },
      `Generado por: ContaFlow — Sistema de Gestión Contable`,
    ),
    React.createElement(
      Text,
      { style: S.auditTrailText },
      `Fecha de generación: ${generatedAt}`,
    ),
  );

  const doc = React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "LETTER", style: S.page },
      DocHeader({
        companyName,
        companyRif,
        title: "LIBRO MAYOR",
        subtitle: "Mayor General de Cuentas",
        dateLabel,
      }),
      ...accounts.map((account) => LedgerAccountBlock(account)),
      SignatureBlock(accountant),
      auditTrail,
    ),
  );

  return renderToBuffer(doc) as Promise<Buffer>;
}

// ─── Balance de Comprobación PDF ──────────────────────────────────────────────

const TB = StyleSheet.create({
  colCode: { width: 44, fontSize: 7, fontFamily: "Helvetica", color: "#2563eb" },
  colName: { flex: 1, fontSize: 7, color: "#374151" },
  colType: { width: 56, fontSize: 7, color: "#6b7280" },
  colAmt:  { width: 64, fontSize: 7, textAlign: "right", fontFamily: "Helvetica" },
  tbHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderBottom: "1pt solid #d1d5db",
    padding: "3pt 4pt",
  },
  tbHeaderText: { fontSize: 7, fontWeight: "bold", color: "#374151" },
  tbRow:    { flexDirection: "row", borderBottom: "0.5pt solid #f3f4f6", padding: "2.5pt 4pt" },
  tbRowAlt: { flexDirection: "row", backgroundColor: "#f9fafb", borderBottom: "0.5pt solid #f3f4f6", padding: "2.5pt 4pt" },
  tbSubtotal: {
    flexDirection: "row",
    backgroundColor: "#e5e7eb",
    borderTop: "0.5pt solid #9ca3af",
    padding: "2.5pt 4pt",
  },
  tbSubtotalText: { fontSize: 7, fontWeight: "bold", color: "#374151" },
  tbTotal: {
    flexDirection: "row",
    backgroundColor: "#1f2937",
    padding: "4pt 4pt",
    marginTop: 4,
  },
  tbTotalText: { fontSize: 8, fontWeight: "bold", color: "#ffffff" },
});

export interface TrialBalancePDFParams {
  companyName: string;
  companyRif: string | null;
  dateTo: string;
  data: TrialBalanceRow[];
  accountant?: AccountantInfo;
}

export async function generateTrialBalancePDF(params: TrialBalancePDFParams): Promise<Buffer> {
  const { companyName, companyRif, dateTo, data, accountant } = params;

  const TYPE_ORDER = ["ASSET", "CONTRA_ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

  const grandDebit = data.reduce((acc, r) => acc.plus(new Decimal(r.totalDebit)), new Decimal(0));
  const grandCredit = data.reduce((acc, r) => acc.plus(new Decimal(r.totalCredit)), new Decimal(0));
  const grandBalance = grandDebit.minus(grandCredit);
  const isBalanced = grandBalance.abs().lessThan(new Decimal("0.01"));

  const groups = TYPE_ORDER
    .map((type) => ({ type, rows: data.filter((r) => r.type === type) }))
    .filter((g) => g.rows.length > 0);

  const tableHeader = React.createElement(
    View,
    { style: TB.tbHeader },
    React.createElement(Text, { style: { ...TB.tbHeaderText, ...TB.colCode } }, "Código"),
    React.createElement(Text, { style: { ...TB.tbHeaderText, ...TB.colName } }, "Cuenta"),
    React.createElement(Text, { style: { ...TB.tbHeaderText, ...TB.colType } }, "Tipo"),
    React.createElement(Text, { style: { ...TB.tbHeaderText, ...TB.colAmt } }, "Débito Bs."),
    React.createElement(Text, { style: { ...TB.tbHeaderText, ...TB.colAmt } }, "Crédito Bs."),
    React.createElement(Text, { style: { ...TB.tbHeaderText, ...TB.colAmt } }, "Saldo Bs."),
  );

  const groupRows = groups.flatMap(({ type, rows }) => {
    const gDebit = rows.reduce((a, r) => a.plus(new Decimal(r.totalDebit)), new Decimal(0));
    const gCredit = rows.reduce((a, r) => a.plus(new Decimal(r.totalCredit)), new Decimal(0));
    const gBal = gDebit.minus(gCredit);
    const rowEls = rows.map((row, i) =>
      React.createElement(
        View,
        { key: row.id, style: i % 2 === 0 ? TB.tbRow : TB.tbRowAlt },
        React.createElement(Text, { style: TB.colCode }, row.code),
        React.createElement(Text, { style: TB.colName }, row.name),
        React.createElement(Text, { style: TB.colType }, ACCOUNT_TYPE_LABELS[row.type] ?? row.type),
        React.createElement(Text, { style: TB.colAmt }, fmt(row.totalDebit)),
        React.createElement(Text, { style: TB.colAmt }, fmt(row.totalCredit)),
        React.createElement(Text, { style: { ...TB.colAmt, color: parseFloat(row.balance) < 0 ? "#dc2626" : "#1f2937" } }, fmt(row.balance)),
      ),
    );
    const subtotalEl = React.createElement(
      View,
      { key: `sub-${type}`, style: TB.tbSubtotal },
      React.createElement(Text, { style: { ...TB.tbSubtotalText, ...TB.colCode } }, ""),
      React.createElement(Text, { style: { ...TB.tbSubtotalText, ...TB.colName } }, `Subtotal ${ACCOUNT_TYPE_LABELS[type] ?? type}`),
      React.createElement(Text, { style: { ...TB.tbSubtotalText, ...TB.colType } }, ""),
      React.createElement(Text, { style: { ...TB.tbSubtotalText, ...TB.colAmt } }, fmt(gDebit.toFixed(2))),
      React.createElement(Text, { style: { ...TB.tbSubtotalText, ...TB.colAmt } }, fmt(gCredit.toFixed(2))),
      React.createElement(Text, { style: { ...TB.tbSubtotalText, ...TB.colAmt } }, fmt(gBal.toFixed(2))),
    );
    return [...rowEls, subtotalEl];
  });

  const totalRow = React.createElement(
    View,
    { style: TB.tbTotal },
    React.createElement(Text, { style: { ...TB.tbTotalText, ...TB.colCode } }, ""),
    React.createElement(Text, { style: { ...TB.tbTotalText, ...TB.colName } }, "TOTALES"),
    React.createElement(Text, { style: { ...TB.tbTotalText, ...TB.colType } }, ""),
    React.createElement(Text, { style: { ...TB.tbTotalText, ...TB.colAmt } }, fmt(grandDebit.toFixed(2))),
    React.createElement(Text, { style: { ...TB.tbTotalText, ...TB.colAmt } }, fmt(grandCredit.toFixed(2))),
    React.createElement(
      Text,
      { style: { ...TB.tbTotalText, ...TB.colAmt, color: isBalanced ? "#86efac" : "#fca5a5" } },
      `${fmt(grandBalance.toFixed(2))} ${isBalanced ? "✓" : "⚠"}`,
    ),
  );

  const doc = React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "LETTER", style: S.page },
      DocHeader({
        companyName,
        companyRif,
        title: "BALANCE DE COMPROBACIÓN",
        subtitle: "Sumas y Saldos de Todas las Cuentas",
        dateLabel: `Al ${dateTo}`,
      }),
      tableHeader,
      ...groupRows,
      totalRow,
      SignatureBlock(accountant),
    ),
  );

  return renderToBuffer(doc) as Promise<Buffer>;
}
