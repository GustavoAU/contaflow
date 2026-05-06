// src/modules/billing/schemas/billing.schema.ts
import { z } from "zod";

export const CreateCheckoutSchema = z.object({
  companyId: z.string().min(1, "Empresa requerida"),
  plan: z.enum(["MONTHLY", "ANNUAL", "EARLY_ADOPTER"], {
    error: "Plan inválido",
  }),
  payCurrency: z.string().default("usdterc20"),
});

export type CreateCheckoutInput = z.infer<typeof CreateCheckoutSchema>;
