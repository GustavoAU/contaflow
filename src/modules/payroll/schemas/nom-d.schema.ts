// src/modules/payroll/schemas/nom-d.schema.ts
import { zMoneyAmount, zMoneyPositive } from "@/lib/zod-helpers";
// Fase NOM-D: Schemas Zod para prestaciones, vacaciones, utilidades, liquidación
//
// Security guards (ADR-014 + ADR-006 D-3 extendido):
//   - annualRate: max 500% para hiperinflación (tasa BCV)
//   - vacationDays / bonusDays: max 90 — previene inyección de valores absurdos
//   - profitDays: min 15 max 120 según LOTTT Art. 131
//   - NO dailyWage en ningún schema de acción de transacción — siempre server-side
//   - idempotencyKey: UUID v4 formato — previene polluted keys

import { z } from "zod";

// ─── Tasa BCV ─────────────────────────────────────────────────────────────────

export const CreateBcvRateSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  annualRate: z
    .number()
    .positive({ message: "La tasa debe ser positiva" })
    .max(500, { message: "La tasa anual no puede superar el 500%" }),
  rateType: z.enum(["ACTIVA", "PROMEDIO"]).default("ACTIVA"),
});

export type CreateBcvRateInput = z.infer<typeof CreateBcvRateSchema>;

// ─── Acumulación trimestral ───────────────────────────────────────────────────

export const AccrueQuarterSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  quarter: z.number().int().min(1).max(4, { message: "El trimestre debe ser entre 1 y 4" }),
});

export type AccrueQuarterInput = z.infer<typeof AccrueQuarterSchema>;

// ─── Intereses BCV ───────────────────────────────────────────────────────────

export const PostBenefitInterestSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12, { message: "El mes debe ser entre 1 y 12" }),
  // NO rate aquí — siempre de BcvBenefitRate tabla (CRITICAL-3)
});

export type PostBenefitInterestInput = z.infer<typeof PostBenefitInterestSchema>;

// ─── Vacaciones ───────────────────────────────────────────────────────────────

export const CreateVacationSchema = z.object({
  periodYear: z.number().int().min(2000).max(2100),
  vacationDays: z
    .number()
    .positive({ message: "Los días de vacaciones deben ser positivos" })
    .max(90, { message: "Los días de vacaciones no pueden exceder 90" }),
  bonusDays: z
    .number()
    .min(0)
    .max(90, { message: "El bono vacacional no puede exceder 90 días" }),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Fecha de inicio inválida (YYYY-MM-DD)" }),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Fecha de fin inválida (YYYY-MM-DD)" }),
  isFractional: z.boolean().optional(),
}).refine((d) => new Date(d.endDate) >= new Date(d.startDate), {
  message: "La fecha de fin debe ser igual o posterior a la fecha de inicio",
  path: ["endDate"],
});

export type CreateVacationInput = z.infer<typeof CreateVacationSchema>;

// ─── Utilidades ───────────────────────────────────────────────────────────────

export const CalculateProfitSharingSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  isFractional: z.boolean().optional(),
  periodStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Fecha de inicio inválida" })
    .optional(),
  periodEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Fecha de fin inválida" })
    .optional(),
  // NO baseSalary ni profitDays — siempre de la config DB (CRITICAL-3)
  // F-07: utilidad neta + nómina anual para cálculo dinámico (LOTTT Art. 131)
  // Ambos opcionales y juntos; el servidor calcula profitDays — nunca el cliente.
  netProfitVes: z
    .string()
    .regex(/^\d+(\.\d+)?$/, { message: "Utilidad neta debe ser un número positivo" })
    .optional(),
  totalAnnualPayrollVes: z
    .string()
    .regex(/^\d+(\.\d+)?$/, { message: "Nómina anual debe ser un número positivo" })
    .optional(),
});

export type CalculateProfitSharingInput = z.infer<typeof CalculateProfitSharingSchema>;

// ─── Liquidación Final ────────────────────────────────────────────────────────

const TerminationReasonEnum = z.enum([
  "RESIGNATION",
  "DISMISSAL_JUSTIFIED",
  "DISMISSAL_UNJUSTIFIED",
  "MUTUAL_AGREEMENT",
  "CONTRACT_EXPIRY",
  "DEATH",
  "DISABILITY",
], { error: "Selecciona el motivo de egreso" });

// UUID v4 pattern para idempotencyKey
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CreateTerminationSchema = z.object({
  reason: TerminationReasonEnum,
  terminationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Fecha de egreso inválida (YYYY-MM-DD)" }),
  pendingConceptsAmount: zMoneyAmount.optional(),
  pendingConceptsNotes: z
    .string()
    .max(500, { message: "Las notas no pueden exceder 500 caracteres" })
    .optional(),
  deductionsAmount: zMoneyAmount.optional(),
  idempotencyKey: z
    .string()
    .regex(uuidV4Pattern, { message: "Clave de idempotencia inválida (debe ser UUID v4)" }),
  // NO dailyWage, NO benefitsAmount — calculados server-side
});

export type CreateTerminationInput = z.infer<typeof CreateTerminationSchema>;

export const UpdateTerminationSchema = z.object({
  pendingConceptsAmount: zMoneyAmount.optional(),
  pendingConceptsNotes: z
    .string()
    .max(500, { message: "Las notas no pueden exceder 500 caracteres" })
    .optional(),
  deductionsAmount: zMoneyAmount.optional(),
});

export type UpdateTerminationInput = z.infer<typeof UpdateTerminationSchema>;

// ─── Anticipo de Prestaciones (Art. 144 LOTTT) ────────────────────────────────

export const RegisterBenefitAdvanceSchema = z.object({
  employeeId: z.string().min(1, { message: "Selecciona un empleado" }),
  // amount como string → Decimal en el service (patrón del stack)
  amount: zMoneyPositive,
  reason: z.enum(["HOUSING", "HEALTH", "EDUCATION"], {
    error: "Selecciona un motivo válido (Vivienda, Salud o Educación)",
  }),
  notes: z.string().max(500, { message: "Las notas no pueden exceder 500 caracteres" }).optional().nullable(),
});

export type RegisterBenefitAdvanceInput = z.infer<typeof RegisterBenefitAdvanceSchema>;
