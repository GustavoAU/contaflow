// src/modules/import/schemas/import.schema.ts
import { z } from "zod";

export const ImportAccountRowSchema = z.object({
  codigo: z.string().min(1, "El código es obligatorio"),
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  tipo: z.enum(["ASSET", "CONTRA_ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"], {
    // El valor real sigue en inglés (nombre del enum en BD) — ImportService.normalizeAccountRows
    // ya traduce "Activo"/"Pasivo"/etc antes de llegar aquí (TIPO_ES_TO_EN). Este mensaje es lo
    // que ve un contador si aun así no matchea nada, así que va en español.
    error: "Tipo debe ser: Activo, Contra-activo, Pasivo, Patrimonio, Ingreso o Gasto",
  }),

  descripcion: z.string().optional(),
  // ADR-059: informativo — el servidor SIEMPRE lo deriva del código (≥ 9 dígitos = movimiento,
  // menos = título/subtítulo; src/lib/account-code.ts) e ignora este valor. Ver ImportService.
  isPostable: z.boolean().default(true),
  // Feedback tester Alpha 2026-09-26: columna "Pre." — si la cuenta se puede usar en líneas de
  // presupuesto (BudgetLine). Sin consecuencia fiscal, solo filtrado/UX.
  isBudgetable: z.boolean().default(false),
  // Decisión del dueño 2026-09-26 (ADR-054): columna "Ter." — cuenta "pote" que exige indicar
  // el tercero (Customer/Vendor/Partner/Employee) en cada línea de asiento. Exigido por
  // src/lib/prisma-tercero-required-gate.ts.
  requiresThirdParty: z.boolean().default(false),
});

export type ImportAccountRow = z.infer<typeof ImportAccountRowSchema>;

export const ImportAccountsSchema = z.array(ImportAccountRowSchema).min(1, "El archivo está vacío");
export type ImportAccountsData = z.infer<typeof ImportAccountsSchema>;

// ADR-059: el nombre ya no es único, así que el único choque posible es de CÓDIGO.
// SPEC-008 RN-11: `missing_parent` = una cuenta de movimiento cuyo título padre (6 dígitos) no existe
// ni en la base ni en el archivo. `unknown` cubre cualquier otro fallo de esa fila (código mal formado,
// tipo incompatible con el título, error de BD). `row` viaja completo en el error.
export const ImportErrorReasonSchema = z.enum(["duplicate_code", "missing_parent", "unknown"]);
export type ImportErrorReason = z.infer<typeof ImportErrorReasonSchema>;

export type ImportAccountRowError = {
  message: string;
  reason: ImportErrorReason;
  row: ImportAccountRow;
};
