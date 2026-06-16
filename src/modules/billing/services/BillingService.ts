// src/modules/billing/services/BillingService.ts
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { createNowPaymentsInvoice, type NowPaymentsIPN } from "@/lib/nowpayments";
import type { BillingPaymentStatus } from "@prisma/client";

// ─── Constantes ───────────────────────────────────────────────────────────────

export type PaidPlan = "MONTHLY" | "ANNUAL" | "EARLY_ADOPTER";

export const PLAN_PRICES_CENTS: Record<PaidPlan, number> = {
  MONTHLY: 7900,    // $79/mes
  ANNUAL: 78000,    // $780/año ($65/mes efectivo) — mismo precio que renueva Early Adopter año 2+
  EARLY_ADOPTER: 70800, // $708/año ($59/mes efectivo) — precio bloqueado para siempre; año 2+ renueva a ANNUAL
};

const PLAN_PERIOD_DAYS: Record<PaidPlan, number> = {
  MONTHLY: 30,
  ANNUAL: 365,
  EARLY_ADOPTER: 365,
};

const EARLY_ADOPTER_MAX_SLOTS = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function nowPaymentsStatusToBilling(status: string): BillingPaymentStatus {
  switch (status) {
    case "waiting":
    case "partially_paid":
      return "PENDING";
    case "confirming":
    case "sending":
      return "CONFIRMING";
    case "confirmed":
    case "finished":
      return "CONFIRMED";
    case "failed":
      return "FAILED";
    case "expired":
      return "EXPIRED";
    case "refunded":
      return "REFUNDED";
    default:
      return "PENDING";
  }
}

// ─── createCheckout ───────────────────────────────────────────────────────────

