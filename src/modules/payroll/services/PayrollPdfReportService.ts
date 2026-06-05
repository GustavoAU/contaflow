// src/modules/payroll/services/PayrollPdfReportService.ts
// Fase NOM-E: Generación de PDFs de reportes legales de nómina.
// Usa React.createElement (sin JSX) — patrón de InvoiceBookPDFService.
// NOTA: Los PDFs son referencia contable — no son formularios electrónicos
// oficiales del IVSS/INCES/Banavih (que tienen sus propios sistemas web).

import {
  Document, Page, Text, View, StyleSheet, renderToBuffer,
} from "@react-pdf/renderer";
import React from "react";
import type {
  IvssReportData,
  BanavihReportData,
  IncesReportData,
  ArcReportData,
} from "./PayrollReportService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(val: unknown): string {
  try {
    return parseFloat(String(val)).toLocaleString("es-VE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return "0,00";
  }
}

const MONTH_NAMES = [
  "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const QUARTER_LABELS = ["", "I Trim.", "II Trim.", "III Trim.", "IV Trim."];

// ─── Estilos ──────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  page: { padding: 28, fontSize: 8, fontFamily: "Helvetica" },
  title: { fontSize: 11, fontWeight: "bold", textAlign: "center", marginBottom: 2 },
  subtitle: { fontSize: 8, textAlign: "center", color: "#6b7280", marginBottom: 4 },
  notice: {
    fontSize: 7, textAlign: "center", color: "#9ca3af", marginBottom: 8,
    borderTop: "0.5pt solid #e5e7eb", paddingTop: 3,
  },
  metaRow: { flexDirection: "row", marginBottom: 6, gap: 20 },
  metaLabel: { fontSize: 7, color: "#6b7280" },
  metaValue: { fontSize: 8, fontWeight: "bold" },
  warningBox: {
    backgroundColor: "#fef3c7", border: "0.5pt solid #d97706",
    padding: 5, marginBottom: 6, fontSize: 7, color: "#92400e",
  },
  infoBox: {
    backgroundColor: "#eff6ff", border: "0.5pt solid #3b82f6",
    padding: 5, marginTop: 6, fontSize: 7, color: "#1e40af",
  },
  th: { flexDirection: "row", backgroundColor: "#e5e7eb", borderBottom: "1pt solid #9ca3af" },
  tr: { flexDirection: "row", borderBottom: "0.5pt solid #e5e7eb" },
  trAlt: { flexDirection: "row", backgroundColor: "#f9fafb", borderBottom: "0.5pt solid #e5e7eb" },
  totRow: { flexDirection: "row", borderTop: "1pt solid #374151", backgroundColor: "#f3f4f6", marginTop: 1 },
  // Celdas normales
  c1: { padding: "2pt 3pt", flex: 1.4, fontSize: 7 },
  c2: { padding: "2pt 3pt", flex: 0.7, fontSize: 7 },
  c2r: { padding: "2pt 3pt", flex: 0.7, fontSize: 7, textAlign: "right" },
  c3: { padding: "2pt 3pt", flex: 1, fontSize: 7, textAlign: "right" },
  // Celdas totales (bold)
  t1: { padding: "2pt 3pt", flex: 1.4, fontSize: 7, fontWeight: "bold" },
  t2: { padding: "2pt 3pt", flex: 0.7, fontSize: 7, fontWeight: "bold" },
  t2r: { padding: "2pt 3pt", flex: 0.7, fontSize: 7, fontWeight: "bold", textAlign: "right" },
  t3: { padding: "2pt 3pt", flex: 1, fontSize: 7, fontWeight: "bold", textAlign: "right" },
  // ARC
  arcSection: { marginBottom: 8, border: "0.5pt solid #e5e7eb", padding: 6 },
  arcTitle: { fontSize: 9, fontWeight: "bold", marginBottom: 4, color: "#374151" },
  arcRow: { flexDirection: "row", justifyContent: "space-between", padding: "1pt 2pt" },
  arcRowBold: { flexDirection: "row", justifyContent: "space-between", padding: "1pt 2pt",
    borderTop: "0.5pt solid #374151" },
  arcLabel: { fontSize: 7, flex: 3 },
  arcValue: { fontSize: 7, flex: 1, textAlign: "right" },
  arcLabelBold: { fontSize: 7, flex: 3, fontWeight: "bold" },
  arcValueBold: { fontSize: 7, flex: 1, textAlign: "right", fontWeight: "bold" },
  arcValueBlue: { fontSize: 7, flex: 1, textAlign: "right", fontWeight: "bold", color: "#1e40af" },
});

