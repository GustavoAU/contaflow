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

// ─── SPEC-008: forma exacta de una cuenta de movimiento y su título padre ─────────────────────────
// Estructura de niveles 1 / 1 / 2 / 2 / 3 dígitos (`A.B.CC.DD.EEE`), la misma en todos los planes
// (decisión del dueño, 2026-10-05). El padre de una cuenta de movimiento es el código sin el último
// segmento (`A.B.CC.DD`, 6 dígitos). Sin flags g/y: `.test()` repetido no arrastra `lastIndex`.

/** Forma exacta de una cuenta de movimiento (RN-1): 1+1+2+2+3 dígitos separados por puntos. */
export const MOVEMENT_CODE_REGEX = /^\d\.\d\.\d{2}\.\d{2}\.\d{3}$/;

/** Dígitos de un título que puede ser padre de una cuenta de movimiento (RN-2). */
const PARENT_TITLE_DIGITS = 6;

/**
 * Código del título padre de una cuenta de movimiento: el código sin el último segmento
 * (`1.1.01.01.001` → `1.1.01.01`). `null` si el código no cumple `MOVEMENT_CODE_REGEX`.
 */
export function parentCodeOf(movementCode: string): string | null {
  if (!MOVEMENT_CODE_REGEX.test(movementCode)) return null;
  return movementCode.slice(0, movementCode.lastIndexOf("."));
}

/** true = el código tiene exactamente 6 dígitos (sin contar separadores): puede ser título padre. */
export function isTitleParentCode(code: string): boolean {
  return countCodeDigits(code) === PARENT_TITLE_DIGITS;
}
