// src/modules/fixed-assets/services/disposal-preview.ts
// Helpers puros (client-safe, sin Prisma) para el preview de DisposeAssetModal.
// R-5: Decimal.js — nunca float para dinero.
//
// Las fórmulas replican EXACTAMENTE FixedAssetDepreciationService.disposeAsset:
// un solo redondeo final ROUND_HALF_UP a 2 decimales. El preview del modal no
// puede divergir del asiento que genera el server (el doble redondeo anterior
// del cliente producía diferencias de un céntimo: p.ej. costo 75.35, 27 meses
// → cliente 3.02 vs server 3.01).

import Decimal from "decimal.js";
import { VEN_TAX_RATES } from "@/lib/tax-config";

/** Art. 66 LIVA — período de reintegro del crédito fiscal (meses) */
export const ART66_MONTHS = 36;

const IVA_GENERAL_RATE = new Decimal(VEN_TAX_RATES.ivaGeneral);

export const ZERO = new Decimal(0);

/**
 * Parsea un monto de input de usuario a Decimal.
 * Equivalente seguro de `parseFloat(v) || 0`: inválido/vacío → 0.
 */
export function parseMoney(value: string | null | undefined): Decimal {
  if (!value) return ZERO;
  try {
    const d = new Decimal(value.trim());
    return d.isFinite() ? d : ZERO;
  } catch {
    return ZERO;
  }
}

/**
 * Meses calendario entre adquisición y baja (misma fórmula que el server:
 * diferencia año×12 + mes, sin días, mínimo 0).
 */
export function monthsBetween(acquisitionDate: Date, disposalDate: Date): number {
  return Math.max(
    0,
    (disposalDate.getFullYear() - acquisitionDate.getFullYear()) * 12 +
      (disposalDate.getMonth() - acquisitionDate.getMonth()),
  );
}

/**
 * IVA Débito Fiscal en venta de activo (Art. 3 LIVA / FA-3).
 * Server: proceeds × 16% → 2dp ROUND_HALF_UP.
 */
export function calcSaleIva(proceeds: Decimal): Decimal {
  return proceeds.times(IVA_GENERAL_RATE).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Reintegro IVA Crédito Fiscal por baja anticipada (Art. 66 LIVA).
 * Server: costo × 16% × (36 − mesesUso)/36 → 2dp ROUND_HALF_UP (UN solo redondeo).
 * mesesUso >= 36 → 0 (no aplica reintegro).
 */
export function calcArt66Reintegro(cost: Decimal, monthsUsed: number): Decimal {
  if (monthsUsed >= ART66_MONTHS) return ZERO;
  return cost
    .times(IVA_GENERAL_RATE)
    .times(new Decimal(ART66_MONTHS - monthsUsed).dividedBy(new Decimal(ART66_MONTHS)))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
