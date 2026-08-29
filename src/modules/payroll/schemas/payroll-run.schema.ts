// src/modules/payroll/schemas/payroll-run.schema.ts
import { zMoneyPositive, zBusinessDateString } from "@/lib/zod-helpers";
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

// Duración máxima de un período de nómina, en días.
//
// Desde que el IVSS se cotiza por SEMANA (Reglamento Art. 99), el importe del
// aporte es LINEAL en la cantidad de lunes que abarca el período: estirar la
// fecha de fin multiplica la deducción del trabajador y lo que se declara al
// instituto. Antes de ese cambio el período no influía en el monto y por eso no
// hacía falta acotarlo.
//
// 35 días cubre el mes más largo con holgura y sirve para las tres frecuencias
// (SEMANAL, BIWEEKLY, MONTHLY). El Art. 100 del propio Reglamento habla de
// períodos "de cuatro (4) o cinco (5) semanas", así que nada legítimo lo pasa.
const MAX_PERIOD_DAYS = 35;

function daysBetweenInclusive(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
}

// ─── ManualConceptSchema — concepto adicional ingresado por el contador ────────
// Monto positivo fijo; el tipo (EARNING/DEDUCTION) viene del concepto en DB.
// ISLR_RET se ingresa así en NOM-C (cálculo automático es alcance NOM-D).

export const ManualConceptSchema = z.object({
  conceptId: z.string().min(1, { message: "Concepto requerido" }),
  employeeId: z.string().min(1, { message: "Empleado requerido" }),
  amount: zMoneyPositive,
  notes: z.string().max(200).optional(),
});

export type ManualConceptInput = z.infer<typeof ManualConceptSchema>;

// ─── CreatePayrollRunSchema ───────────────────────────────────────────────────

export const CreatePayrollRunSchema = z
  .object({
    periodStart: zBusinessDateString
      .regex(dateRegex, { message: "Fecha de inicio inválida" }),
    periodEnd: zBusinessDateString
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
  )
  .refine(
    (d) => daysBetweenInclusive(d.periodStart, d.periodEnd) <= MAX_PERIOD_DAYS,
    {
      message:
        `Un período de nómina no puede abarcar más de ${MAX_PERIOD_DAYS} días. ` +
        "El IVSS se cotiza por semana, así que un período más largo multiplica " +
        "las cotizaciones del trabajador.",
      path: ["periodEnd"],
    }
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
