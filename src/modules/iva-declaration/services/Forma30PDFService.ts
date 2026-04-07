// src/modules/iva-declaration/services/Forma30PDFService.ts

import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import type { Decimal } from "decimal.js";
import type { SeccionA, SeccionB, SeccionC, SeccionD, SeccionE } from "../types/forma30.types";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export interface Forma30PDFParams {
  companyName: string;
  companyRif: string | null;
  year: number;
  month: number;
  isSpecialContributor: boolean;
  seccionA: SeccionA;
  seccionB: SeccionB;
  seccionC: SeccionC;
  seccionD: SeccionD;
  seccionE: SeccionE;
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica" },
  title: { fontSize: 13, fontWeight: "bold", textAlign: "center", marginBottom: 4 },
  subtitle: { fontSize: 9, textAlign: "center", marginBottom: 10, color: "#374151" },
  // Encabezado empresa
  headerRow: { flexDirection: "row", marginBottom: 3 },
  headerLabel: { fontSize: 9, fontWeight: "bold", width: 100 },
  headerValue: { fontSize: 9, flex: 1 },
  // Sección header
  sectionTitle: {
    fontSize: 9,
    fontWeight: "bold",
    marginTop: 12,
    marginBottom: 0,
    backgroundColor: "#1f2937",
    color: "#ffffff",
    padding: "3pt 5pt",
  },
  // Tabla
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#e5e7eb",
    borderBottom: "1pt solid #374151",
  },
  tableRow: { flexDirection: "row", borderBottom: "0.5pt solid #d1d5db" },
  tableRowAlt: { flexDirection: "row", backgroundColor: "#f9fafb", borderBottom: "0.5pt solid #d1d5db" },
  tableTotal: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderTop: "1pt solid #374151",
    borderBottom: "0.5pt solid #d1d5db",
  },
  colConcepto: { padding: "3pt 4pt", flex: 3, fontSize: 8 },
  colBase: { padding: "3pt 4pt", flex: 1.5, fontSize: 8, textAlign: "right" },
  colTax: { padding: "3pt 4pt", flex: 1.5, fontSize: 8, textAlign: "right" },
  colConceptoBold: { padding: "3pt 4pt", flex: 3, fontSize: 8, fontWeight: "bold" },
  colBaseBold: { padding: "3pt 4pt", flex: 1.5, fontSize: 8, textAlign: "right", fontWeight: "bold" },
  colTaxBold: { padding: "3pt 4pt", flex: 1.5, fontSize: 8, textAlign: "right", fontWeight: "bold" },
  // Simple (2 col para C y D)
  simpleHeader: { flexDirection: "row", backgroundColor: "#e5e7eb", borderBottom: "1pt solid #374151" },
  simpleRow: { flexDirection: "row", borderBottom: "0.5pt solid #d1d5db" },
  simpleRowAlt: { flexDirection: "row", backgroundColor: "#f9fafb", borderBottom: "0.5pt solid #d1d5db" },
  simpleTotal: { flexDirection: "row", backgroundColor: "#f3f4f6", borderTop: "1pt solid #374151" },
  simpleLabel: { padding: "3pt 4pt", flex: 3, fontSize: 8 },
  simpleValue: { padding: "3pt 4pt", flex: 1.5, fontSize: 8, textAlign: "right" },
  simpleLabelBold: { padding: "3pt 4pt", flex: 3, fontSize: 8, fontWeight: "bold" },
  simpleValueBold: { padding: "3pt 4pt", flex: 1.5, fontSize: 8, textAlign: "right", fontWeight: "bold" },
  // Sección E — cuota
  cuotaBox: {
    marginTop: 12,
    padding: "6pt 8pt",
    borderLeft: "3pt solid #1f2937",
    backgroundColor: "#f9fafb",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cuotaBoxFavor: {
    marginTop: 12,
    padding: "6pt 8pt",
    borderLeft: "3pt solid #2563eb",
    backgroundColor: "#eff6ff",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cuotaLabel: { fontSize: 10, fontWeight: "bold" },
  cuotaSubtitle: { fontSize: 7, color: "#6b7280", marginTop: 2 },
  cuotaAmount: { fontSize: 12, fontWeight: "bold", textAlign: "right" },
  // Footer
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    borderTop: "0.5pt solid #d1d5db",
    paddingTop: 3,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#9ca3af",
  },
});

