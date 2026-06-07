// src/modules/accounting/utils/action-errors.ts
//
// Convierte errores capturados en catch blocks al formato de respuesta estándar
// de las Server Actions del módulo.
//
// Centralizar esta lógica evita copiar el mismo bloque if/ZodError en cada catch.
// Si en el futuro necesitamos cambiar cómo se formatea un ZodError (p.ej. para i18n),
// hay un solo lugar para hacerlo.

import { z } from "zod";
import { mapPrismaError } from "@/lib/prisma-errors";
import type { ActionResult } from "../types/action-result";

// Convierte un error desconocido al formato de falla de ActionResult.
//
// Casos que maneja:
//   - ZodError → desglosa los errores por campo para mostrarlos en el formulario
//   - Cualquier otro error → usa mapPrismaError para convertirlo en mensaje legible
//
// El tipo de retorno es ActionResult<never> porque la rama de éxito nunca aplica
// aquí, pero es compatible con ActionResult<T> para cualquier T.
export function toActionError(error: unknown): ActionResult<never> {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string[]> = {};

    for (const issue of error.issues) {
      // Convertir el path del issue a string con notación punto (ej: "entries.0.amount")
      const fieldPath = issue.path.join(".");
      if (!fieldErrors[fieldPath]) fieldErrors[fieldPath] = [];
      fieldErrors[fieldPath].push(issue.message);
    }

    return { success: false, error: "Datos inválidos", fieldErrors };
  }

  return { success: false, error: mapPrismaError(error) };
}
