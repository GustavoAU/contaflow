// src/lib/fiscal-validators.ts
// Validadores fiscales venezolanos compartidos (VEN-NIF)

/**
 * Regex canónica para RIF venezolano.
 * Prefijos: J=Jurídica, V=Natural, E=Extranjero, G=Gobierno, C=Comunal, P=Pasaporte
 * Dígito verificador obligatorio — formato: J-12345678-9 o J-123456789
 * Case-insensitive para tolerancia de entrada.
 */
export const VEN_RIF_REGEX = /^[JVEGCP]-\d{8}-?\d$/i;

export function validateVenezuelanRif(rif: string): boolean {
  return VEN_RIF_REGEX.test(rif);
}

/**
 * Techo máximo para cualquier campo de monto monetario en schemas Zod (ADR-006 D-2).
 * ~10 mil millones VES — límite razonable para una factura o transacción individual.
 * Usar: z.string().refine(v => new Decimal(v).abs().lte(MAX_INVOICE_AMOUNT))
 */
export const MAX_INVOICE_AMOUNT = "9999999999.9999";

/**
 * Regex para Nº de Control SENIAT (Providencia 0071, Art. 14).
 * Formato: XX-XXXXXXXX — 2 dígitos, guión, 8 dígitos (ej. 00-00000001)
 * Obligatorio en facturas de compra.
 */
export const CONTROL_NUMBER_REGEX = /^\d{2}-\d{8}$/;
