// src/modules/payroll/schemas/payroll-config.schema.ts
// Fase NOM-A: validación Zod para el wizard de configuración de nómina

import { z } from "zod";

export const PayrollConfigSchema = z.object({
  // Paso 1 — Empresa
  sizeRange: z.enum(["SMALL", "MEDIUM", "LARGE"], {
    error: "Selecciona el tamaño de la empresa",
  }),
  lottRegime: z.enum(["POST_2012", "MIXED"], {
    error: "Selecciona el régimen LOTTT aplicable",
  }),
  // Paso 2 — Organismos y Beneficios
  ivssEnabled: z.boolean(),
  incesEnabled: z.boolean(),
  banavihEnabled: z.boolean(),
  cestaTicketType: z.enum(["CARD", "CASH", "NONE"], {
    error: "Selecciona el tipo de cesta ticket",
  }),
  // Paso 3 — Configuración de Pagos
  paymentCurrency: z.enum(["VES", "USD", "MIXED"], {
    error: "Selecciona la moneda de pago",
  }),
  frequency: z.enum(["BIWEEKLY", "MONTHLY"], {
    error: "Selecciona la frecuencia de pago",
  }),
  fideicomiso: z.enum(["EXTERNAL_BANK", "INTERNAL"], {
    error: "Selecciona la modalidad de fideicomiso",
  }),
});

export type PayrollConfigInput = z.infer<typeof PayrollConfigSchema>;
