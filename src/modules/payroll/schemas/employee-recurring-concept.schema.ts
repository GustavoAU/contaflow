// src/modules/payroll/schemas/employee-recurring-concept.schema.ts
//
// Asignaciones y deducciones FIJAS de un trabajador, con vigencia.
//
// El caso que las motiva es el pago en divisas: en Venezuela lo corriente es
// pagar el salario en bolívares —que es la base de las cotizaciones y lo que se
// declara— y entregar el resto en dólares como bonificación no salarial.

import { z } from "zod";
import { zBusinessDateString, zMoneyPositive } from "@/lib/zod-helpers";

export const RECURRING_CURRENCIES = ["VES", "USD"] as const;

export const CreateRecurringConceptSchema = z
  .object({
    employeeId: z.string().min(1, { error: "Trabajador requerido" }),
    conceptId: z.string().min(1, { error: "Concepto requerido" }),
    amount: zMoneyPositive,
    // MIXED queda fuera a propósito: un importe único que no dice cuánto va en
    // cada moneda no se puede ni convertir ni contabilizar. Es la misma razón
    // por la que el calculador lo bloquea en el sueldo.
    currency: z.enum(RECURRING_CURRENCIES, { error: "Moneda inválida" }),
    effectiveFrom: zBusinessDateString,
    effectiveTo: zBusinessDateString.optional(),
    notes: z.string().max(300).optional(),
  })
  .refine(
    (d) => !d.effectiveTo || d.effectiveTo >= d.effectiveFrom,
    {
      error: "La fecha de fin no puede ser anterior a la de inicio",
      path: ["effectiveTo"],
    },
  );

export type CreateRecurringConceptInput = z.infer<typeof CreateRecurringConceptSchema>;

// Cerrar una asignación vigente en vez de borrarla: el histórico explica por qué
// una nómina de hace tres meses tiene una línea que hoy ya no aparece.
export const EndRecurringConceptSchema = z.object({
  id: z.string().min(1, { error: "Asignación requerida" }),
  effectiveTo: zBusinessDateString,
});

export type EndRecurringConceptInput = z.infer<typeof EndRecurringConceptSchema>;
