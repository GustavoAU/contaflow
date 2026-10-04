// src/modules/bank-reconciliation/services/statement-balance.ts
// Cuadre de un extracto: saldo inicial + créditos − débitos = saldo final declarado.
// Todo con Decimal (R-5) y con el MISMO parseo de montos que usa el servidor al importar
// (`parseAmount`), para que el aviso del cliente coincida con lo que se calculará después.
import { Decimal } from "decimal.js";

import { parseAmount } from "./CsvParserService";

/** Tolerancia de redondeo entre el saldo calculado y el declarado (Bs.). */
const BALANCE_TOLERANCE = new Decimal("0.02");

type StatementLine = { debit: string | null; credit: string | null };

function safeParse(raw: string | null): Decimal | null {
  if (raw === null) return null;
  try {
    return parseAmount(raw);
  } catch {
    return null;
  }
}

/**
 * Devuelve `{ computed, declared }` si el extracto NO cuadra, o `null` si cuadra o si no
 * hay datos suficientes para comprobarlo (sin filas o saldos ausentes/ilegibles).
 * Un monto ilegible en una fila cuenta como 0, igual que antes.
 */
export function findStatementBalanceMismatch(
  rows: StatementLine[],
  openingBalance: string | null,
  closingBalance: string | null
): { computed: Decimal; declared: Decimal } | null {
  const opening = safeParse(openingBalance ?? "0");
  const declared = safeParse(closingBalance ?? "0");
  if (!opening || !declared || rows.length === 0) return null;

  let computed = opening;
  for (const r of rows) {
    computed = computed.plus(safeParse(r.credit) ?? 0).minus(safeParse(r.debit) ?? 0);
  }

  return computed.minus(declared).abs().gt(BALANCE_TOLERANCE) ? { computed, declared } : null;
}
