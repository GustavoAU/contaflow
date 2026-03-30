import { z } from "zod";

export const CurrencySchema = z.enum(["USD", "EUR"]);
export type ForeignCurrency = z.infer<typeof CurrencySchema>;

export const UpsertExchangeRateSchema = z.object({
  companyId: z.string().min(1),
  currency: CurrencySchema,
  rate: z
    .string()
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
      error: "Tasa debe ser un número positivo",
    }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Fecha inválida (YYYY-MM-DD)" }),
  source: z.string().optional(),
  createdBy: z.string().min(1),
});

export type UpsertExchangeRateInput = z.infer<typeof UpsertExchangeRateSchema>;

export const GetRateSchema = z.object({
  companyId: z.string().min(1),
  currency: CurrencySchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
