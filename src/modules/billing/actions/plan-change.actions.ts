"use server";

import { revalidatePath } from "next/cache";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import prisma from "@/lib/prisma";
import * as PlanChangeService from "../services/PlanChangeService";
import {
  RequestPlanChangeSchema,
  CancelPlanChangeSchema,
} from "../schemas/plan-change.schema";
import type { SubscriptionPlan } from "@prisma/client";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── requestPlanChangeAction ──────────────────────────────────────────────────

export async function requestPlanChangeAction(input: {
  companyId: string;
  toPlan: string;
}): Promise<ActionResult<{
  planChangeRequestId: string;
  effectiveDate: string;
  newPriceUsdCents: number;
  invoiceUrl: string | null;
}>> {
  try {
    const validated = RequestPlanChangeSchema.parse(input);

    // ADR-025: intencionalmente solo OWNER puede gestionar el plan
    const ctx = await requireCompanyAction(validated.companyId, {
      roles: ["OWNER"],
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const userId = ctx.userId;
    const ipAddress = ctx.ipAddress;
    const userAgent = ctx.userAgent;

    const result = await PlanChangeService.requestPlanChange(
      validated.companyId,
      validated.toPlan as SubscriptionPlan,
      userId,
      ipAddress,
      userAgent,
    );

    // Iniciar el checkout de pago. Si falla la llamada externa, NO tumbamos la
    // solicitud ya creada: devolvemos invoiceUrl null y la UI mostrará "Pagar ahora".
    let invoiceUrl: string | null = null;
    try {
      const checkout = await PlanChangeService.createPlanChangeCheckout(
        result.planChangeRequestId,
        userId,
        ipAddress,
        userAgent,
      );
      invoiceUrl = checkout.invoiceUrl;
    } catch {
      invoiceUrl = null;
    }

    revalidatePath(`/settings/plan`);

    return {
      success: true,
      data: {
        planChangeRequestId: result.planChangeRequestId,
        effectiveDate: result.effectiveDate.toISOString(),
        newPriceUsdCents: result.newPriceUsdCents,
        invoiceUrl,
      },
    };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── payPlanChangeAction ──────────────────────────────────────────────────────

/** Reintenta el pago de una solicitud PENDING_PAYMENT. Solo el OWNER. */
export async function payPlanChangeAction(input: {
  planChangeRequestId: string;
}): Promise<ActionResult<{ invoiceUrl: string }>> {
  try {
    const req = await prisma.planChangeRequest.findUnique({
      where: { id: input.planChangeRequestId },
      include: { subscription: { select: { companyId: true } } },
    });
    if (!req) return { success: false, error: "Solicitud no encontrada" };

    const ctx = await requireCompanyAction(req.subscription.companyId, {
      roles: ["OWNER"],
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const checkout = await PlanChangeService.createPlanChangeCheckout(
      input.planChangeRequestId,
      ctx.userId,
      ctx.ipAddress,
      ctx.userAgent,
    );

    return { success: true, data: { invoiceUrl: checkout.invoiceUrl } };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── cancelPlanChangeAction ───────────────────────────────────────────────────

export async function cancelPlanChangeAction(input: {
  planChangeRequestId: string;
  reason?: string;
}): Promise<ActionResult<void>> {
  try {
    const validated = CancelPlanChangeSchema.parse(input);

    // Verificar que el requestedByUserId coincide o que el usuario es OWNER de la empresa
    const req = await prisma.planChangeRequest.findUnique({
      where: { id: validated.planChangeRequestId },
      include: { subscription: { select: { companyId: true } } },
    });
    if (!req) return { success: false, error: "Solicitud no encontrada" };

    const ctx = await requireCompanyAction(req.subscription.companyId, {
      roles: ["OWNER"],
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    await PlanChangeService.cancelPlanChange(
      validated.planChangeRequestId,
      ctx.userId,
      validated.reason,
      ctx.ipAddress,
      ctx.userAgent,
    );

    revalidatePath(`/settings/plan`);
    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── getSubscriptionStatusAction ─────────────────────────────────────────────

export async function getSubscriptionStatusAction(companyId: string): Promise<ActionResult<{
  plan: string;
  status: string;
  currentPeriodEnd: string;
  priceUsdCents: number;
  pendingChange: {
    id: string;
    toPlan: string;
    effectiveDate: string;
    newPriceUsdCents: number;
    status: string;
  } | null;
}>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY" });
    if (!ctx.ok) return ctx.error;

    const subscription = await prisma.subscription.findUnique({
      where: { companyId },
      include: {
        changeRequests: {
          where: { status: { in: ["PENDING_PAYMENT", "CONFIRMED"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!subscription) return { success: false, error: "Sin suscripción activa" };

    const pending = subscription.changeRequests[0] ?? null;

    return {
      success: true,
      data: {
        plan: subscription.plan,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
        priceUsdCents: subscription.priceUsdCents,
        pendingChange: pending
          ? {
              id: pending.id,
              toPlan: pending.toPlan,
              effectiveDate: pending.effectiveDate.toISOString(),
              newPriceUsdCents: pending.newPriceUsdCents,
              status: pending.status,
            }
          : null,
      },
    };
  } catch (err) {
    return toActionError(err);
  }
}
