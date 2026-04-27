// src/modules/iva-declaration/schemas/generarForma30.schema.ts

import { z } from "zod";

export const GenerarForma30Schema = z.object({
  companyId: z.string().min(1, { error: "companyId requerido" }),
  year: z
    .number()
    .int()
    .min(2020, { error: "Año mínimo: 2020" })
    .max(2099, { error: "Año máximo: 2099" }),
  month: z
    .number()
    .int()
    .min(1, { error: "Mes mínimo: 1" })
    .max(12, { error: "Mes máximo: 12" }),
  creditoFiscalPeriodoAnterior: z
    .number()
    .nonnegative({ error: "El crédito fiscal no puede ser negativo" })
    .optional()
    .default(0),
});

export type GenerarForma30Input = z.infer<typeof GenerarForma30Schema>;
