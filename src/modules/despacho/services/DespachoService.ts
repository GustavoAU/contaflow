// ADR-034: Fase Despacho — Tier Multi-RIF
import { DespachoTier, type ManagedClient, type Prisma as PrismaTypes } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isPrismaError } from "@/lib/prisma-errors";
import { createNowPaymentsInvoice } from "@/lib/nowpayments";
import { VEN_RIF_REGEX } from "@/lib/fiscal-validators";

// ─── Constantes — ADR-034, precios fijados 2026-06-15 ───────────────────────
// Los límites y precios viven aquí, NO en el schema (ADR-034 D-3).
// Todos los tiers incluyen la empresa propia del Despacho + N RIFs gestionados.

export const DESPACHO_TIER_RIF_LIMITS: Record<DespachoTier, number | null> = {
  STARTER: 5,
  PRO: 25,
  UNLIMITED: null,
};

// Precio mensual en centavos USD (pago mensual recurrente)
export const DESPACHO_TIER_PRICES_USD_CENTS: Record<DespachoTier, number> = {
  STARTER: 11900,   // $119/mes · empresa propia + hasta 5 RIFs gestionados
  PRO: 24900,       // $249/mes · empresa propia + hasta 25 RIFs gestionados
  UNLIMITED: 35900, // $359/mes · empresa propia + RIFs ilimitados
};

// ─── Input types ─────────────────────────────────────────────────────────────

export interface AddManagedClientInput {
  rif: string;
  clientName: string;
  ciiu?: string;
  notes?: string;
}

// ─── canAddManagedClient ──────────────────────────────────────────────────────

export async function canAddManagedClient(
  companyId: string,
): Promise<{ allowed: boolean; currentCount: number; limit: number | null }> {
  const subscription = await prisma.subscription.findUnique({
    where: { companyId },
    select: { despachoTier: true },
  });

  if (!subscription?.despachoTier) {
    return { allowed: false, currentCount: 0, limit: 0 };
  }

  const tier = subscription.despachoTier;
  const limit = DESPACHO_TIER_RIF_LIMITS[tier];

  const currentCount = await prisma.managedClient.count({
    where: { despachoCompanyId: companyId, deletedAt: null },
  });

  if (limit === null) {
    return { allowed: true, currentCount, limit: null };
  }

  return { allowed: currentCount < limit, currentCount, limit };
}

// ─── addManagedClient ─────────────────────────────────────────────────────────

export async function addManagedClient(
  companyId: string,
  input: AddManagedClientInput,
  callerUserId: string,
  ip: string | null,
  userAgent: string | null,
): Promise<{ success: true; client: ManagedClient } | { success: false; error: string }> {
  if (!VEN_RIF_REGEX.test(input.rif)) {
    return { success: false, error: "RIF inválido — debe tener formato J/V/E/G/C/P-XXXXXXXX" };
  }

  const { allowed, currentCount, limit } = await canAddManagedClient(companyId);
  if (!allowed) {
    const limitMsg = limit !== null ? ` (${currentCount}/${limit})` : "";
    return {
      success: false,
      error: `Límite de RIFs alcanzado${limitMsg}. Mejora tu tier para agregar más clientes.`,
    };
  }

  try {
    const client = await prisma.$transaction(async (tx) => {
      const managed = await (tx as typeof prisma).managedClient.create({
        data: {
          despachoCompanyId: companyId,
          rif: input.rif,
          clientName: input.clientName,
          ciiu: input.ciiu ?? null,
          notes: input.notes ?? null,
          createdBy: callerUserId,
        },
      });

      await (tx as typeof prisma).auditLog.create({
        data: {
          action: "ADD_MANAGED_CLIENT",
          companyId,
          entityId: managed.id,
          entityName: "ManagedClient",
          userId: callerUserId,
          ipAddress: ip,
          userAgent,
          newValue: { rif: managed.rif, clientName: managed.clientName },
        },
      });

      return managed;
    });

    return { success: true, client };
  } catch (error) {
    if (isPrismaError(error, "P2002")) {
      return { success: false, error: "Ya existe un cliente con este RIF en tu Despacho" };
    }
    throw error;
  }
}

// ─── archiveManagedClient ─────────────────────────────────────────────────────

export async function archiveManagedClient(
  companyId: string,
  managedClientId: string,
  callerUserId: string,
  ip: string | null,
  userAgent: string | null,
): Promise<{ success: true } | { success: false; error: string }> {
  // IDOR guard: busca por id Y despachoCompanyId — ADR-004
  const existing = await prisma.managedClient.findFirst({
    where: { id: managedClientId, despachoCompanyId: companyId },
  });

  if (!existing) {
    return { success: false, error: "Cliente no encontrado" };
  }

  if (existing.deletedAt !== null) {
    return { success: false, error: "Este cliente ya archivado anteriormente" };
  }

  await prisma.$transaction(async (tx) => {
    await (tx as typeof prisma).managedClient.update({
      where: { id: managedClientId },
      data: { deletedAt: new Date(), deletedBy: callerUserId },
    });

    await (tx as typeof prisma).auditLog.create({
      data: {
        action: "ARCHIVE_MANAGED_CLIENT",
        companyId,
        entityId: managedClientId,
        entityName: "ManagedClient",
        userId: callerUserId,
        ipAddress: ip,
        userAgent,
        newValue: { rif: existing.rif },
      },
    });
  });

  return { success: true };
}

