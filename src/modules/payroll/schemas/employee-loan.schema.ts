import { z } from "zod";

export const createLoanSchema = z.object({
  employeeId: z.string().min(1, { error: "Seleccione un empleado." }),
  // Binario a proposito (regla de negocio 2026-08-23): el empleado elige VES o
  // USD al pedirlo y esa moneda es inmutable. MIXED sigue existiendo en el enum
  // de Prisma por las filas historicas, pero no se puede crear uno nuevo.
  currency: z.enum(["VES", "USD"], { error: "Moneda inválida." }),
  totalAmount: z
    .string()
    .min(1, { error: "Ingrese el monto total." })
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, { error: "El monto debe ser mayor que cero." }),
  amountUsd: z.string().optional().nullable(),
  installments: z
    .number({ error: "Ingrese el número de cuotas." })
    .int({ error: "Las cuotas deben ser un número entero." })
    .min(1, { error: "Debe haber al menos 1 cuota." })
    .max(120, { error: "Máximo 120 cuotas." }),
  interestRate: z.string().optional().nullable(),
  description: z.string().max(255).optional().nullable(),
});

export type CreateLoanInput = z.infer<typeof createLoanSchema>;

export const rejectLoanSchema = z.object({
  rejectionReason: z.string().min(1, { error: "Ingrese el motivo de rechazo." }).max(500),
});
