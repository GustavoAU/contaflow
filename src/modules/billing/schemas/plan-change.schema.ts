// src/modules/billing/schemas/plan-change.schema.ts
import { z } from "zod";

export const RequestPlanChangeSchema = z.object({
  companyId: z.string().min(1),
  // LOW-2: self-service solo permite cambiar entre MONTHLY y ANNUAL. EARLY_ADOPTER es un
  // promo de alta (año 1, con cupos limitados) — no se cambia hacia él por self-service.
  toPlan: z.enum(["MONTHLY", "ANNUAL"]),
});

export const ConfirmPlanChangeSchema = z.object({
  planChangeRequestId: z.string().min(1),
  txHash: z.string().min(10).max(100),
});

export const CancelPlanChangeSchema = z.object({
  planChangeRequestId: z.string().min(1),
  reason: z.string().max(500).default("Cancelado por el usuario"),
});

export type RequestPlanChangeInput = z.infer<typeof RequestPlanChangeSchema>;
export type ConfirmPlanChangeInput = z.infer<typeof ConfirmPlanChangeSchema>;
