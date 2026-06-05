"use server";
import { z } from "zod";

export const RequestPlanChangeSchema = z.object({
  companyId: z.string().min(1),
  toPlan: z.enum(["MONTHLY", "ANNUAL", "EARLY_ADOPTER"]),
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