const e = React.createElement;

// ─── IVSS PDF ─────────────────────────────────────────────────────────────────

function buildIvssPdf(data: IvssReportData) {
  const rows = data.rows.map((row, i) =>
    e(View, { key: row.employeeId, style: i % 2 === 0 ? S.tr : S.trAlt },
      e(Text, { style: S.c1 }, `${row.lastName}, ${row.firstName}`),
      e(Text, { style: S.c2 }, `${row.cedulaType}-${row.cedulaNumber}`),
      e(Text, { style: S.c2r }, String(row.weeksWorked)),
      e(Text, { style: S.c3 }, fmt(row.salaryBase)),
      e(Text, { style: S.c3 }, fmt(row.ivssWorkerAmount)),
      e(Text, { style: S.c3 }, fmt(row.ivssEmployerAmount)),
      e(Text, { style: S.c3 }, fmt(row.ivssTotalAmount)),
    )
  );

  return e(Document, null,
    e(Page, { size: "A4", orientation: "landscape", style: S.page },
      e(Text, { style: S.title }, "Planilla IVSS — Forma 14-02 (Referencia Contable)"),
      e(Text, { style: S.subtitle }, `${data.companyName} | ${MONTH_NAMES[data.month]} ${data.year}`),
      e(Text, { style: S.notice }, "Este documento es para referencia del contador. La declaración oficial se realiza en el sistema TIUNA del IVSS."),
      !data.utCapApplied
        ? e(View, { style: S.warningBox },
            e(Text, null, "Valor de la UT no configurado. El techo salarial IVSS (LSS Art. 62: 10 UT) no fue aplicado. Configure el valor en Configuración de Nómina.")
          )
        : null,
      e(View, { style: S.metaRow },
        e(View, null, e(Text, { style: S.metaLabel }, "Empresa"), e(Text, { style: S.metaValue }, data.companyName)),
        e(View, null, e(Text, { style: S.metaLabel }, "Período"), e(Text, { style: S.metaValue }, `${MONTH_NAMES[data.month]} ${data.year}`)),
        data.utValue
          ? e(View, null, e(Text, { style: S.metaLabel }, "Valor UT"), e(Text, { style: S.metaValue }, `Bs. ${fmt(data.utValue)}`))
          : null,
      ),
      e(View, null,
        e(View, { style: S.th },
          e(Text, { style: S.c1 }, "Apellidos y Nombres"),
          e(Text, { style: S.c2 }, "Cédula"),
          e(Text, { style: S.c2r }, "Semanas"),
          e(Text, { style: S.c3 }, "Salario Base"),
          e(Text, { style: S.c3 }, "IVSS Obrero (4%)"),
          e(Text, { style: S.c3 }, "IVSS Patronal (9%)"),
          e(Text, { style: S.c3 }, "Total IVSS"),
        ),
        ...rows,
        e(View, { style: S.totRow },
          e(Text, { style: S.t1 }, "TOTALES"),
          e(Text, { style: S.t2 }, ""),
          e(Text, { style: S.t2r }, ""),
          e(Text, { style: S.t3 }, ""),
          e(Text, { style: S.t3 }, fmt(data.totalWorkerAmount)),
          e(Text, { style: S.t3 }, fmt(data.totalEmployerAmount)),
          e(Text, { style: S.t3 }, fmt(data.totalAmount)),
        ),
      ),
    ),
  );
}

// ─── Banavih PDF ──────────────────────────────────────────────────────────────

