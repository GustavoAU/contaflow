// src/modules/billing/services/PlanChangeService.ts
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { SubscriptionPlan, PlanChangeStatus } from "@prisma/client";

export { PLAN_PRICES_CENTS } from "./BillingService";

// ─── Precios por plan (centavos USD) ──────────────────────────────────────────

export const PLAN_PRICES_CENTS_MAP: Record<string, number> = {
  MONTHLY: 5900,       // $59/mes
  ANNUAL: 56500,       // $565/año
  EARLY_ADOPTER: 22800, // $228/año (año 1)
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Primer día del próximo mes en UTC — ADR-032 D-3 */
export function calculateEffectiveDate(from: Date = new Date()): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/** Fecha fin del nuevo período (1 mes o 1 año desde effectiveDate) */
function calculateNewPeriodEnd(effectiveDate: Date, toPlan: SubscriptionPlan): Date {
  const d = new Date(effectiveDate);
  if (toPlan === "ANNUAL" || toPlan === "EARLY_ADOPTER") {
    d.setUTCFullYear(d.getUTCFullYear() + 1);
  } else {
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return d;
}

const ACTIVE_STATUSES: PlanChangeStatus[] = ["PENDING_PAYMENT", "CONFIRMED", "APPLYING"];

// ─── requestPlanChange ────────────────────────────────────────────────────────

export async function requestPlanChange(
  companyId: string,
  toPlan: SubscriptionPlan,
  requestedByUserId: string,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<{ planChangeRequestId: string; effectiveDate: Date; newPriceUsdCents: number }> {
  const subscription = await prisma.subscription.findUnique({ where: { companyId } });
  if (!subscription) throw new Error("La empresa no tiene una suscripción activa.");
  if (subscription.status !== "ACTIVE") throw new Error("La suscripción no está activa.");
  if (subscription.plan === toPlan) throw new Error("Ya estás en ese plan.");

  // Guard: solo 1 solicitud activa por suscripción
  const existing = await prisma.planChangeRequest.findFirst({
    where: { subscriptionId: subscription.id, status: { in: ACTIVE_STATUSES } },
  });
  if (existing) throw new Error("Ya tienes un cambio de plan pendiente. Cancélalo antes de crear uno nuevo.");

  const effectiveDate = calculateEffectiveDate();
  const newPriceUsdCents = PLAN_PRICES_CENTS_MAP[toPlan] ?? 5900;

  const request = await prisma.$transaction(async (tx) => {
    const req = await tx.planChangeRequest.create({
      data: {
        subscriptionId: subscription.id,
        fromPlan: subscription.plan,
        toPlan,
        newPriceUsdCents,
        effectiveDate,
        status: "PENDING_PAYMENT",
        requestedByUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        companyId,
        entityId: req.id,
        entityName: "PlanChangeRequest",
        action: "PLAN_CHANGE_REQUESTED",
        userId: requestedByUserId,
        ipAddress,
        userAgent,
        newValue: { fromPlan: subscription.plan, toPlan, effectiveDate, newPriceUsdCents } as object,
      },
    });

    return req;
  });

  return { planChangeRequestId: request.id, effectiveDate, newPriceUsdCents };
}

// ─── confirmPlanChange (admin manual) ────────────────────────────────────────

export async function confirmPlanChange(
  planChangeRequestId: string,
  txHash: string,
  confirmedByUserId: string,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const req = await tx.planChangeRequest.findUnique({
      where: { id: planChangeRequestId },
      include: { subscription: true },
    });
    if (!req) throw new Error("Solicitud no encontrada.");
    if (req.status !== "PENDING_PAYMENT") throw new Error("La solicitud ya fue procesada.");

    await tx.planChangeRequest.update({
      where: { id: planChangeRequestId },
      data: { status: "CONFIRMED", confirmedByUserId, confirmedAt: new Date() },
    });

    await tx.subscriptionPayment.create({
      data: {
        subscriptionId: req.subscriptionId,
        planChangeRequestId: req.id,
        amountUsdCents: req.newPriceUsdCents,
        currency: "USDT",
        txHash,
        status: "CONFIRMED",
        paidAt: new Date(),
        confirmedByUserId,
        metadata: { manualConfirmation: true } as object,
      },
    });

    await tx.auditLog.create({
      data: {
        companyId: req.subscription.companyId,
        entityId: planChangeRequestId,
        entityName: "PlanChangeRequest",
        action: "PLAN_CHANGE_CONFIRMED",
        userId: confirmedByUserId,
        ipAddress,
        userAgent,
        newValue: { txHash, toPlan: req.toPlan, effectiveDate: req.effectiveDate } as object,
      },
    });
  });
}

// ─── applyDuePlanChanges (cron) ───────────────────────────────────────────────

/** Aplica todos los PlanChangeRequest CONFIRMED con effectiveDate <= now(). ADR-032 D-5. */
export async function applyDuePlanChanges(): Promise<{ applied: number; errors: string[] }> {
  const now = new Date();
  const errors: string[] = [];

  const due = await prisma.planChangeRequest.findMany({
    where: { status: "CONFIRMED", effectiveDate: { lte: now } },
    orderBy: { effectiveDate: "asc" },
    take: 100,
  });

  let applied = 0;

  for (const req of due) {
    try {
      await prisma.$transaction(async (tx) => {
        // D-5: compare-and-swap — solo continúa si sigue CONFIRMED
        const updated = await tx.planChangeRequest.updateMany({
          where: { id: req.id, status: "CONFIRMED" },
          data: { status: "APPLYING" },
        });
        if (updated.count === 0) return; // otro proceso lo tomó

        const newPeriodEnd = calculateNewPeriodEnd(req.effectiveDate, req.toPlan);

        await tx.subscription.update({
          where: { id: req.subscriptionId },
          data: {
            plan: req.toPlan,
            priceUsdCents: req.newPriceUsdCents,
            currentPeriodStart: req.effectiveDate,
            currentPeriodEnd: newPeriodEnd,
            status: "ACTIVE",
          },
        });

        const subscription = await tx.subscription.findUnique({
          where: { id: req.subscriptionId },
          select: { companyId: true },
        });

        await tx.planChangeRequest.update({
          where: { id: req.id },
          data: { status: "APPLIED", appliedByUserId: "cron", appliedAt: new Date() },
        });

        await tx.auditLog.create({
          data: {
            companyId: subscription!.companyId,
            entityId: req.id,
            entityName: "PlanChangeRequest",
            action: "PLAN_CHANGE_APPLIED",
            userId: "cron",
            ipAddress: null,
            userAgent: "ContaFlow-Cron",
            newValue: { toPlan: req.toPlan, newPeriodEnd } as object,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

      applied++;
    } catch (err) {
      errors.push(`[${req.id}] ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { applied, errors };
}

// ─── cancelPlanChange ─────────────────────────────────────────────────────────

export async function cancelPlanChange(
  planChangeRequestId: string,
  cancelledByUserId: string,
  reason: string,
): Promise<void> {
  const req = await prisma.planChangeRequest.findUnique({ where: { id: planChangeRequestId } });
  if (!req) throw new Error("Solicitud no encontrada.");
  if (!ACTIVE_STATUSES.includes(req.status)) throw new Error("La solicitud ya fue procesada o cancelada.");
  if (req.status === "APPLYING") throw new Error("La solicitud se está aplicando en este momento.");

  await prisma.planChangeRequest.update({
    where: { id: planChangeRequestId },
    data: { status: "CANCELED", cancelReason: reason, appliedByUserId: cancelledByUserId },
  });
}
