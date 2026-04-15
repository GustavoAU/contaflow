// src/modules/payroll/schemas/payroll-concept.schema.ts
// Fase NOM-B: validación Zod para conceptos de nómina

import { z } from "zod";

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
});

export type CreateConceptInput = z.infer<typeof CreateConceptSchema>;

export const UpdateConceptSchema = z.object({
  name: z.string().min(1, { message: "El nombre es requerido" }).max(100),
  isActive: z.boolean(),
});

export type UpdateConceptInput = z.infer<typeof UpdateConceptSchema>;
