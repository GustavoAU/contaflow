// src/modules/accounting/utils/next-account-code.ts
//
// Qué código proponer al crear una cuenta de movimiento (SPEC-008, ADR-059).
//
// Una cuenta de movimiento tiene 9 dígitos (`A.B.CC.DD.EEE`) y siempre cuelga de un título
// padre de 6 dígitos (`A.B.CC.DD`). El código sugerido es `${padre}.${EEE}`, con `EEE` el primer
// valor libre de 001 a 999 entre los hijos directos de ese padre.
//
// La función es pura: no sabe de eliminadas ni de empresas. Quien la llama pasa TODAS las filas de
// la empresa (también las eliminadas: el `@@unique([companyId, code])` las cuenta, así que sugerir
// el código de una cuenta eliminada haría fallar el alta) y ya acotadas a un solo `companyId`.

const MAX_CHILDREN = 999;
const SUFFIX_DIGITS = 3;
const SUFFIX_REGEX = /^\d{3}$/;

/**
 * Siguiente código libre dentro de un título padre, o `null` si el padre ya tiene los 999 hijos.
 *
 * Solo cuentan los hijos DIRECTOS: `${parentCode}.` seguido de exactamente 3 dígitos. Un código
 * que apenas comparte prefijo de texto (`1.1.01.011.001` frente al padre `1.1.01.01`) o que está
 * mal formado (`…0010`, `…01`) no ocupa ningún valor — el `@@unique` no choca con ellos.
 * La comparación es por texto exacto, nunca por `Number(...)` (`"0010"` no es `"010"`).
 */
export function nextChildCode({
  parentCode,
  existingCodes,
}: {
  parentCode: string;
  existingCodes: readonly string[];
}): string | null {
  const prefix = `${parentCode}.`;

  const taken = new Set<string>();
  for (const code of existingCodes) {
    if (!code.startsWith(prefix)) continue;
    const suffix = code.slice(prefix.length);
    if (SUFFIX_REGEX.test(suffix)) taken.add(suffix);
  }

  for (let n = 1; n <= MAX_CHILDREN; n++) {
    const suffix = String(n).padStart(SUFFIX_DIGITS, "0");
    if (!taken.has(suffix)) return `${prefix}${suffix}`;
  }
  return null;
}
