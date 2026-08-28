// src/modules/payroll/schemas/payroll-concept.schema.ts
// Fase NOM-B: validación Zod para conceptos de nómina

import { z } from "zod";

// ADR-045 D-1/D-2: la naturaleza salarial decide si el concepto entra en la base
// de cotizaciones parafiscales. La declara la empresa, no la adivina el sistema.
const salaryNatureSchema = z.enum(
  ["NO_SALARIAL", "SALARIO_NORMAL", "SALARIAL_ACCIDENTAL"],
  { error: "Indica si el concepto tiene incidencia salarial" },
);

// Código de concepto: solo letras mayúsculas, dígitos y guión bajo, 2–20 chars
const codeSchema = z
  .string()
  .min(2, { message: "El código debe tener al menos 2 caracteres" })
  .max(20, { message: "El código no puede superar 20 caracteres" })
  .regex(/^[A-Z0-9_]+$/, { message: "Código: solo mayúsculas, dígitos y guión bajo" });

export const CreateConceptSchema = z.object({
  code: codeSchema,
  name: z.string().min(1, { message: "El nombre es requerido" }).max(100),
  type: z.enum(["EARNING", "DEDUCTION"], {
    error: "Selecciona el tipo (Asignación o Deducción)",
  }),
  // Opcional: si no se declara, NO_SALARIAL — no se mete en la base de
  // cotizaciones un concepto cuya naturaleza nadie afirmó.
  salaryNature: salaryNatureSchema.optional(),
});

export type CreateConceptInput = z.infer<typeof CreateConceptSchema>;

export const UpdateConceptSchema = z.object({
  name: z.string().min(1, { message: "El nombre es requerido" }).max(100),
  isActive: z.boolean(),
  // Reclasificar es la unica via para sacar de la base un concepto que no
  // deberia estar. Solo aplica a conceptos propios: los del sistema los fija la
  // ley y seedDefaults los repara en cada corrida.
  salaryNature: salaryNatureSchema.optional(),
});

export type UpdateConceptInput = z.infer<typeof UpdateConceptSchema>;
