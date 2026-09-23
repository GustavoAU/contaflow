// src/modules/import/schemas/import.schema.ts
import { z } from "zod";

export const ImportAccountRowSchema = z.object({
  codigo: z.string().min(1, "El código es obligatorio"),
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  tipo: z.enum(["ASSET", "CONTRA_ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"], {
    error: "Tipo debe ser: ASSET, CONTRA_ASSET, LIABILITY, EQUITY, REVENUE o EXPENSE",
  }),

  descripcion: z.string().optional(),
  // Feedback tester Alpha 2026-09-22: cuenta de "título" (false, columna "G/M"="G", agrupa,
  // nunca recibe un JournalEntry — ver src/lib/prisma-postable-account-gate.ts) vs cuenta de
  // detalle/movimiento (true, "M", default). Mapeado en ImportService.parseAccountsExcel.
  isPostable: z.boolean().default(true),
});

export type ImportAccountRow = z.infer<typeof ImportAccountRowSchema>;

export const ImportAccountsSchema = z.array(ImportAccountRowSchema).min(1, "El archivo está vacío");
export type ImportAccountsData = z.infer<typeof ImportAccountsSchema>;
