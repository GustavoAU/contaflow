import { z } from "zod";

export const createLoanSchema = z.object({
  employeeId: z.string().min(1, { error: "Seleccione un empleado." }),
  totalAmount: z
    .string()
    .min(1, { error: "Ingrese el monto total." })
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, { error: "El monto debe ser mayor que cero." }),
  currency: z.enum(["VES", "USD"], { error: "Moneda inválida." }),
  installments: z
    .number({ error: "Ingrese el número de cuotas." })
    .int({ error: "Las cuotas deben ser un número entero." })
    .min(1, { error: "Debe haber al menos 1 cuota." })
    .max(120, { error: "Máximo 120 cuotas." }),
  description: z.string().max(255).optional().nullable(),
});

export type CreateLoanInput = z.infer<typeof createLoanSchema>;