function buildBanavihPdf(data: BanavihReportData) {
  const rows = data.rows.map((row, i) =>
    e(View, { key: row.employeeId, style: i % 2 === 0 ? S.tr : S.trAlt },
      e(Text, { style: S.c1 }, `${row.lastName}, ${row.firstName}`),
      e(Text, { style: S.c2 }, `${row.cedulaType}-${row.cedulaNumber}`),
      e(Text, { style: S.c3 }, fmt(row.salaryBase)),
      e(Text, { style: S.c3 }, fmt(row.faovWorkerAmount)),
      e(Text, { style: S.c3 }, fmt(row.faovEmployerAmount)),
      e(Text, { style: S.c3 }, fmt(row.faovTotalAmount)),
    )
  );

  return e(Document, null,
    e(Page, { size: "A4", orientation: "landscape", style: S.page },
      e(Text, { style: S.title }, "Planilla Banavih / FAOV (Referencia Contable)"),
      e(Text, { style: S.subtitle }, `${data.companyName} | ${MONTH_NAMES[data.month]} ${data.year}`),
      e(Text, { style: S.notice }, "Este documento es para referencia del contador. La declaración oficial se realiza en el sistema FAOV-Web del Banavih."),
      e(View, { style: S.metaRow },
        e(View, null, e(Text, { style: S.metaLabel }, "Empresa"), e(Text, { style: S.metaValue }, data.companyName)),
        e(View, null, e(Text, { style: S.metaLabel }, "Período"), e(Text, { style: S.metaValue }, `${MONTH_NAMES[data.month]} ${data.year}`)),
      ),
      e(View, null,
        e(View, { style: S.th },
          e(Text, { style: S.c1 }, "Apellidos y Nombres"),
          e(Text, { style: S.c2 }, "Cédula"),
          e(Text, { style: S.c3 }, "Salario Base"),
          e(Text, { style: S.c3 }, "FAOV Trabajador (1%)"),
          e(Text, { style: S.c3 }, "FAOV Patronal (1%)"),
          e(Text, { style: S.c3 }, "Total FAOV"),
        ),
        ...rows,
        e(View, { style: S.totRow },
          e(Text, { style: S.t1 }, "TOTALES"),
          e(Text, { style: S.t2 }, ""),
          e(Text, { style: S.t3 }, ""),
          e(Text, { style: S.t3 }, fmt(data.totalWorkerAmount)),
          e(Text, { style: S.t3 }, fmt(data.totalEmployerAmount)),
          e(Text, { style: S.t3 }, fmt(data.totalAmount)),
        ),
      ),
    ),
  );
}

// ─── INCES PDF ────────────────────────────────────────────────────────────────

function buildIncesPdf(data: IncesReportData) {
  const rows = data.rows.map((row, i) =>
    e(View, { key: row.employeeId, style: i % 2 === 0 ? S.tr : S.trAlt },
      e(Text, { style: S.c1 }, `${row.lastName}, ${row.firstName}`),
      e(Text, { style: S.c2 }, `${row.cedulaType}-${row.cedulaNumber}`),
      e(Text, { style: S.c3 }, fmt(row.salaryBase)),
      e(Text, { style: S.c3 }, fmt(row.incesWorkerAmount)),
      e(Text, { style: S.c3 }, fmt(row.profitAmount)),
    )
  );

  return e(Document, null,
    e(Page, { size: "A4", orientation: "landscape", style: S.page },
      e(Text, { style: S.title }, "Planilla INCES — Aporte Trimestral (Referencia Contable)"),
      e(Text, { style: S.subtitle }, `${data.companyName} | ${QUARTER_LABELS[data.quarter]} ${data.year}`),
      e(Text, { style: S.notice }, "Este documento es para referencia del contador. La declaración oficial se realiza en el sistema del INCES."),
      e(View, null,
        e(View, { style: S.th },
          e(Text, { style: S.c1 }, "Apellidos y Nombres"),
          e(Text, { style: S.c2 }, "Cédula"),
          e(Text, { style: S.c3 }, "Salario Trim."),
          e(Text, { style: S.c3 }, "INCES Obrero (2%)"),
          e(Text, { style: S.c3 }, "Utilidades año"),
        ),
        ...rows,
        e(View, { style: S.totRow },
          e(Text, { style: S.t1 }, "TOTALES"),
          e(Text, { style: S.t2 }, ""),
          e(Text, { style: S.t3 }, ""),
          e(Text, { style: S.t3 }, fmt(data.totalWorkerAmount)),
          e(Text, { style: S.t3 }, ""),
        ),
      ),
      e(View, { style: S.infoBox },
        e(Text, null, `Aporte patronal INCES sobre utilidades (0.5%): Bs. ${fmt(data.totalEmployerProfitContrib)}`),
        e(Text, { style: { marginTop: 2 } }, `Total período (obreros + patrono utilidades): Bs. ${fmt(data.totalAmount)}`),
      ),
    ),
  );
}

// ─── ARC PDF ──────────────────────────────────────────────────────────────────

