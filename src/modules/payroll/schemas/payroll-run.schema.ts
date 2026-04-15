// src/modules/payroll/schemas/payroll-run.schema.ts
// Fase NOM-C: validación Zod para procesos de nómina
//
// Reglas de seguridad (ADR-013):
// - periodEnd max +45 días desde hoy (NOM-C-06: previene salario futuro)
// - hours: min 0, max 744 (NOM-C-05: previene horas negativas)
// - totalEarnings/totalDeductions/totalNet NO son input del cliente (calculados server-side)
// - Tasas IVSS/INCES/FAOV NO son input del cliente (constantes en PayrollCalculatorService)

import { z } from "zod";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

function maxFutureDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// ─── ManualConceptSchema — concepto adicional ingresado por el contador ────────
// Monto positivo fijo; el tipo (EARNING/DEDUCTION) viene del concepto en DB.
// ISLR_RET se ingresa así en NOM-C (cálculo automático es alcance NOM-D).

export const ManualConceptSchema = z.object({
  conceptId: z.string().min(1, { message: "Concepto requerido" }),
  employeeId: z.string().min(1, { message: "Empleado requerido" }),
  amount: z
    .string()
    .min(1, { message: "Monto requerido" })
    .refine((v) => !isNaN(Number(v)) && Number(v) > 0, { message: "Monto inválido" })
    .refine((v) => Number(v) <= 999_999_999, { message: "El monto excede el límite permitido" }),
  notes: z.string().max(200).optional(),
});

export type ManualConceptInput = z.infer<typeof ManualConceptSchema>;

// ─── CreatePayrollRunSchema ───────────────────────────────────────────────────

export const CreatePayrollRunSchema = z
  .object({
    periodStart: z
      .string()
      .regex(dateRegex, { message: "Fecha de inicio inválida" }),
    periodEnd: z
      .string()
      .regex(dateRegex, { message: "Fecha de fin inválida" })
      .refine(
        (v) => new Date(v) <= maxFutureDate(45),
        { message: "El período no puede extenderse más de 45 días en el futuro" }
      ),
    idempotencyKey: z
      .string()
      .min(1, { message: "idempotencyKey requerido" })
      .max(100),
    // employeeIds vacío = todos los empleados ACTIVE de la empresa
    employeeIds: z.array(z.string()).optional(),
    // Conceptos manuales (ISLR, bonos especiales) ingresados por el contador
    manualConcepts: z.array(ManualConceptSchema).optional(),
  })
  .refine(
    (d) => new Date(d.periodEnd) >= new Date(d.periodStart),
    { message: "La fecha de fin debe ser igual o posterior a la de inicio", path: ["periodEnd"] }
  );

export type CreatePayrollRunInput = z.infer<typeof CreatePayrollRunSchema>;

// ─── ApprovePayrollRunSchema ──────────────────────────────────────────────────

export const ApprovePayrollRunSchema = z.object({
  runId: z.string().min(1, { message: "ID de proceso requerido" }),
});

export type ApprovePayrollRunInput = z.infer<typeof ApprovePayrollRunSchema>;

// ─── CancelPayrollRunSchema ───────────────────────────────────────────────────

export const CancelPayrollRunSchema = z.object({
  runId: z.string().min(1, { message: "ID de proceso requerido" }),
  reason: z.string().min(1, { message: "Motivo de cancelación requerido" }).max(300),
});

export type CancelPayrollRunInput = z.infer<typeof CancelPayrollRunSchema>;
