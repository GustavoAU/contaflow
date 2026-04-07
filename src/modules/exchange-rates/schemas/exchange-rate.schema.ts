import { z } from "zod";
import { Decimal } from "decimal.js";

export const CurrencySchema = z.enum(["USD", "EUR"]);
export type ForeignCurrency = z.infer<typeof CurrencySchema>;

export const UpsertExchangeRateSchema = z.object({
  companyId: z.string().min(1),
  currency: CurrencySchema,
  rate: z.string().refine(
    (v) => {
      try {
        const d = new Decimal(v);
        return d.gt(0) && d.lte(new Decimal("100000")); // reasonable ceiling for VES exchange rate
      } catch {
        return false;
      }
    },
    { error: "Tasa debe ser un número positivo (máximo 100,000)" }
  ),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Fecha inválida (YYYY-MM-DD)" }),
  source: z.string().optional(),
  createdBy: z.string().optional(), // kept for backward compat — action uses auth() userId
});

export type UpsertExchangeRateInput = z.infer<typeof UpsertExchangeRateSchema>;

export const GetRateSchema = z.object({
  companyId: z.string().min(1),
  currency: CurrencySchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