function buildArcPdf(data: ArcReportData) {
  const emp = data.employee;
  return e(Document, null,
    e(Page, { size: "A4", style: S.page },
      e(Text, { style: S.title }, "Comprobante de Retención ISLR (ARC)"),
      e(Text, { style: S.subtitle }, `Decreto 1.808 | Año ${data.year} | ${data.companyName}`),
      e(Text, { style: S.notice }, "El empleado debe conservar este documento para su Declaración de Rentas ante el SENIAT."),

      // Datos del empleado
      e(View, { style: S.arcSection },
        e(Text, { style: S.arcTitle }, "Datos del Empleado"),
        e(Text, null, `Nombre: ${emp.lastName}, ${emp.firstName}`),
        e(Text, null, `Cédula de Identidad: ${emp.cedulaType}-${emp.cedulaNumber}`),
        e(Text, null, `Agente de Retención: ${data.companyName}`),
        e(Text, null, `Ejercicio Fiscal: ${data.year}`),
      ),

      // Ingresos
      e(View, { style: S.arcSection },
        e(Text, { style: S.arcTitle }, "Ingresos del Período"),
        e(View, { style: S.arcRow },
          e(Text, { style: S.arcLabel }, "Sueldos y Salarios (incl. Horas Extra)"),
          e(Text, { style: S.arcValue }, `Bs. ${fmt(data.totalEarnings)}`),
        ),
        e(View, { style: S.arcRow },
          e(Text, { style: S.arcLabel }, "Utilidades (Art. 131 LOTTT)"),
          e(Text, { style: S.arcValue }, `Bs. ${fmt(data.profitAmount)}`),
        ),
        e(View, { style: S.arcRow },
          e(Text, { style: S.arcLabel }, "Bono Vacacional (Art. 223 LOTTT)"),
          e(Text, { style: S.arcValue }, `Bs. ${fmt(data.vacationBonus)}`),
        ),
        e(View, { style: S.arcRowBold },
          e(Text, { style: S.arcLabelBold }, "Total Ingresos Brutos"),
          e(Text, { style: S.arcValueBold }, `Bs. ${fmt(data.totalGrossIncome)}`),
        ),
      ),

      // Cálculo ISLR
      e(View, { style: S.arcSection },
        e(Text, { style: S.arcTitle }, "Cálculo ISLR (Decreto 1.808 — Tarifa 1)"),
        e(View, { style: S.arcRow },
          e(Text, { style: S.arcLabel }, "Total Ingresos Brutos"),
          e(Text, { style: S.arcValue }, `Bs. ${fmt(data.totalGrossIncome)}`),
        ),
        e(View, { style: S.arcRow },
          e(Text, { style: S.arcLabel }, "Desgravamen Único (774 UT — Art. 60 D.1808)"),
          e(Text, { style: S.arcValue }, data.utValue ? `Bs. ${fmt(data.desgravamen)}` : "UT no configurada"),
        ),
        e(View, { style: S.arcRow },
          e(Text, { style: S.arcLabel }, "Enriquecimiento Neto Gravable"),
          e(Text, { style: S.arcValue }, `Bs. ${fmt(data.taxableIncome)}`),
        ),
        data.utValue
          ? e(View, { style: S.arcRow },
              e(Text, { style: S.arcLabel }, "Enriquecimiento Neto Gravable (en UT)"),
              e(Text, { style: S.arcValue }, `${fmt(data.taxableIncomeUT)} UT`),
            )
          : null,
        e(View, { style: S.arcRowBold },
          e(Text, { style: S.arcLabelBold }, "ISLR Calculado (Tarifa 1)"),
          e(Text, { style: S.arcValueBold }, `Bs. ${fmt(data.islrAmount)}`),
        ),
        e(View, { style: S.arcRowBold },
          e(Text, { style: S.arcLabelBold }, "ISLR Retenido por la Empresa"),
          e(Text, { style: S.arcValueBlue }, `Bs. ${fmt(data.withheldAmount)}`),
        ),
      ),

      !data.utValue
        ? e(View, { style: S.warningBox },
            e(Text, null, "Valor de la UT no configurado. El desgravamen y el ISLR no pueden calcularse correctamente. Configure el valor de la UT en Configuración de Nómina.")
          )
        : null,
    ),
  );
}

// ─── Constancia de Trabajo IVSS (Forma 14-100) ───────────────────────────────
// Documento individual por empleado para acreditar relación laboral ante el IVSS.

