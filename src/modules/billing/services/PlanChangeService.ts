// src/modules/billing/services/PlanChangeService.ts
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { SubscriptionPlan, PlanChangeStatus } from "@prisma/client";
import { getPlanPriceCents, type PaidPlan } from "./BillingService";
import { isPrismaError } from "@/lib/prisma-errors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Primer día del próximo mes en UTC — ADR-040 D-3 */
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

  // El precio del plan depende del perfil de la empresa (Individual vs Empresa).
  // getPlanPriceCents lanza si el plan no aplica al perfil (ej. SOLO + EARLY_ADOPTER) —
  // dejamos que propague como validación de negocio.
  const company = await prisma.company.findUnique({
    where: { id: subscription.companyId },
    select: { scopeProfile: true },
  });
  const effectiveDate = calculateEffectiveDate();
  const newPriceUsdCents = getPlanPriceCents(company?.scopeProfile, toPlan as PaidPlan);

  let request;
  try {
    request = await prisma.$transaction(async (tx) => {
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
  } catch (err) {
    // MEDIUM-1 (race): el índice único parcial `plan_change_one_active` garantiza
    // atomicidad ante requests concurrentes (el pre-check de arriba es solo UX/fast-fail).
    if (isPrismaError(err, "P2002")) {
      throw new Error("Ya tienes un cambio de plan pendiente. Cancélalo antes de crear uno nuevo.");
    }
    throw err;
  }

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

/** Aplica todos los PlanChangeRequest CONFIRMED con effectiveDate <= now(). ADR-040 D-5. */
export async function applyDuePlanChanges(): Promise<{ applied: number; errors: string[] }> {
  const now = new Date();
  const errors: string[] = [];

  // ADR-004-EXCEPTION: cron job del sistema — procesa cambios de todas las empresas intencionalmente
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
  ipAddress: string | null,
  userAgent: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const req = await tx.planChangeRequest.findUnique({
      where: { id: planChangeRequestId },
      include: { subscription: { select: { companyId: true } } },
    });
    if (!req) throw new Error("Solicitud no encontrada.");

    // MEDIUM-2 (TOCTOU con el cron): compare-and-swap — solo cancela si sigue cancelable
    // (PENDING_PAYMENT/CONFIRMED). Si el cron ya la tomó (APPLYING/APPLIED), count=0 → rechaza,
    // evitando marcar CANCELED una suscripción ya mutada al nuevo plan.
    const updated = await tx.planChangeRequest.updateMany({
      where: { id: planChangeRequestId, status: { in: ["PENDING_PAYMENT", "CONFIRMED"] } },
      data: { status: "CANCELED", cancelReason: reason, appliedByUserId: cancelledByUserId },
    });
    if (updated.count === 0) {
      throw new Error("La solicitud ya fue procesada o cancelada.");
    }

    // LOW-1 (R-6): la cancelación tiene impacto económico → traza en AuditLog con IP/UA.
    await tx.auditLog.create({
      data: {
        companyId: req.subscription.companyId,
        entityId: planChangeRequestId,
        entityName: "PlanChangeRequest",
        action: "PLAN_CHANGE_CANCELED",
        userId: cancelledByUserId,
        ipAddress,
        userAgent,
        newValue: { reason, fromStatus: req.status } as object,
      },
    });
  });
}
