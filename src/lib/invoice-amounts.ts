// src/lib/invoice-amounts.ts
// Base, IVA y total de una factura a partir de sus InvoiceTaxLine. Módulo PURO (solo decimal.js): también lo importa
// el formulario del navegador. Fuente única del criterio de lujo, para que libro, asiento, XML, QR y PDF den el mismo total.
import { Decimal } from "decimal.js";

export type AmountTaxLine = {
  taxType: string;
  base: { toString(): string };
  amount: { toString(): string };
};

// ADICIONAL_31 (lujo) se guarda como DOS líneas con la MISMA base (IVA_GENERAL + IVA_ADICIONAL) y la BD no distingue el
// grupo (InvoiceTaxLine no tiene luxuryGroupId): la base adicional solo cuenta en lo que excede a la general (una factura
// con solo IVA_ADICIONAL conserva su base). Sumar base + monto de todas las líneas cuenta esa base dos veces (1000 -> 2310).
export function invoiceBaseAndIva(lines: AmountTaxLine[]): { base: Decimal; iva: Decimal } {
  let general = new Decimal(0);
  let additional = new Decimal(0);
  let otherBase = new Decimal(0); // reducida + exenta
  let iva = new Decimal(0);
  for (const line of lines) {
    const base = new Decimal(line.base.toString());
    iva = iva.plus(line.amount.toString());
    if (line.taxType === "IVA_GENERAL") general = general.plus(base);
    else if (line.taxType === "IVA_ADICIONAL") additional = additional.plus(base);
    else otherBase = otherBase.plus(base);
  }
  const uncoveredAdditional = Decimal.max(additional.minus(general), 0);
  return { base: general.plus(otherBase).plus(uncoveredAdditional), iva };
}

export function invoiceTotalAmount(lines: AmountTaxLine[]): Decimal {
  const { base, iva } = invoiceBaseAndIva(lines);
  return base.plus(iva);
}

// ─── ADR-049 — tolerancia de "IVA impreso" y editabilidad en el formulario ────────────────────────
// Módulo compartido servidor/cliente: fuente ÚNICA de esta clasificación (antes invoice.schema.ts
// tenía su propia copia con la lógica INVERTIDA — allow-list de los docType ESTRICTOS, así que
// cualquier docType nuevo de venta heredaba tolerancia amplia por omisión, fail-OPEN). Aquí es al
// revés a propósito: allow-list de los LENIENTES (impresora fiscal); todo lo demás, incluido
// cualquier docType futuro, es estricto por omisión — fail-CLOSED.
export const IVA_TOLERANCE_STRICT = new Decimal("0.01"); // ventas que emite ContaFlow (FACTURA/NC/ND) y toda moneda extranjera
export const IVA_TOLERANCE_PRINTED = new Decimal("1.00"); // compras y reportes de impresora fiscal, en VES: el impreso manda

// Únicos docType de VENTA con tolerancia amplia: acumulan redondeos de una impresora fiscal o de un
// resumen, no los calcula ContaFlow línea a línea.
export const LENIENT_SALE_DOC_TYPES: readonly string[] = [
  "REPORTE_Z",
  "RESUMEN_VENTAS",
  "PLANILLA_IMPORTACION",
  "OTRO",
];

/** Tolerancia por línea entre el IVA recibido y base × tasa, según ADR-049. */
export function ivaLineTolerance(opts: { type: string; docType: string; currency: string }): Decimal {
  if (opts.currency !== "VES") return IVA_TOLERANCE_STRICT;
  if (opts.type === "PURCHASE") return IVA_TOLERANCE_PRINTED; // cualquier docType: el proveedor imprime el IVA
  return LENIENT_SALE_DOC_TYPES.includes(opts.docType) ? IVA_TOLERANCE_PRINTED : IVA_TOLERANCE_STRICT;
}

/** true si el formulario debe dejar escribir el "Monto IVA" impreso en vez de calcularlo. */
export function isIvaAmountEditable(opts: { type: string; docType: string; taxType?: string }): boolean {
  // hallazgo H2 (revisión fiscal ADR-049): el IVA de una línea EXENTO es siempre 0 — no existe un
  // "IVA impreso" que editar ahí — así que este override gana sin importar type/docType.
  if (opts.taxType === "EXENTO") return false;
  if (opts.type === "PURCHASE") return true;
  return LENIENT_SALE_DOC_TYPES.includes(opts.docType);
}
