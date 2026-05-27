// src/modules/fixed-assets/services/FixedAssetINPCService.ts
//
// FC-01: Reexpresión de Activos Fijos por INPC (Art. 173 ISLR)
// Pure functions — sin side effects, 100% testables.

import { Decimal } from "decimal.js";

export type InpcRateSimple = {
  year:       number;
  month:      number;
  indexValue: string; // serializado como string (Decimal → string en boundary Server→Client)
};

export type AssetRestatement = {
  factor:           string;   // INPC_actual / INPC_adquisicion, 4 decimales
  reexpressedValue: string;   // costo × factor, 2 decimales
  adjustment:       string;   // reexpressedValue − costo, 2 decimales (puede ser 0)
  currentPeriod:    string;   // "YYYY/MM" del índice más reciente cargado
  acqRateMissing:   boolean;  // true si falta el índice del mes de adquisición
};

/**
 * Construye un Map de "YYYY-M" → indexValue para búsqueda O(1).
 */
export function buildInpcMap(rates: InpcRateSimple[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rates) {
    m.set(`${r.year}-${r.month}`, r.indexValue);
  }
  return m;
}

/**
 * Calcula la reexpresión INPC de un activo.
 *
 * @param acquisitionDate  fecha de adquisición del activo
 * @param acquisitionCost  costo histórico como string (Decimal serializado)
 * @param inpcMap          resultado de buildInpcMap()
 * @param latestRate       tasa INPC más reciente disponible (o null si no hay ninguna)
 * @returns restatement con factor, valor reexpresado y ajuste; o null si no hay tasas cargadas
 */
export function computeAssetRestatement(
  acquisitionDate: Date,
  acquisitionCost: string,
  inpcMap: Map<string, string>,
  latestRate: InpcRateSimple | null,
): AssetRestatement | null {
  if (!latestRate) return null;

  const acqDate  = new Date(acquisitionDate);
  const acqYear  = acqDate.getUTCFullYear();
  const acqMonth = acqDate.getUTCMonth() + 1;

  const currentPeriod = `${latestRate.year}/${String(latestRate.month).padStart(2, "0")}`;
  const acqRateStr    = inpcMap.get(`${acqYear}-${acqMonth}`);

  // Si falta el índice del mes de adquisición no podemos calcular el factor
  if (!acqRateStr) {
    return {
      factor:           "—",
      reexpressedValue: "—",
      adjustment:       "—",
      currentPeriod,
      acqRateMissing:   true,
    };
  }

  const acqIndex     = new Decimal(acqRateStr);
  const currentIndex = new Decimal(latestRate.indexValue);
  const cost         = new Decimal(acquisitionCost);
  const factor       = currentIndex.dividedBy(acqIndex).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
  const reexpressed  = cost.times(factor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const adjustment   = reexpressed.minus(cost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    factor:           factor.toFixed(4),
    reexpressedValue: reexpressed.toFixed(2),
    adjustment:       adjustment.toFixed(2),
    currentPeriod,
    acqRateMissing:   false,
  };
}
