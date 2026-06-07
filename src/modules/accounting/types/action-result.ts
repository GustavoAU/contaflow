// src/modules/accounting/types/action-result.ts
//
// Tipo de respuesta estándar para todas las Server Actions del módulo accounting.
//
// Diseño:
//   - Los campos opcionales (warning, fieldErrors) permiten que cada action
//     use solo lo que necesita sin redefinir el tipo.
//   - El discriminante `success` habilita el type narrowing en los consumidores:
//       if (!result.success) { result.error ... }  ← TypeScript sabe que `data` no existe aquí
//       if (result.success)  { result.data  ... }  ← TypeScript sabe que `error` no existe aquí

export type ActionResult<T> =
  | {
      success: true;
      data: T;
      // Mensaje de advertencia opcional (ej: "El código está fuera del rango estándar VEN-NIF")
      // Se muestra al usuario pero no bloquea la operación.
      warning?: string;
    }
  | {
      success: false;
      // Mensaje de error legible para el usuario (nunca errores técnicos de BD/Prisma)
      error: string;
      // Errores de validación por campo, mapeados desde ZodError.
      // Clave: nombre del campo (dot notation para campos anidados, ej: "entries.0.amount")
      // Valor: lista de mensajes de error para ese campo
      fieldErrors?: Record<string, string[]>;
    };
