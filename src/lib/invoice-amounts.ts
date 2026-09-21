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
