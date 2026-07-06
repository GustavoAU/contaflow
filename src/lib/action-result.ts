// src/lib/action-result.ts
// Tipo de retorno canónico de TODAS las Server Actions (ADR-041).
//
// Antes vivía copiado en 32 módulos (src/modules/*/types/action-result.ts);
// esas copias son ahora re-exports de este archivo. Excepción: `accounting`
// mantiene su variante local (agrega `warning?` y `fieldErrors?` opcionales).
export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };
