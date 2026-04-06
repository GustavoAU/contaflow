// src/modules/fiscal-close/schemas/fiscal-close.schema.ts
import { z } from "zod";

export const CloseFiscalYearSchema = z.object({
  companyId: z.string().min(1, { error: "companyId es requerido" }),
  year: z
    .number()
    .int()
    .min(2000, { error: "Año inválido" })
    .max(2100, { error: "Año inválido" }),
  closedBy: z.string().min(1, { error: "userId es requerido" }),
});

export const AppropriateResultSchema = z.object({
  companyId: z.string().min(1, { error: "companyId es requerido" }),
  year: z
    .number()
    .int()
    .min(2000, { error: "Año inválido" })
    .max(2100, { error: "Año inválido" }),
  approvedBy: z.string().min(1, { error: "userId es requerido" }),
});

export const UpdateFiscalConfigSchema = z.object({
  companyId: z.string().min(1, { error: "companyId es requerido" }),
  resultAccountId: z.string().min(1, { error: "Cuenta Resultado del Ejercicio es requerida" }),
  retainedEarningsAccountId: z.string().min(1, { error: "Cuenta Utilidades Retenidas es requerida" }),
});

export type CloseFiscalYearInput = z.infer<typeof CloseFiscalYearSchema>;
export type AppropriateResultInput = z.infer<typeof AppropriateResultSchema>;
export type UpdateFiscalConfigInput = z.infer<typeof UpdateFiscalConfigSchema>;
