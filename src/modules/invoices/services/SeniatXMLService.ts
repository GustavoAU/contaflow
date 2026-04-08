// src/modules/invoices/services/SeniatXMLService.ts
//
// Fase 20 — Generación de XML compatible con Providencia 0071 SENIAT.
// Venezuela no tiene un sistema de e-facturación mandatorio operativo (SDCA
// anunciado pero no desplegado). Este XML es un artefacto descargable útil
// para software de terceros y preparación para integración futura.
//
// ADR-008: XML generado como string puro (KISS). Namespace urn:ve:seniat:factura:1.0.
// Escape XML obligatorio en todos los valores de texto.

import { Decimal } from "decimal.js";

// ─── Tipos de entrada ──────────────────────────────────────────────────────────

export type SeniatXMLParams = {
  // Empresa emisora
  companyName: string;
  companyRif: string;
  companyAddress?: string | null;
  // Documento
  invoiceType: "SALE" | "PURCHASE";
  docType: string;
  invoiceNumber: string;
  controlNumber?: string | null;
  date: Date;
  currency: string;
  // Contraparte
  counterpartName: string;
  counterpartRif: string;
  // Líneas de impuesto
  taxLines: Array<{
    taxType: string; // IVA_GENERAL | IVA_REDUCIDO | IVA_ADICIONAL | EXENTO | EXONERADA
    base: string;
    rate: string;
    amount: string;
  }>;
  // Retenciones (opcionales — solo si > 0)
  ivaRetentionAmount?: string;
  ivaRetentionVoucher?: string | null;
  islrRetentionAmount?: string;
  // IGTF (opcional — solo si > 0)
  igtfBase?: string;
  igtfAmount?: string;
};

// ─── Helpers privados ──────────────────────────────────────────────────────────

/** Escapa los 5 caracteres especiales de XML en un valor de texto */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Devuelve true si el string representa un valor Decimal mayor que cero */
function isPositive(val?: string | null): boolean {
  if (!val) return false;
  try {
    return new Decimal(val).greaterThan(0);
  } catch {
    return false;
  }
}

/** Formatea una Date a YYYY-MM-DD */
function fmtDate(d: Date): string {
  return new Date(d).toISOString().split("T")[0]!;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  FACTURA: "FACTURA",
  NOTA_DEBITO: "NOTA_DE_DEBITO",
  NOTA_CREDITO: "NOTA_DE_CREDITO",
  REPORTE_Z: "REPORTE_Z",
  RESUMEN_VENTAS: "RESUMEN_VENTAS",
  PLANILLA_IMPORTACION: "PLANILLA_IMPORTACION",
  OTRO: "OTRO",
};

// ─── Servicio ─────────────────────────────────────────────────────────────────

