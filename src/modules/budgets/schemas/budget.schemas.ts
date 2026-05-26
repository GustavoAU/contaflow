// src/modules/budgets/schemas/budget.schemas.ts
// Q3-3: Presupuestos y Proyecciones

import { z } from "zod";
import Decimal from "decimal.js";

// ── Custom validator: positive Decimal string ─────────────────────────────────
const zDecimalPositive = z
  .string()
  .trim()
  .refine((v) => {
    try {
      return new Decimal(v).gt(0);
    } catch {
      return false;
    }
  }, "El importe debe ser mayor a 0");

export const CreateBudgetSchema = z.object({
  periodYear: z
    .number()
    .int()
    .min(2000, "Año inválido")
    .max(2100, "Año inválido"),
  name: z
    .string()
    .trim()
    .min(1, "Nombre requerido")
    .max(100, "Máximo 100 caracteres")
    .default("Presupuesto Anual"),
});

export const UpdateBudgetSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Nombre requerido")
    .max(100)
    .optional(),
  status: z.enum(["DRAFT", "ACTIVE", "CLOSED"]).optional(),
});

export const UpsertBudgetLineSchema = z.object({
  accountId: z.string().min(1, "Cuenta requerida"),
  amount: zDecimalPositive,
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const DeleteBudgetLineSchema = z.object({
  accountId: z.string().cuid(),
});

export type CreateBudgetInput      = z.infer<typeof CreateBudgetSchema>;
export type UpdateBudgetInput      = z.infer<typeof UpdateBudgetSchema>;
export type UpsertBudgetLineInput  = z.infer<typeof UpsertBudgetLineSchema>;