export async function createCheckout(
  companyId: string,
  plan: PaidPlan,
  actorUserId: string,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<{ invoiceUrl: string; subscriptionPaymentId: string }> {
  const existing = await prisma.subscription.findUnique({ where: { companyId } });
  if (existing?.status === "ACTIVE") {
    throw new Error("La empresa ya tiene una suscripción activa.");
  }
  // LOW-1: bloquear doble checkout cuando hay pago pendiente
  if (existing?.status === "PAST_DUE") {
    throw new Error("Ya tienes un pago en curso. Complétalo o espera a que expire antes de iniciar uno nuevo.");
  }

  const priceUsdCents = PLAN_PRICES_CENTS[plan];
  const periodDays = PLAN_PERIOD_DAYS[plan];
  const now = new Date();
  const periodEnd = addDays(now, periodDays);

  const isolationLevel =
    plan === "EARLY_ADOPTER"
      ? Prisma.TransactionIsolationLevel.Serializable
      : Prisma.TransactionIsolationLevel.ReadCommitted;

  // ── Transacción: reservar slot + crear Subscription + SubscriptionPayment ──
  const subscriptionPayment = await prisma.$transaction(async (tx) => {
    let earlyAdopterSlot: number | null = null;

    if (plan === "EARLY_ADOPTER") {
      const count = await tx.subscription.count({
        where: { plan: "EARLY_ADOPTER", status: { not: "EXPIRED" } },
      });
      if (count >= EARLY_ADOPTER_MAX_SLOTS) {
        throw new Error("No quedan slots de Early Adopter disponibles.");
      }
      // ADR-004-EXCEPTION: slot check global — busca números ocupados en TODAS las empresas para asignar un slot único
      const taken = await tx.subscription.findMany({
        where: { plan: "EARLY_ADOPTER" },
        select: { earlyAdopterSlot: true },
      });
      const takenSet = new Set(taken.map((s) => s.earlyAdopterSlot));
      earlyAdopterSlot =
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((n) => !takenSet.has(n)) ?? null;
    }

    // Upsert Subscription en PAST_DUE — representa "pago pendiente"
    const subscription = await tx.subscription.upsert({
      where: { companyId },
      create: {
        companyId,
        plan,
        status: "PAST_DUE",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        priceUsdCents,
        earlyAdopterSlot,
      },
      update: {
        plan,
        status: "PAST_DUE",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        priceUsdCents,
        earlyAdopterSlot,
      },
    });

    const payment = await tx.subscriptionPayment.create({
      data: {
        subscriptionId: subscription.id,
        amountUsdCents: priceUsdCents,
        currency: "usd",
        status: "PENDING",
        metadata: { plan, companyId },
      },
    });

    await tx.auditLog.create({
      data: {
        companyId,
        entityId: payment.id,
        entityName: "SubscriptionPayment",
        action: "BILLING_CHECKOUT_INITIATED",
        userId: actorUserId,
        ipAddress,
        userAgent,
        newValue: { plan, priceUsdCents } as object,
      },
    });

    return payment;
  }, { isolationLevel });

  // ── Llamada externa a NOWPayments (fuera de la tx) ────────────────────────
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://contaflow.app";

  const invoice = await createNowPaymentsInvoice({
    priceAmountCents: priceUsdCents,
    ipnCallbackUrl: `${appUrl}/api/webhooks/nowpayments`,
    orderId: subscriptionPayment.id,
    orderDescription: `ContaFlow — Plan ${plan}`,
    successUrl: `${appUrl}/company/${companyId}?payment=success`,
    cancelUrl: `${appUrl}/company/${companyId}/upgrade?payment=cancelled`,
  });

  // Persistir el ID del invoice de NOWPayments para idempotencia
  await prisma.subscriptionPayment.update({
    where: { id: subscriptionPayment.id },
    data: { nowpaymentsOrderId: invoice.id },
  });

  return { invoiceUrl: invoice.invoice_url, subscriptionPaymentId: subscriptionPayment.id };
}

// ─── handleIPN ────────────────────────────────────────────────────────────────

// 1 centavo de tolerancia para redondeo en crypto
const IPN_AMOUNT_TOLERANCE_CENTS = 1;

export async function handleIPN(ipn: NowPaymentsIPN, ipnSourceIp?: string | null): Promise<void> {
  const paymentIdStr = String(ipn.payment_id);
  const isFinished = ipn.payment_status === "finished";
  const newStatus = nowPaymentsStatusToBilling(ipn.payment_status);
  const now = new Date();

  // HIGH-2: idempotencia y activación dentro de una sola tx con RepeatableRead
  // evita race condition entre IPNs concurrentes del mismo pago
  await prisma.$transaction(async (tx) => {
    // ADR-004-EXCEPTION: lookup por IDs de NOWPayments — companyId desconocido hasta encontrar el pago
    const payment = await tx.subscriptionPayment.findFirst({
      where: {
        OR: [
          { id: String(ipn.order_id) },
          { nowpaymentsPaymentId: paymentIdStr },
        ],
      },
      include: { subscription: true },
    });

    if (!payment) throw new Error("Pago no encontrado");

    // Idempotencia: ignorar si ya está en estado terminal (dentro de la tx)
    if (payment.status === "CONFIRMED" || payment.status === "REFUNDED") return;

    // HIGH-1: validar monto recibido vs monto esperado antes de activar
    if (isFinished) {
      const paidCents = Math.round((ipn.actually_paid ?? 0) * 100);
      if (paidCents < payment.amountUsdCents - IPN_AMOUNT_TOLERANCE_CENTS) {
        throw new Error(
          `Pago insuficiente: recibido ${paidCents}¢, esperado ${payment.amountUsdCents}¢`
        );
      }
    }

    await tx.subscriptionPayment.update({
      where: { id: payment.id },
      data: {
        status: newStatus,
        nowpaymentsPaymentId: paymentIdStr,
        paidAt: isFinished ? now : undefined,
        metadata: {
          ...(typeof payment.metadata === "object" && payment.metadata !== null
            ? (payment.metadata as Record<string, unknown>)
            : {}),
          lastIpn: { ...ipn, payment_id: paymentIdStr },
        },
      },
    });

    if (isFinished) {
      const plan = payment.subscription.plan as PaidPlan;
      const periodDays = PLAN_PERIOD_DAYS[plan] ?? 30;
      const periodEnd = addDays(now, periodDays);

      await tx.subscription.update({
        where: { id: payment.subscriptionId },
        data: {
          status: "ACTIVE",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId: payment.subscription.companyId,
          entityId: payment.subscriptionId,
          entityName: "Subscription",
          action: "BILLING_SUBSCRIPTION_ACTIVATED",
          userId: "system",
          ipAddress: ipnSourceIp ?? null,
          userAgent: "NOWPayments-IPN",
          newValue: {
            plan,
            paymentId: payment.id,
            amountUsdCents: payment.amountUsdCents,
            actuallyPaidCents: Math.round((ipn.actually_paid ?? 0) * 100),
          } as object,
        },
      });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
