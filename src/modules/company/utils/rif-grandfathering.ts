// src/modules/company/utils/rif-grandfathering.ts
//
// Helper PURO de validación de identificador fiscal — deliberadamente FUERA de
// company.actions.ts. Vivía ahí (MP-1) y rompía el build: todo export de un módulo
// `"use server"` debe ser una función `async` ("Server Actions must be async
// functions"), y esta es sincrónica. `tsc --noEmit` y Vitest no aplican esa regla
// — solo `next build` — así que el defecto pasó el phase gate y solo apareció al
// desplegar. No mover de vuelta a un archivo con "use server".
//
// El patrón se recibe por parámetro en vez de importar `VEN_RIF_REGEX`: así este
// archivo no acopla a Venezuela y el acoplamiento sigue viviendo solo en el
// call-site (ADR-042). MP-4 lo resolverá con getFiscalConfig(ctx.country).

/**
 * Valida el identificador fiscal entrante contra el patrón canónico del país,
 * tolerando el valor legacy ya almacenado.
 *
 * Contexto: hasta MP-1 el alta de empresa usaba una regex con el dígito
 * verificador OPCIONAL, así que puede haber empresas con un `rif` que la regex
 * canónica rechaza. Bloquearlas al guardar dejaría al ADMIN sin poder editar
 * dirección, teléfono, CIIU ni `isSpecialContributor` — un lockout funcional.
 *
 * Regla: si el valor no cambia respecto al almacenado, se acepta tal cual
 * (grandfathering). Si el usuario lo CAMBIA, el nuevo valor debe cumplir el
 * formato canónico. Así ninguna empresa queda bloqueada y ningún RIF inválido
 * NUEVO entra al sistema.
 *
 * @param incoming     valor enviado por el usuario
 * @param stored       valor actualmente en BD (el legacy que se tolera)
 * @param taxIdPattern patrón canónico del país — sin flag `g` (`.test()` es
 *                     stateful con regex globales)
 * @returns mensaje de error, o null si es aceptable
 */
export function assertRifEditable(
  incoming: string | null,
  stored: string | null,
  taxIdPattern: RegExp,
): string | null {
  const next = incoming?.trim() || null;
  if (next === null) return null;              // limpiar el RIF siempre se permite
  if (next === (stored ?? null)) return null;  // sin cambios → grandfathering
  if (taxIdPattern.test(next)) return null;    // cambio válido
  return "RIF inválido (ej: J-12345678-9)";
}
