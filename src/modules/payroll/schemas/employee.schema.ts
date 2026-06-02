// src/modules/payroll/schemas/employee.schema.ts
// Fase NOM-B: validación Zod para creación y edición de empleados

import { z } from "zod";
import { zMoneyPositive } from "@/lib/zod-helpers";

// Cédula venezolana: "V" | "E" (venezolano / extranjero)
const cedulaTypeEnum = z.enum(["V", "E"], {
  error: "Tipo de cédula debe ser V o E",
});

// Solo dígitos, 6–9 caracteres
const cedulaNumberSchema = z
  .string()
  .regex(/^\d{6,9}$/, { message: "Número de cédula inválido (6–9 dígitos)" });

export const CreateEmployeeSchema = z.object({
  firstName: z.string().min(1, { message: "El nombre es requerido" }).max(100),
  lastName: z.string().min(1, { message: "El apellido es requerido" }).max(100),
  cedulaType: cedulaTypeEnum,
  cedulaNumber: cedulaNumberSchema,
  contractType: z.enum(["INDEFINIDO", "DETERMINADO", "OBRA_DETERMINADA"], {
    error: "Selecciona el tipo de contrato",
  }),
  employeeRegime: z.enum(["POST_2012", "MIXED"], {
    error: "Selecciona el régimen LOTTT",
  }),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Fecha de ingreso inválida" }),
  position: z.string().min(1, { message: "El cargo es requerido" }).max(150),
  department: z.string().max(100).optional(),
  email: z.string().email({ message: "Email inválido" }).optional().or(z.literal("")),
  phone: z.string().max(20).optional(),
  bankName: z.string().max(100).optional(),
  bankAccount: z.string().max(30).optional(),
  costCenter: z.string().max(100).optional(),
  initialSalaryAmount: zMoneyPositive.optional(),
  initialSalaryCurrency: z.enum(["VES", "USD", "MIXED"]).optional(),
  // F-01: campos parafiscales
  ivssNumber: z.string().max(20).optional(),
  banavihNumber: z.string().max(20).optional(),
  dependents: z.coerce.number().int().min(0).max(20).optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  workSchedule: z.enum(["DIURNA", "NOCTURNA", "MIXTA"]).optional(),
  // F-02: clasificación LOTTT + estado civil (auditoria 2026-06-02)
  maritalStatus: z.enum(["SOLTERO", "CASADO", "DIVORCIADO", "VIUDO", "UNION_ESTABLE"]).optional(),
  payrollWorkerType: z.enum(["OBRERO", "EMPLEADO"]).optional(),
  contractEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  useFideicomiso: z.boolean().optional(),
});

export type CreateEmployeeInput = z.infer<typeof CreateEmployeeSchema>;

export const UpdateEmployeeSchema = z.object({
  firstName: z.string().min(1, { message: "El nombre es requerido" }).max(100),
  lastName: z.string().min(1, { message: "El apellido es requerido" }).max(100),
  contractType: z.enum(["INDEFINIDO", "DETERMINADO", "OBRA_DETERMINADA"], {
    error: "Selecciona el tipo de contrato",
  }),
  employeeRegime: z.enum(["POST_2012", "MIXED"], {
    error: "Selecciona el régimen LOTTT",
  }),
  position: z.string().min(1, { message: "El cargo es requerido" }).max(150),
  department: z.string().max(100).optional(),
  email: z.string().email({ message: "Email inválido" }).optional().or(z.literal("")),
  phone: z.string().max(20).optional(),
  bankName: z.string().max(100).optional(),
  bankAccount: z.string().max(30).optional(),
  costCenter: z.string().max(100).optional(),
  // F-01: campos parafiscales
  ivssNumber: z.string().max(20).optional(),
  banavihNumber: z.string().max(20).optional(),
  dependents: z.coerce.number().int().min(0).max(20).optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  workSchedule: z.enum(["DIURNA", "NOCTURNA", "MIXTA"]).optional(),
  // F-02: clasificación LOTTT + estado civil
  maritalStatus: z.enum(["SOLTERO", "CASADO", "DIVORCIADO", "VIUDO", "UNION_ESTABLE"]).optional(),
  payrollWorkerType: z.enum(["OBRERO", "EMPLEADO"]).optional(),
  contractEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  useFideicomiso: z.boolean().optional(),
});

export type UpdateEmployeeInput = z.infer<typeof UpdateEmployeeSchema>;

export const TerminateEmployeeSchema = z.object({
  terminationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Fecha de egreso inválida" }),
});

export type TerminateEmployeeInput = z.infer<typeof TerminateEmployeeSchema>;

export const AddSalarySchema = z.object({
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Fecha de vigencia inválida" }),
  amount: zMoneyPositive,
  currency: z.enum(["VES", "USD", "MIXED"], {
    error: "Selecciona la moneda",
  }),
});

export type AddSalaryInput = z.infer<typeof AddSalarySchema>;