export interface ConstanciaTrabajoData {
  companyName: string;
  companyRif: string;
  employeeName: string;
  cedulaType: string;
  cedulaNumber: string;
  ivssNumber: string | null;
  position: string;
  payrollWorkerType: string;
  contractType: string;
  hireDate: string;       // YYYY-MM-DD
  terminationDate: string | null;
  salaryMensual: string;  // Bs serializado
  issueDate: string;      // YYYY-MM-DD
}

function buildConstanciaPdf(d: ConstanciaTrabajoData) {
  const row = (label: string, value: string) =>
    e(View, { style: { flexDirection: "row", padding: "4pt 0pt", borderBottom: "0.5pt solid #e5e7eb" } },
      e(Text, { style: { fontSize: 8, flex: 1.5, color: "#6b7280" } }, label),
      e(Text, { style: { fontSize: 8, flex: 2, fontWeight: "bold" } }, value),
    );

  return e(Document, null,
    e(Page, { size: "A4", style: { ...S.page, padding: 40 } },
      e(Text, { style: { ...S.title, fontSize: 13, marginBottom: 4 } }, "CONSTANCIA DE TRABAJO"),
      e(Text, { style: { ...S.subtitle, fontSize: 9, marginBottom: 2 } }, "Para fines del IVSS — Forma 14-100 (Referencia Patronal)"),
      e(Text, { style: { ...S.notice, marginBottom: 16 } },
        "Documento emitido por el patrono. La inscripción oficial se realiza en el sistema TIUNA del IVSS."),

      e(View, { style: { border: "1pt solid #d1d5db", borderRadius: 4, padding: 16, marginBottom: 12 } },
        e(Text, { style: { fontSize: 10, fontWeight: "bold", marginBottom: 8, color: "#374151" } }, "DATOS DEL PATRONO"),
        row("Razón Social:", d.companyName),
        row("RIF:", d.companyRif),
      ),

      e(View, { style: { border: "1pt solid #d1d5db", borderRadius: 4, padding: 16, marginBottom: 12 } },
        e(Text, { style: { fontSize: 10, fontWeight: "bold", marginBottom: 8, color: "#374151" } }, "DATOS DEL TRABAJADOR"),
        row("Apellidos y Nombres:", d.employeeName),
        row("Cédula de Identidad:", `${d.cedulaType}-${d.cedulaNumber}`),
        row("N° Asegurado IVSS:", d.ivssNumber ?? "No registrado"),
        row("Cargo / Función:", d.position),
        row("Tipo de Trabajador:", d.payrollWorkerType === "OBRERO" ? "Obrero" : "Empleado"),
        row("Tipo de Contrato:", d.contractType === "INDEFINIDO" ? "Tiempo Indeterminado" : d.contractType === "DETERMINADO" ? "Tiempo Determinado" : "Por Obra Determinada"),
        row("Fecha de Ingreso:", d.hireDate),
        row("Fecha de Egreso:", d.terminationDate ?? "Activo"),
        row("Salario Mensual:", `Bs. ${parseFloat(d.salaryMensual).toLocaleString("es-VE", { minimumFractionDigits: 2 })}`),
      ),

      e(View, { style: { marginTop: 24, borderTop: "1pt solid #e5e7eb", paddingTop: 12 } },
        e(Text, { style: { fontSize: 8, color: "#6b7280", textAlign: "center" } },
          `Emitido el ${d.issueDate} por el sistema ContaFlow. Documento válido como referencia patronal.`),
      ),
    ),
  );
}

// ─── PayrollPdfReportService ──────────────────────────────────────────────────

export const PayrollPdfReportService = {
  async generateIvssPdf(data: IvssReportData): Promise<Buffer> {
    return renderToBuffer(buildIvssPdf(data));
  },
  async generateBanavihPdf(data: BanavihReportData): Promise<Buffer> {
    return renderToBuffer(buildBanavihPdf(data));
  },
  async generateIncesPdf(data: IncesReportData): Promise<Buffer> {
    return renderToBuffer(buildIncesPdf(data));
  },
  async generateArcPdf(data: ArcReportData): Promise<Buffer> {
    return renderToBuffer(buildArcPdf(data));
  },
  async generateConstanciaPdf(data: ConstanciaTrabajoData): Promise<Buffer> {
    return renderToBuffer(buildConstanciaPdf(data));
  },
};