// ─── Helper de formato ────────────────────────────────────────────────────────
function fmtAmt(v: Decimal | string | number): string {
  return Number(v).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Componentes del documento ────────────────────────────────────────────────

function DocHeader({ params }: { params: Forma30PDFParams }) {
  const periodLabel = `${MESES[params.month - 1]} ${params.year}`;
  return React.createElement(
    View,
    null,
    React.createElement(Text, { style: styles.title }, "DECLARACIÓN MENSUAL DE IVA — FORMA 30 SENIAT"),
    React.createElement(Text, { style: styles.subtitle }, `Período: ${periodLabel}`),
    React.createElement(
      View,
      { style: styles.headerRow },
      React.createElement(Text, { style: styles.headerLabel }, "Empresa:"),
      React.createElement(Text, { style: styles.headerValue }, params.companyName),
    ),
    React.createElement(
      View,
      { style: styles.headerRow },
      React.createElement(Text, { style: styles.headerLabel }, "RIF:"),
      React.createElement(Text, { style: styles.headerValue }, params.companyRif ?? "—"),
    ),
    params.isSpecialContributor
      ? React.createElement(
          View,
          { style: styles.headerRow },
          React.createElement(Text, { style: styles.headerLabel }, "Condición:"),
          React.createElement(Text, { style: styles.headerValue }, "Contribuyente Especial"),
        )
      : null,
  );
}

function SeccionAView({ a }: { a: SeccionA }) {
  return React.createElement(
    View,
    null,
    React.createElement(Text, { style: styles.sectionTitle }, "A — DÉBITOS FISCALES (VENTAS)"),
    // Encabezado de tabla
    React.createElement(
      View,
      { style: styles.tableHeader },
      React.createElement(Text, { style: styles.colConcepto }, "Concepto"),
      React.createElement(Text, { style: styles.colBase }, "Base Imponible"),
      React.createElement(Text, { style: styles.colTax }, "Débito Fiscal"),
    ),
    React.createElement(
      View,
      { style: styles.tableRow },
      React.createElement(Text, { style: styles.colConcepto }, "A1. Ventas alícuota general (16%)"),
      React.createElement(Text, { style: styles.colBase }, fmtAmt(a.general.base)),
      React.createElement(Text, { style: styles.colTax }, fmtAmt(a.general.tax)),
    ),
    React.createElement(
      View,
      { style: styles.tableRowAlt },
      React.createElement(Text, { style: styles.colConcepto }, "A2. Ventas alícuota reducida (8%)"),
      React.createElement(Text, { style: styles.colBase }, fmtAmt(a.reducida.base)),
      React.createElement(Text, { style: styles.colTax }, fmtAmt(a.reducida.tax)),
    ),
    React.createElement(
      View,
      { style: styles.tableRow },
      React.createElement(Text, { style: styles.colConcepto }, "A3. Ventas alícuota adicional lujo (15%)"),
      React.createElement(Text, { style: styles.colBase }, fmtAmt(a.adicionalLujo.base)),
      React.createElement(Text, { style: styles.colTax }, fmtAmt(a.adicionalLujo.tax)),
    ),
    React.createElement(
      View,
      { style: styles.tableRowAlt },
      React.createElement(Text, { style: styles.colConcepto }, "A4. Ventas exentas y exoneradas"),
      React.createElement(Text, { style: styles.colBase }, fmtAmt(a.exentasExoneradas.base)),
      React.createElement(Text, { style: styles.colTax }, "—"),
    ),
    React.createElement(
      View,
      { style: styles.tableRow },
      React.createElement(Text, { style: styles.colConcepto }, "A5. Exportaciones"),
      React.createElement(Text, { style: styles.colBase }, fmtAmt(a.exportaciones.base)),
      React.createElement(Text, { style: styles.colTax }, "—"),
    ),
    React.createElement(
      View,
      { style: styles.tableTotal },
      React.createElement(Text, { style: styles.colConceptoBold }, "TOTAL DÉBITOS FISCALES"),
      React.createElement(Text, { style: styles.colBaseBold }, ""),
      React.createElement(Text, { style: styles.colTaxBold }, fmtAmt(a.totalDebitosFiscales)),
    ),
  );
}

function SeccionBView({ b }: { b: SeccionB }) {
  return React.createElement(
    View,
    null,
    React.createElement(Text, { style: styles.sectionTitle }, "B — CRÉDITOS FISCALES (COMPRAS)"),
    React.createElement(
      View,
      { style: styles.tableHeader },
      React.createElement(Text, { style: styles.colConcepto }, "Concepto"),
      React.createElement(Text, { style: styles.colBase }, "Base Imponible"),
      React.createElement(Text, { style: styles.colTax }, "Crédito Fiscal"),
    ),
    React.createElement(
      View,
      { style: styles.tableRow },
      React.createElement(Text, { style: styles.colConcepto }, "B1. Compras alícuota general (16%)"),
      React.createElement(Text, { style: styles.colBase }, fmtAmt(b.general.base)),
      React.createElement(Text, { style: styles.colTax }, fmtAmt(b.general.tax)),
    ),
    React.createElement(
      View,
      { style: styles.tableRowAlt },
      React.createElement(Text, { style: styles.colConcepto }, "B2. Compras alícuota reducida (8%)"),
      React.createElement(Text, { style: styles.colBase }, fmtAmt(b.reducida.base)),
      React.createElement(Text, { style: styles.colTax }, fmtAmt(b.reducida.tax)),
    ),
    React.createElement(
      View,
      { style: styles.tableRow },
      React.createElement(Text, { style: styles.colConcepto }, "B3. Compras alícuota adicional lujo (15%)"),
      React.createElement(Text, { style: styles.colBase }, fmtAmt(b.adicionalLujo.base)),
      React.createElement(Text, { style: styles.colTax }, fmtAmt(b.adicionalLujo.tax)),
    ),
    React.createElement(
      View,
      { style: styles.tableRowAlt },
      React.createElement(Text, { style: styles.colConcepto }, "B4. Compras exentas y exoneradas"),
      React.createElement(Text, { style: styles.colBase }, fmtAmt(b.exentasExoneradas.base)),
      React.createElement(Text, { style: styles.colTax }, "—"),
    ),
    React.createElement(
      View,
      { style: styles.tableRow },
      React.createElement(Text, { style: styles.colConcepto }, "B5. Importaciones"),
      React.createElement(Text, { style: styles.colBase }, fmtAmt(b.importaciones.base)),
      React.createElement(Text, { style: styles.colTax }, fmtAmt(b.importaciones.tax)),
    ),
    React.createElement(
      View,
      { style: styles.tableTotal },
      React.createElement(Text, { style: styles.colConceptoBold }, "TOTAL CRÉDITOS FISCALES"),
      React.createElement(Text, { style: styles.colBaseBold }, ""),
      React.createElement(Text, { style: styles.colTaxBold }, fmtAmt(b.totalCreditosFiscales)),
    ),
  );
}

function SeccionCView({ c }: { c: SeccionC }) {
  return React.createElement(
    View,
    null,
    React.createElement(Text, { style: styles.sectionTitle }, "C — RETENCIONES IVA"),
    React.createElement(
      View,
      { style: styles.simpleRow },
      React.createElement(Text, { style: styles.simpleLabel }, "C1. Retenciones IVA sufridas (clientes nos retuvieron)"),
      React.createElement(Text, { style: styles.simpleValue }, fmtAmt(c.retencionesIvaSufridas)),
    ),
    React.createElement(
      View,
      { style: styles.simpleRowAlt },
      React.createElement(Text, { style: styles.simpleLabel }, "C2. Retenciones IVA practicadas (retuvimos a proveedores)"),
      React.createElement(Text, { style: styles.simpleValue }, fmtAmt(c.retencionesIvaPracticadas)),
    ),
    React.createElement(
      View,
      { style: styles.simpleTotal },
      React.createElement(Text, { style: styles.simpleLabelBold }, "TOTAL RETENCIONES"),
      React.createElement(Text, { style: styles.simpleValueBold }, fmtAmt(c.totalRetenciones)),
    ),
  );
}

function SeccionDView({ d }: { d: SeccionD }) {
  return React.createElement(
    View,
    null,
    React.createElement(Text, { style: styles.sectionTitle }, "D — IGTF"),
    React.createElement(
      View,
      { style: styles.simpleRow },
      React.createElement(Text, { style: styles.simpleLabel }, "Base IGTF"),
      React.createElement(Text, { style: styles.simpleValue }, fmtAmt(d.igtfBase)),
    ),
    React.createElement(
      View,
      { style: styles.simpleTotal },
      React.createElement(Text, { style: styles.simpleLabelBold }, "Total IGTF pagado"),
      React.createElement(Text, { style: styles.simpleValueBold }, fmtAmt(d.igtfTotal)),
    ),
  );
}

function SeccionEView({ e }: { e: SeccionE }) {
  const boxStyle = e.esSaldoAFavor ? styles.cuotaBoxFavor : styles.cuotaBox;
  const labelText = e.esSaldoAFavor
    ? "E — Saldo a Favor (Crédito Fiscal Trasladable)"
    : "E — Cuota a Pagar";
  const amountText = fmtAmt(
    typeof e.cuotaPeriodo === "object" && "abs" in e.cuotaPeriodo
      ? (e.cuotaPeriodo as { abs: () => unknown }).abs() as number
      : Math.abs(Number(e.cuotaPeriodo))
  );

  return React.createElement(
    View,
    { style: boxStyle },
    React.createElement(
      View,
      null,
      React.createElement(Text, { style: styles.cuotaLabel }, labelText),
      React.createElement(
        Text,
        { style: styles.cuotaSubtitle },
        "Débitos Fiscales − Créditos Fiscales − Retenciones IVA",
      ),
    ),
    React.createElement(Text, { style: styles.cuotaAmount }, amountText),
  );
}

function Forma30Document({ params }: { params: Forma30PDFParams }) {
  const periodLabel = `${MESES[params.month - 1]} ${params.year}`;
  const now = new Date().toLocaleDateString("es-VE");

  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", orientation: "portrait", style: styles.page },
      React.createElement(DocHeader, { params }),
      React.createElement(SeccionAView, { a: params.seccionA }),
      React.createElement(SeccionBView, { b: params.seccionB }),
      React.createElement(SeccionCView, { c: params.seccionC }),
      React.createElement(SeccionDView, { d: params.seccionD }),
      React.createElement(SeccionEView, { e: params.seccionE }),
      // Footer
      React.createElement(
        View,
        { style: styles.footer, fixed: true },
        React.createElement(Text, null, `${params.companyName} — Forma 30 — ${periodLabel}`),
        React.createElement(Text, null, `Generado: ${now}`),
      ),
    ),
  );
}

/**
 * Genera el PDF de la Forma 30 SENIAT para un período mensual.
 *
 * Solo debe llamarse desde un Server Action o Route Handler (no desde
 * componente cliente). Usa renderToBuffer() de @react-pdf/renderer.
 *
 * @returns Buffer con el PDF listo para descarga (Content-Type: application/pdf)
 */
export async function generateForma30PDF(params: Forma30PDFParams): Promise<Buffer> {
  const element = React.createElement(Forma30Document, { params });
  return renderToBuffer(element as Parameters<typeof renderToBuffer>[0]);
}
