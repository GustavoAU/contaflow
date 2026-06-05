"use server";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import * as PlanChangeService from "../services/PlanChangeService";
import {
  RequestPlanChangeSchema,
  ConfirmPlanChangeSchema,
  CancelPlanChangeSchema,
} from "../schemas/plan-change.schema";
import type { SubscriptionPlan } from "@prisma/client";

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

function getIpUa(h: Awaited<ReturnType<typeof headers>>) {
  const ipAddress =
    h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;
  return { ipAddress, userAgent };
}

// ─── requestPlanChangeAction ──────────────────────────────────────────────────

export async function requestPlanChangeAction(input: {
  companyId: string;
  toPlan: string;
}): Promise<ActionResult<{ planChangeRequestId: string; effectiveDate: string; newPriceUsdCents: number }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error ?? "Límite de solicitudes alcanzado" };

    const validated = RequestPlanChangeSchema.parse(input);

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: validated.companyId } },
    });
    if (!member) return { success: false, error: "Empresa no encontrada" };
    if (member.role !== "OWNER") {
      return { success: false, error: "Solo el Propietario puede cambiar el plan." };
    }

    const h = await headers();
    const { ipAddress, userAgent } = getIpUa(h);

    const result = await PlanChangeService.requestPlanChange(
      validated.companyId,
      validated.toPlan as SubscriptionPlan,
      userId,
      ipAddress,
      userAgent,
    );

    revalidatePath(`/settings/plan`);

    return {
      success: true,
      data: {
        planChangeRequestId: result.planChangeRequestId,
        effectiveDate: result.effectiveDate.toISOString(),
        newPriceUsdCents: result.newPriceUsdCents,
      },
    };
  } catch (err) {
    if (err instanceof z.ZodError) return { success: false, error: "Datos inválidos" };
    if (err instanceof Error) return { success: false, error: err.message };
    return { success: false, error: "Error inesperado" };
  }
}

// ─── cancelPlanChangeAction ───────────────────────────────────────────────────

export async function cancelPlanChangeAction(input: {
  planChangeRequestId: string;
  reason?: string;
}): Promise<ActionResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const validated = CancelPlanChangeSchema.parse(input);

    // Verificar que el requestedByUserId coincide o que el usuario es OWNER de la empresa
    const req = await prisma.planChangeRequest.findUnique({
      where: { id: validated.planChangeRequestId },
      include: { subscription: { select: { companyId: true } } },
    });
    if (!req) return { success: false, error: "Solicitud no encontrada" };

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: req.subscription.companyId } },
    });
    if (!member || member.role !== "OWNER") {
      return { success: false, error: "No tienes permiso para cancelar esta solicitud." };
    }

    await PlanChangeService.cancelPlanChange(
      validated.planChangeRequestId,
      userId,
      validated.reason,
    );

    revalidatePath(`/settings/plan`);
    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof Error) return { success: false, error: err.message };
    return { success: false, error: "Error inesperado" };
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
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!member) return { success: false, error: "Empresa no encontrada" };

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
    if (err instanceof Error) return { success: false, error: err.message };
    return { success: false, error: "Error inesperado" };
  }
}
