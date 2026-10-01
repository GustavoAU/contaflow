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
  // Feedback tester Alpha 2026-09-22: cuenta de "título" (false, columna "G/M"="G", agrupa,
  // nunca recibe un JournalEntry — ver src/lib/prisma-postable-account-gate.ts) vs cuenta de
  // detalle/movimiento (true, "M", default). Mapeado en ImportService.parseAccountsExcel.
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

// Feedback del dueño 2026-10-01: cuando el choque es de NOMBRE entre dos cuentas de
// movimiento (ADR-056), el contador debe poder corregirlo ahí mismo en la app — un
// input para renombrar y reintentar esa fila sola — en vez de obligarlo a editar el
// Excel y resubir todo el archivo. `row` viaja completo (no solo el nombre) para que
// el reintento sea exactamente `importAccounts` con esa única fila, sin reconstruir
// nada en el cliente. `reason` distingue el único caso accionable con un rename
// (duplicate_name) de los que no lo son (duplicate_code necesita otro CÓDIGO, no
// nombre; unknown no tiene causa conocida que ofrecer corregir).
export const ImportErrorReasonSchema = z.enum(["duplicate_name", "duplicate_code", "unknown"]);
export type ImportErrorReason = z.infer<typeof ImportErrorReasonSchema>;

export type ImportAccountRowError = {
  message: string;
  reason: ImportErrorReason;
  row: ImportAccountRow;
};
