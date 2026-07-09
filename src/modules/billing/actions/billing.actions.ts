// src/modules/billing/actions/billing.actions.ts
"use server";

import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import * as BillingService from "../services/BillingService";
import { CreateCheckoutSchema, type CreateCheckoutInput } from "../schemas/billing.schema";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── createCheckoutAction ────────────────────────────────────────────────────

export async function createCheckoutAction(
  input: CreateCheckoutInput,
): Promise<ActionResult<{ invoiceUrl: string; subscriptionPaymentId: string }>> {
  try {
    // ADR-025: intencionalmente solo OWNER puede gestionar la suscripción
    const ctx = await requireCompanyAction(input.companyId, {
      roles: ["OWNER"],
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const validated = CreateCheckoutSchema.parse(input);

    const result = await BillingService.createCheckout(
      validated.companyId,
      validated.plan,
      ctx.userId,
      ctx.ipAddress,
      ctx.userAgent,
    );

    return { success: true, data: result };
  } catch (error) {
    return toActionError(error);
  }
}
