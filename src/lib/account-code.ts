// src/lib/account-code.ts
// ADR-059: fuente única de la regla "solo las cuentas de 9 dígitos reciben movimiento".
// Regla de la contadora (2026-10-04): las cuentas con menos de nueve dígitos son títulos y
// subtítulos de relleno (anticipan la clasificación) — no se pueden seleccionar en un asiento.
// Lo único que no se repite es el CÓDIGO; los nombres de títulos/subtítulos sí se repiten.

export const POSTABLE_CODE_DIGITS = 9;

/** Cantidad de dígitos del código, sin separadores (`1.1.01.01.001` → 9). */
export function countCodeDigits(code: string): number {
  return code.replace(/\D/g, "").length;
}

/** true = cuenta de movimiento (≥ 9 dígitos); false = título/subtítulo. */
export function isPostableCode(code: string): boolean {
  return countCodeDigits(code) >= POSTABLE_CODE_DIGITS;
}
