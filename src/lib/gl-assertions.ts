// src/lib/gl-assertions.ts
// N4: invariante central de partida doble.
// Cada tx.transaction.create DEBE llamar assertBalancedGLEntries antes de persistir.
import { Decimal } from "decimal.js";

/**
 * Lanza un error si las entradas GL no suman cero dentro de la tolerancia.
 * Convención de signos: DEBE (positivo) + HABER (negativo) = 0.
 *
 * @param entries  Arreglo de entradas con campo `amount` (Decimal, positivo o negativo).
 * @param tolerance Tolerancia máxima de desvío (default 0.01 Bs.).
 * @throws Error si |Σ(amount)| > tolerance — asiento descuadrado.
 */
export function assertBalancedGLEntries(
  entries: { amount: Decimal }[],
  tolerance = new Decimal("0.01"),
): void {
  const sum = entries.reduce((acc, e) => acc.plus(e.amount), new Decimal(0));
  if (sum.abs().greaterThan(tolerance)) {
    throw new Error(
      `Asiento GL descuadrado: Σ = ${sum.toFixed(4)} (tolerancia ±${tolerance}). Revisa las entradas antes de persistir.`,
    );
  }
}
