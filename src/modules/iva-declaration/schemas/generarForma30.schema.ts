// src/modules/iva-declaration/schemas/generarForma30.schema.ts

import { z } from "zod";
import { Decimal } from "decimal.js";
import { MAX_INVOICE_AMOUNT } from "@/lib/fiscal-validators";
import { isPlainDecimal } from "@/lib/zod-helpers";

/**
 * Crédito fiscal del período anterior (Forma 30, Sección E).
 *
 * R-5: viaja como string decimal ("1234.56"), nunca como number. Schema propio y no
 * `zMoneyAmount` porque ese tope (999.999.999,99) es 10 veces menor que el techo
 * canónico del sistema (ADR-006 D-2, `MAX_INVOICE_AMOUNT`): un crédito acumulado puede
 * legítimamente superar los mil millones de Bs., y el mensaje genérico de
 * `zMoneyAmount` habría culpado a los decimales. Omitido equivale a "0".
 */
const creditoFiscalSchema = z.coerce
  .string()
  .default("0")
  .superRefine((v, ctx) => {
    // Formato llano: Decimal leería "0x64" como 100 y "1e3" como 1000 sin avisar.
    if (!isPlainDecimal(v)) {
      ctx.addIssue({
        code: "custom",
        message: "Crédito fiscal inválido: use solo dígitos y un punto decimal (ej. 1234.56)",
      });
      return;
    }
    const d = new Decimal(v);
    if (d.lt(0)) {
      ctx.addIssue({ code: "custom", message: "El crédito fiscal no puede ser negativo" });
    } else if (d.decimalPlaces() > 2) {
      ctx.addIssue({ code: "custom", message: "El crédito fiscal admite máximo 2 decimales" });
    } else if (d.gt(MAX_INVOICE_AMOUNT)) {
      ctx.addIssue({
        code: "custom",
        message: "El crédito fiscal supera el máximo permitido (9.999.999.999,99)",
      });
    }
  });

export const GenerarForma30Schema = z.object({
  companyId: z.string().min(1, { error: "companyId requerido" }),
  year: z
    .number()
    .int()
    .min(2020, { error: "Año mínimo: 2020" })
    .max(2099, { error: "Año máximo: 2099" }),
  month: z.number().int().min(1, { error: "Mes mínimo: 1" }).max(12, { error: "Mes máximo: 12" }),
  creditoFiscalPeriodoAnterior: creditoFiscalSchema,
});

export type GenerarForma30Input = z.infer<typeof GenerarForma30Schema>;
