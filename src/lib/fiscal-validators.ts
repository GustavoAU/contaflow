// src/lib/fiscal-validators.ts
// Q3-5: Actualizado para importar desde tax-config.ts (fuente de verdad).
// Mantiene los mismos exports para compatibilidad con código existente.

export {
  VEN_RIF_REGEX,
  VEN_CONTROL_NUMBER_REGEX as CONTROL_NUMBER_REGEX,
} from "./tax-config";

// Re-export VEN_RIF_REGEX también bajo el nombre corto que usan algunos módulos
import { VEN_RIF_REGEX } from "./tax-config";

/**
 * Valida un RIF venezolano.
 * @deprecated Importar desde tax-config: getFiscalConfig(country).taxIdRegex
 */
export function validateVenezuelanRif(rif: string): boolean {
  return VEN_RIF_REGEX.test(rif);
}

/**
 * Techo máximo para cualquier campo de monto monetario en schemas Zod (ADR-006 D-2).
 * ~10 mil millones VES — límite razonable para una factura o transacción individual.
 * Usar: z.string().refine(v => new Decimal(v).abs().lte(MAX_INVOICE_AMOUNT))
 */
export const MAX_INVOICE_AMOUNT = "9999999999.9999";