export class SeniatXMLService {
  /**
   * Genera el XML de una factura venezolana en formato compatible con
   * Providencia 0071 SENIAT (urn:ve:seniat:factura:1.0).
   *
   * ADR-008 D-1: string puro, sin librería XML externa.
   * ADR-008 D-6: todos los valores de texto son escapados con escapeXml().
   * ADR-008 D-7: nodos opcionales omitidos si son null/undefined/cero.
   */
  static generate(p: SeniatXMLParams): string {
    const tipoDocumento = DOC_TYPE_LABELS[p.docType] ?? escapeXml(p.docType);
    const tipoOperacion = p.invoiceType === "SALE" ? "VENTA" : "COMPRA";

    // ── Totales calculados ─────────────────────────────────────────────────────
    const totalBase = p.taxLines
      .reduce((acc, l) => acc.plus(l.base), new Decimal(0))
      .toFixed(2);
    const totalIva = p.taxLines
      .reduce((acc, l) => acc.plus(l.amount), new Decimal(0))
      .toFixed(2);
    const montoTotal = new Decimal(totalBase).plus(totalIva).toFixed(2);

    // ── Líneas de impuesto → nodos XML ────────────────────────────────────────
    const taxLinesXml = p.taxLines
      .map((l) => {
        switch (l.taxType) {
          case "IVA_GENERAL":
            return `    <AlicuotaGeneral tasa="${l.rate}">
      <BaseImponible>${l.base}</BaseImponible>
      <MontoIVA>${l.amount}</MontoIVA>
    </AlicuotaGeneral>`;
          case "IVA_REDUCIDO":
            return `    <AlicuotaReducida tasa="${l.rate}">
      <BaseImponible>${l.base}</BaseImponible>
      <MontoIVA>${l.amount}</MontoIVA>
    </AlicuotaReducida>`;
          case "IVA_ADICIONAL":
            return `    <AlicuotaAdicional tasa="${l.rate}">
      <BaseImponible>${l.base}</BaseImponible>
      <MontoIVA>${l.amount}</MontoIVA>
    </AlicuotaAdicional>`;
          case "EXENTO":
          case "EXONERADA":
            return `    <Exento>
      <BaseImponible>${l.base}</BaseImponible>
    </Exento>`;
          default:
            return `    <OtroImpuesto tipo="${escapeXml(l.taxType)}" tasa="${l.rate}">
      <BaseImponible>${l.base}</BaseImponible>
      <MontoIVA>${l.amount}</MontoIVA>
    </OtroImpuesto>`;
        }
      })
      .join("\n");

    // ── Sección retenciones (ADR-008 D-7: omitir si cero) ────────────────────
    const hasIvaRet = isPositive(p.ivaRetentionAmount);
    const hasIslrRet = isPositive(p.islrRetentionAmount);
    const retencionesXml =
      hasIvaRet || hasIslrRet
        ? `  <Retenciones>
${
  hasIvaRet
    ? `    <IVA>
      <Monto>${p.ivaRetentionAmount}</Monto>${
        p.ivaRetentionVoucher
          ? `\n      <NumeroComprobante>${escapeXml(p.ivaRetentionVoucher)}</NumeroComprobante>`
          : ""
      }
    </IVA>`
    : ""
}
${
  hasIslrRet
    ? `    <ISLR>
      <Monto>${p.islrRetentionAmount}</Monto>
    </ISLR>`
    : ""
}
  </Retenciones>`
        : "";

    // ── Sección IGTF (ADR-008 D-7: omitir si cero) ────────────────────────────
    const igtfXml = isPositive(p.igtfAmount)
      ? `  <IGTF>
    <Base>${p.igtfBase ?? "0.00"}</Base>
    <Monto>${p.igtfAmount}</Monto>
  </IGTF>`
      : "";

    // ── Número de control (opcional) ──────────────────────────────────────────
    const controlXml = p.controlNumber
      ? `    <NumeroControl>${escapeXml(p.controlNumber)}</NumeroControl>\n`
      : "";

    // ── Dirección de la empresa (opcional) ────────────────────────────────────
    const addressXml = p.companyAddress
      ? `    <Direccion>${escapeXml(p.companyAddress)}</Direccion>\n`
      : "";

    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generado por ContaFlow — Providencia 0071 SENIAT -->
<FacturaSENIAT xmlns="urn:ve:seniat:factura:1.0" version="1.0">
  <Encabezado>
    <TipoDocumento>${tipoDocumento}</TipoDocumento>
    <TipoOperacion>${tipoOperacion}</TipoOperacion>
    <NumeroFactura>${escapeXml(p.invoiceNumber)}</NumeroFactura>
${controlXml}    <FechaEmision>${fmtDate(p.date)}</FechaEmision>
    <Moneda>${escapeXml(p.currency)}</Moneda>
  </Encabezado>
  <Emisor>
    <RIF>${escapeXml(p.companyRif)}</RIF>
    <RazonSocial>${escapeXml(p.companyName)}</RazonSocial>
${addressXml}  </Emisor>
  <Receptor>
    <RIF>${escapeXml(p.counterpartRif)}</RIF>
    <RazonSocial>${escapeXml(p.counterpartName)}</RazonSocial>
  </Receptor>
  <DetalleImpuestos>
${taxLinesXml}
  </DetalleImpuestos>
  <Totales>
    <TotalBaseImponible>${totalBase}</TotalBaseImponible>
    <TotalIVA>${totalIva}</TotalIVA>
    <MontoTotal>${montoTotal}</MontoTotal>
  </Totales>
${retencionesXml}${retencionesXml ? "\n" : ""}${igtfXml}${igtfXml ? "\n" : ""}</FacturaSENIAT>`;
  }

  /**
   * Genera el nombre de archivo sugerido para el XML.
   * Formato: factura-{tipo}-{numero}.xml
   */
  static filename(p: Pick<SeniatXMLParams, "invoiceType" | "invoiceNumber">): string {
    const tipo = p.invoiceType === "SALE" ? "venta" : "compra";
    const nro = p.invoiceNumber.replace(/[^a-zA-Z0-9-]/g, "_");
    return `factura-${tipo}-${nro}.xml`;
  }

  /**
   * Genera el contenido del QR code para una factura.
   * ADR-008 D-4: formato CONTAFLOW:RIF=...;FACTURA=...;CONTROL=...;...
   */
  static qrContent(p: Pick<
    SeniatXMLParams,
    "companyRif" | "invoiceNumber" | "controlNumber" | "date" | "currency"
  > & { montoTotal: string }): string {
    const parts = [
      `RIF=${p.companyRif}`,
      `FACTURA=${p.invoiceNumber}`,
      ...(p.controlNumber ? [`CONTROL=${p.controlNumber}`] : []),
      `TOTAL=${p.montoTotal}`,
      `FECHA=${fmtDate(p.date)}`,
      `MONEDA=${p.currency}`,
    ];
    return `CONTAFLOW:${parts.join(";")}`;
  }
}
