// src/lib/gl-assertions.ts
// N4: invariante central de partida doble.
// Cada tx.transaction.create DEBE llamar assertBalancedGLEntries antes de persistir.
import { Decimal } from "decimal.js";

/**
 * Lanza un error si las entradas GL no suman cero dentro de la tolerancia.
 * Convención de signos: DEBE (positivo) + HABER (negativo) = 0.
 *
 * @param entries  Arreglo de entradas con campo `amount` (Decimal, positivo o negativo).
 * @param tolerance Tolerancia máxima de desvío. Por defecto 0: CUADRE EXACTO (ADR-058, decisión de la
 *   contadora 2026-10-03: "todo, hasta en los decimales"). Los servicios cuantizan con
 *   `quantizeGLEntries` ANTES de verificar, así que lo que se verifica es lo que se guarda.
 * @throws Error si |Σ(amount)| > tolerance — asiento descuadrado.
 */
export function assertBalancedGLEntries(
  entries: { amount: Decimal }[],
  tolerance = new Decimal(0)
): void {
  const sum = entries.reduce((acc, e) => acc.plus(e.amount), new Decimal(0));
  if (sum.abs().greaterThan(tolerance)) {
    throw new Error(
      `Asiento GL descuadrado: Σ = ${sum.toFixed(4)} (tolerancia ±${tolerance}). Revisa las entradas antes de persistir.`
    );
  }
}

export type GLEntryLike = { amount: Decimal; noAbsorb?: boolean };

const CENT = new Decimal("0.01");
const HALF_CENT = new Decimal("0.005");

/**
 * ADR-058 — Cuantiza al céntimo (2 decimales) las líneas de un asiento y absorbe el residuo.
 *
 * POR QUÉ: los servicios calculan en precisión alta (Decimal.js ~20 dígitos), multiplican por la
 * tasa BCV y verifican el cuadre SIN redondear; luego Postgres redondea CADA línea por separado a
 * Decimal(19,4) y lo guardado deja de sumar 0 (caso real: nómina USD, tasa 779,9522, 11 líneas,
 * Σ = −0,0001). Aquí se redondea ANTES de verificar y de persistir, de modo que lo que se verifica
 * es exactamente lo que se guarda.
 *
 * Modos:
 *  - "absorb" (defecto): cada monto a 2 decimales con ROUND_HALF_UP (mitad alejándose de cero,
 *    simétrico en Dr/Cr), descarta las líneas que quedan en 0,00 y suma el residuo a la línea de
 *    MAYOR valor absoluto que no sea `noAbsorb` (empate: la primera). Devuelve el residuo y el
 *    índice (en la salida) para dejarlos en el AuditLog del asiento.
 *  - "exact": NO redondea ni absorbe. Obligatorio para asientos derivados de lo ya guardado
 *    (anulaciones, cierre de ejercicio, liquidación de caja): negar un asiento histórico a 4
 *    decimales debe ser su espejo exacto (ADR-005).
 *  - expectBalanced:false: redondea y descarta ceros pero no absorbe ni exige Σ = 0 (asientos
 *    incompletos a propósito). SIN llamadores en producción desde la SPEC-007: ya no existe ningún
 *    asiento incompleto (toda ENTRADA de inventario lleva contrapartida). Solo la usan los tests.
 *
 * Nunca muta la entrada. Es idempotente sobre montos ya cuantizados.
 */
export function quantizeGLEntries<T extends GLEntryLike>(
  entries: T[],
  opts?: { mode?: "absorb" | "exact"; expectBalanced?: boolean }
): { entries: T[]; residual: Decimal; absorbedIndex: number | null } {
  const mode = opts?.mode ?? "absorb";
  const expectBalanced = opts?.expectBalanced ?? true;
  const sum = (list: { amount: Decimal }[]) =>
    list.reduce((acc, e) => acc.plus(e.amount), new Decimal(0));

  if (entries.length === 0) {
    return { entries: [], residual: new Decimal(0), absorbedIndex: null };
  }

  if (mode === "exact") {
    return { entries: [...entries], residual: sum(entries), absorbedIndex: null };
  }

  // Máximo que puede desviar redondear N líneas al céntimo: N × 0,005.
  const maxDrift = HALF_CENT.mul(entries.length);

  // 1) Si el conjunto de entrada no es un asiento balanceado, la diferencia no es redondeo.
  if (expectBalanced) {
    const rawSum = sum(entries);
    if (rawSum.abs().greaterThan(maxDrift)) {
      throw new Error(
        `Asiento GL descuadrado: Σ bruta = ${rawSum.toFixed(4)} supera el máximo atribuible a redondeo (±${maxDrift.toFixed(4)}). No se absorbe: revisa el cálculo.`
      );
    }
  }

  // 2) Redondeo por línea y descarte de las que quedan en 0,00.
  const rounded = entries
    .map((e) => ({ ...e, amount: e.amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP) }))
    .filter((e) => !e.amount.isZero());
  const residual = sum(rounded);

  if (!expectBalanced || residual.isZero()) {
    return { entries: rounded, residual, absorbedIndex: null };
  }

  // 3) El residuo de redondear no puede superar N × 0,005.
  if (residual.abs().greaterThan(maxDrift)) {
    throw new Error(
      `Error de cálculo: el residuo de redondeo ${residual.toFixed(2)} supera el máximo ±${maxDrift.toFixed(4)} para ${entries.length} líneas: error de cálculo, no se absorbe.`
    );
  }

  // 4) Absorber en la línea de mayor |monto| que no sea noAbsorb (empate: la primera).
  let absorbedIndex: number | null = null;
  rounded.forEach((e, i) => {
    if (e.noAbsorb) return;
    if (absorbedIndex === null || e.amount.abs().greaterThan(rounded[absorbedIndex].amount.abs())) {
      absorbedIndex = i;
    }
  });
  if (absorbedIndex === null) {
    throw new Error(
      "Residuo de redondeo sin línea donde absorber: todas las líneas están marcadas noAbsorb (obligaciones fiscales o terceros)."
    );
  }
  const before = rounded[absorbedIndex].amount;
  const after = before.minus(residual);
  // Hallazgo de seguridad LOW-2: si la línea que absorbe es pequeña frente al residuo, quedaría en
  // 0,00 (línea que el propio filtro descarta) o cambiaría de Dr a Cr. Eso ya no es redondeo.
  if (after.isZero() || after.isNegative() !== before.isNegative()) {
    throw new Error(
      `Error de cálculo: absorber el residuo ${residual.toFixed(2)} dejaría la línea ${absorbedIndex} (${before.toFixed(2)}) en ${after.toFixed(2)}; no se absorbe.`
    );
  }
  rounded[absorbedIndex] = { ...rounded[absorbedIndex], amount: after };

  return { entries: rounded, residual, absorbedIndex };
}