// ─── listManagedClients ───────────────────────────────────────────────────────

export async function listManagedClients(
  companyId: string,
  opts?: { includeArchived?: boolean },
): Promise<ManagedClient[]> {
  const where: PrismaTypes.ManagedClientWhereInput = {
    despachoCompanyId: companyId,
    ...(opts?.includeArchived ? {} : { deletedAt: null }),
  };

  return prisma.managedClient.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
}

// ─── upgradeDespachoTier ──────────────────────────────────────────────────────

// Inicia el checkout del tier Despacho. "Todo incluido": el pago del tier ES la
// suscripción del Despacho (incluye su empresa propia + N RIFs). El despachoTier
// NO se aplica aquí — queda en metadata y se activa al confirmar el pago vía
// handleIPN (BillingService). Soporta Despacho sin suscripción previa (upsert).
// R-6: AuditLog con ip/userAgent dentro del mismo $transaction.
export async function upgradeDespachoTier(
  companyId: string,
  newTier: DespachoTier,
  callerUserId: string,
  ip: string | null,
  userAgent: string | null,
): Promise<{ success: true; paymentUrl: string } | { success: false; error: string }> {
  const subscription = await prisma.subscription.findUnique({
    where: { companyId },
    select: { despachoTier: true, plan: true, status: true },
  });

  if (subscription?.despachoTier === newTier && subscription?.status === "ACTIVE") {
    return { success: false, error: `Ya tienes el tier ${newTier} activo` };
  }

  // LOW-1 (paridad con BillingService): bloquear doble checkout con pago en curso
  if (subscription?.status === "PAST_DUE") {
    return {
      success: false,
      error: "Ya tienes un pago en curso. Complétalo o espera a que expire antes de iniciar otro.",
    };
  }

  // Downgrade protection: verificar que el count actual cabe en el nuevo tier
  const newLimit = DESPACHO_TIER_RIF_LIMITS[newTier];
  if (newLimit !== null) {
    const currentCount = await prisma.managedClient.count({
      where: { despachoCompanyId: companyId, deletedAt: null },
    });
    if (currentCount > newLimit) {
      return {
        success: false,
        error: `No puedes bajar al tier ${newTier} con ${currentCount} RIFs activos (límite: ${newLimit}). Archiva clientes primero.`,
      };
    }
  }

  const priceUsdCents = DESPACHO_TIER_PRICES_USD_CENTS[newTier];
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 86_400_000); // cobro mensual del tier

  // Upsert Subscription en PAST_DUE (pago pendiente) + payment PENDING + AuditLog.
  // El despachoTier NO se toca todavía — solo se aplica al confirmar el pago.
  const payment = await prisma.$transaction(async (tx) => {
    const sub = await (tx as typeof prisma).subscription.upsert({
      where: { companyId },
      create: {
        companyId,
        plan: subscription?.plan ?? "MONTHLY",
        status: "PAST_DUE",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        priceUsdCents,
      },
      update: {
        status: "PAST_DUE",
        priceUsdCents,
      },
    });

    const created = await (tx as typeof prisma).subscriptionPayment.create({
      data: {
        subscriptionId: sub.id,
        amountUsdCents: priceUsdCents,
        currency: "usd",
        status: "PENDING",
        metadata: { despachoTierUpgrade: newTier, companyId },
      },
    });

    await (tx as typeof prisma).auditLog.create({
      data: {
        action: "DESPACHO_TIER_CHECKOUT_INITIATED",
        companyId,
        entityId: created.id,
        entityName: "SubscriptionPayment",
        userId: callerUserId,
        ipAddress: ip,
        userAgent,
        newValue: { despachoTier: newTier, priceUsdCents },
      },
    });

    return created;
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://contaflow.app";

  const invoice = await createNowPaymentsInvoice({
    priceAmountCents: priceUsdCents,
    orderId: payment.id,
    orderDescription: `ContaFlow Despacho ${newTier}`,
    ipnCallbackUrl: `${appUrl}/api/webhooks/nowpayments`,
    successUrl: `${appUrl}/company/${companyId}/despacho/rifs?payment=success`,
    cancelUrl: `${appUrl}/company/${companyId}/despacho/upgrade?payment=cancelled`,
  });

  await prisma.subscriptionPayment.update({
    where: { id: payment.id },
    data: { nowpaymentsOrderId: invoice.id },
  });

  return { success: true, paymentUrl: invoice.invoice_url };
}
