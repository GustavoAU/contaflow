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
const DESPACHO_TIER_PRICES_USD_CENTS: Record<DespachoTier, number> = {
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

export async function upgradeDespachoTier(
  companyId: string,
  newTier: DespachoTier,
  callerUserId: string,
): Promise<{ success: true; paymentUrl: string } | { success: false; error: string }> {
  const subscription = await prisma.subscription.findUnique({
    where: { companyId },
    select: { id: true, despachoTier: true },
  });

  if (subscription?.despachoTier === newTier) {
    return { success: false, error: `Ya tienes el tier ${newTier} activo` };
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

  const payment = await prisma.$transaction(async (tx) => {
    return (tx as typeof prisma).subscriptionPayment.create({
      data: {
        subscriptionId: subscription!.id,
        amountUsdCents: priceUsdCents,
        currency: "usd",
        status: "PENDING",
        metadata: { despachoTierUpgrade: newTier, companyId },
      },
    });
  });

  const invoice = await createNowPaymentsInvoice({
    priceAmountCents: priceUsdCents,
    orderId: payment.id,
    orderDescription: `ContaFlow Despacho ${newTier}`,
    ipnCallbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/nowpayments`,
  });

  await prisma.subscriptionPayment.update({
    where: { id: payment.id },
    data: { nowpaymentsOrderId: invoice.id },
  });

  return { success: true, paymentUrl: invoice.invoice_url };
}
