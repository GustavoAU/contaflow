// src/modules/audit/services/AuditLogPDFService.ts
// OM-04: Generación de PDF inmutable del Registro de Auditoría
// R-2: contentHash SHA-256 almacenado en AuditLog — no en Object Storage
//      (el contenido es derivable de la BD; lo que importa es la trazabilidad del export)
// ADR-020: firma digital opcional con DocumentSigningService si hay certificado activo

import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import type { AuditLogRow } from "./AuditLogService";

// ─── Estilos ──────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  page:          { padding: 36, fontSize: 8, fontFamily: "Helvetica" },
  header:        { marginBottom: 16, borderBottom: "1.5pt solid #1f2937", paddingBottom: 10 },
  title:         { fontSize: 13, fontWeight: "bold", color: "#111827" },
  subtitle:      { fontSize: 9, color: "#374151", marginTop: 2 },
  meta:          { fontSize: 7.5, color: "#6b7280", marginTop: 1 },
  filterBlock:   { marginBottom: 10, padding: "6pt 8pt", backgroundColor: "#f9fafb", borderRadius: 3 },
  filterTitle:   { fontSize: 7, fontWeight: "bold", color: "#6b7280", marginBottom: 2 },
  filterRow:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterItem:    { fontSize: 7, color: "#374151" },
  // Tabla
  tableHeader:   {
    flexDirection: "row",
    backgroundColor: "#1f2937",
    padding: "4pt 3pt",
    marginBottom: 0,
  },
  tableRow:      { flexDirection: "row", borderBottom: "0.5pt solid #e5e7eb", padding: "3pt 3pt" },
  tableRowAlt:   { flexDirection: "row", backgroundColor: "#f9fafb", borderBottom: "0.5pt solid #e5e7eb", padding: "3pt 3pt" },
  // Columnas: fecha(90) | entidad(60) | acción(80) | id(90) | usuario(90) | cambios(rest)
  colDate:    { width: 90, fontSize: 7, color: "#374151" },
  colEntity:  { width: 65, fontSize: 7 },
  colAction:  { width: 85, fontSize: 7 },
  colId:      { width: 95, fontSize: 6.5, color: "#6b7280" },
  colUser:    { width: 90, fontSize: 6.5, color: "#6b7280" },
  colChanges: { flex: 1, fontSize: 6.5 },
  thText:     { color: "#ffffff", fontWeight: "bold" },
  // Footer
  footer:     { marginTop: 14, borderTop: "1pt solid #e5e7eb", paddingTop: 6 },
  footerText: { fontSize: 7, color: "#9ca3af", textAlign: "center" },
  hashBlock:  { marginTop: 4, fontSize: 6.5, color: "#9ca3af", textAlign: "center" },
  signedBadge:{ marginTop: 4, fontSize: 7, color: "#059669", textAlign: "center", fontWeight: "bold" },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date | string): string {
  const dt = new Date(d);
  return dt.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric" })
    + " " + dt.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function summarizeChanges(row: AuditLogRow): string {
  if (!row.oldValue && !row.newValue) return "—";
  if (!row.oldValue && row.newValue) {
    const keys = Object.keys(row.newValue as Record<string, unknown>).slice(0, 3);
    return `Nuevo: ${keys.join(", ")}`;
  }
  if (row.oldValue && row.newValue) {
    const oldKeys = Object.keys(row.oldValue as Record<string, unknown>);
    const newKeys = Object.keys(row.newValue as Record<string, unknown>);
    const changed = newKeys.filter((k) => oldKeys.includes(k)).slice(0, 3);
    return changed.length ? `Modificado: ${changed.join(", ")}` : `Campos: ${newKeys.slice(0, 3).join(", ")}`;
  }
  return "Sin datos";
}

// ─── Generación del PDF ───────────────────────────────────────────────────────

export interface AuditLogPDFInput {
  rows: AuditLogRow[];
  companyName: string;
  companyRif: string | null;
  filters: {
    entityName?: string;
    userId?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  exportedBy: string;
  contentHash: string;
  signed: boolean;
  thumbprint?: string;
  signedAt?: string;
}

export async function generateAuditLogPDF(input: AuditLogPDFInput): Promise<Buffer> {
  const { rows, companyName, companyRif, filters, exportedBy, contentHash, signed, thumbprint, signedAt } = input;

  const doc = React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", orientation: "landscape", style: S.page },
      // ── Encabezado ────────────────────────────────────────────────────────
      React.createElement(
        View,
        { style: S.header },
        React.createElement(Text, { style: S.title }, "Registro de Auditoría"),
        React.createElement(Text, { style: S.subtitle }, `${companyName}${companyRif ? ` — ${companyRif}` : ""}`),
        React.createElement(Text, { style: S.meta }, `Exportado: ${fmtDate(new Date())}   •   Por: ${exportedBy}   •   ${rows.length} registro(s)`),
      ),

      // ── Filtros aplicados ─────────────────────────────────────────────────
      React.createElement(
        View,
        { style: S.filterBlock },
        React.createElement(Text, { style: S.filterTitle }, "FILTROS APLICADOS"),
        React.createElement(
          View,
          { style: S.filterRow },
          React.createElement(Text, { style: S.filterItem }, `Entidad: ${filters.entityName || "Todas"}`),
          React.createElement(Text, { style: S.filterItem }, `Usuario: ${filters.userId || "Todos"}`),
          React.createElement(Text, { style: S.filterItem }, `Desde: ${filters.dateFrom || "—"}`),
          React.createElement(Text, { style: S.filterItem }, `Hasta: ${filters.dateTo || "—"}`),
        ),
      ),

      // ── Encabezado de tabla ───────────────────────────────────────────────
      React.createElement(
        View,
        { style: S.tableHeader },
        React.createElement(Text, { style: [S.colDate, S.thText] }, "Fecha / Hora"),
        React.createElement(Text, { style: [S.colEntity, S.thText] }, "Entidad"),
        React.createElement(Text, { style: [S.colAction, S.thText] }, "Acción"),
        React.createElement(Text, { style: [S.colId, S.thText] }, "ID Entidad"),
        React.createElement(Text, { style: [S.colUser, S.thText] }, "Usuario"),
        React.createElement(Text, { style: [S.colChanges, S.thText] }, "Cambios"),
      ),

      // ── Filas ─────────────────────────────────────────────────────────────
      ...rows.map((row, idx) =>
        React.createElement(
          View,
          { key: row.id, style: idx % 2 === 0 ? S.tableRow : S.tableRowAlt },
          React.createElement(Text, { style: S.colDate }, fmtDate(row.createdAt)),
          React.createElement(Text, { style: S.colEntity }, row.entityName),
          React.createElement(Text, { style: S.colAction }, row.action),
          React.createElement(Text, { style: S.colId }, row.entityId.slice(0, 20)),
          React.createElement(Text, { style: S.colUser }, row.userId.slice(-16)),
          React.createElement(Text, { style: S.colChanges }, summarizeChanges(row)),
        )
      ),

      // ── Pie de página ─────────────────────────────────────────────────────
      React.createElement(
        View,
        { style: S.footer },
        React.createElement(Text, { style: S.footerText }, "Documento generado por ContaFlow — Registro de Auditoría Inmutable"),
        React.createElement(Text, { style: S.hashBlock }, `SHA-256: ${contentHash}`),
        signed && thumbprint
          ? React.createElement(Text, { style: S.signedBadge }, `✓ Firmado digitalmente — Thumbprint: ${thumbprint}   SignedAt: ${signedAt}`)
          : React.createElement(Text, { style: S.hashBlock }, "Sin firma digital (certificado no configurado)"),
      ),
    )
  );

  return renderToBuffer(doc);
}
