// src/lib/action-errors.ts
// Sanitizador canónico de errores para Server Actions (ADR-041).
//
// Errores de negocio (español) pasan tal cual; errores técnicos de BD/Postgres/infra
// (p.ej. "permission denied for schema public", cuota Neon) → mensaje genérico en
// español vía mapPrismaError. Antes vivía copiado en 32 módulos; esas copias son
// re-exports de este archivo. Excepciones con variante local: `accounting` y
// `billing` (agregan rama ZodError con comportamientos distintos entre sí).
import { mapPrismaError } from "@/lib/prisma-errors";
import type { ActionResult } from "@/lib/action-result";

export function toActionError(error: unknown): ActionResult<never> {
  return { success: false, error: mapPrismaError(error) };
}
