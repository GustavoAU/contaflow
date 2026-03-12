// src/modules/import/schemas/import.schema.ts
import { z } from "zod";

export const ImportAccountRowSchema = z.object({
  codigo: z.string().min(1, "El código es obligatorio"),
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  tipo: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"], {
    error: "Tipo debe ser: ASSET, LIABILITY, EQUITY, REVENUE o EXPENSE",
  }),

  descripcion: z.string().optional(),
});

export type ImportAccountRow = z.infer<typeof ImportAccountRowSchema>;

export const ImportAccountsSchema = z.array(ImportAccountRowSchema).min(1, "El archivo está vacío");
export type ImportAccountsData = z.infer<typeof ImportAccountsSchema>;
