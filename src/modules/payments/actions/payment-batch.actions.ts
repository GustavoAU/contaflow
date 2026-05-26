"use server";

import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { PaymentMethod } from "@prisma/client";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import {
  CreateBatchSchema,
  ApplyBatchSchema,
  VoidBatchSchema,
} from "../schemas/payment-batch.schema";
import { PaymentBatchService, PaymentBatchSummary } from "../services/PaymentBatchService";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export type UnpaidPurchaseInvoice = {
  id: string;
  invoiceNumber: string;
  counterpartName: string;
  pendingAmount: string;
  totalAmountVes: string;
  date: string;
};

async function getAuthContext() {
  const { userId } = await auth();
  if (!userId) return null;

  const h = await headers();
  const ipAddress =
    h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

  return { userId, ipAddress, userAgent };
}

// ─── Crear lote DRAFT ─────────────────────────────────────────────────────────
export async function createPaymentBatchAction(
  input: unknown
): Promise<ActionResult<PaymentBatchSummary>> {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(ctx.userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const parsed = CreateBatchSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    const d = parsed.data;

    const member = await prisma.companyMember.findFirst({
      where: { companyId: d.companyId, userId: ctx.userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.WRITERS)) return { success: false, error: "No autorizado" };

    const dateObj = new Date(d.date + "T00:00:00.000Z");

    const result = await PaymentBatchService.createBatch({
      companyId: d.companyId,
      method: d.method as PaymentMethod,
      totalAmountVes: new Decimal(d.totalAmountVes),
      currency: d.currency,
      totalAmountOriginal: d.totalAmountOriginal ? new Decimal(d.totalAmountOriginal) : undefined,
      exchangeRateId: d.exchangeRateId,
      referenceNumber: d.referenceNumber,
      originBank: d.originBank,
      destBank: d.destBank,
      commissionPct: d.commissionPct ? new Decimal(d.commissionPct) : undefined,
      commissionAmount: d.commissionAmount ? new Decimal(d.commissionAmount) : undefined,
      totalIgtfAmount: d.totalIgtfAmount ? new Decimal(d.totalIgtfAmount) : undefined,
      date: dateObj,
      notes: d.notes,
      createdBy: ctx.userId,
      idempotencyKey: d.idempotencyKey,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      bankAccountId: d.bankAccountId ?? null, // ADR-030
      lines: d.lines.map((l) => ({
        invoiceId: l.invoiceId,
        amountVes: new Decimal(l.amountVes),
        amountOriginal: l.amountOriginal ? new Decimal(l.amountOriginal) : undefined,
        igtfAmount: l.igtfAmount ? new Decimal(l.igtfAmount) : undefined,
        notes: l.notes,
      })),
    });

    revalidatePath(`/company/${d.companyId}/payments`);
    return { success: true, data: result };
  } catch (err) {
    if (err instanceof Error) {
      const raw = err.message;
      if (raw.includes("Transaction") || raw.includes("Prisma") || raw.includes("connect")) {
        return { success: false, error: "Error al crear el lote. Intente nuevamente." };
      }
      return { success: false, error: raw };
    }
    return { success: false, error: "Error al crear el lote" };
  }
}

// ─── Aplicar lote DRAFT → APPLIED ────────────────────────────────────────────
export async function applyPaymentBatchAction(
  input: unknown
): Promise<ActionResult<PaymentBatchSummary>> {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(ctx.userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const parsed = ApplyBatchSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    const d = parsed.data;

    const member = await prisma.companyMember.findFirst({
      where: { companyId: d.companyId, userId: ctx.userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.WRITERS)) return { success: false, error: "No autorizado" };

    const result = await PaymentBatchService.applyBatch({
      batchId: d.batchId,
      companyId: d.companyId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    revalidatePath(`/company/${d.companyId}/payments`);
    return { success: true, data: result };
  } catch (err) {
    if (err instanceof Error) {
      const raw = err.message;
      if (raw.includes("Transaction") || raw.includes("Prisma") || raw.includes("connect")) {
        return { success: false, error: "Error al aplicar el lote. Intente nuevamente." };
      }
      return { success: false, error: raw };
    }
    return { success: false, error: "Error al aplicar el lote" };
  }
}

// ─── Anular lote APPLIED → VOID ───────────────────────────────────────────────
export async function voidPaymentBatchAction(
  input: unknown
): Promise<ActionResult<PaymentBatchSummary>> {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(ctx.userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const parsed = VoidBatchSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    const d = parsed.data;

    const member = await prisma.companyMember.findFirst({
      where: { companyId: d.companyId, userId: ctx.userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.WRITERS)) return { success: false, error: "No autorizado" };

    const result = await PaymentBatchService.voidBatch({
      batchId: d.batchId,
      companyId: d.companyId,
      userId: ctx.userId,
      voidReason: d.voidReason,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    revalidatePath(`/company/${d.companyId}/payments`);
    return { success: true, data: result };
  } catch (err) {
    if (err instanceof Error) {
      const raw = err.message;
      if (raw.includes("Transaction") || raw.includes("Prisma") || raw.includes("connect")) {
        return { success: false, error: "Error al anular el lote. Intente nuevamente." };
      }
      return { success: false, error: raw };
    }
    return { success: false, error: "Error al anular el lote" };
  }
}

// ─── Obtener lote por ID ───────────────────────────────────────────────────────
export async function getPaymentBatchAction(
  companyId: string,
  batchId: string
): Promise<ActionResult<PaymentBatchSummary | null>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.ALL)) return { success: false, error: "No autorizado" };

    const data = await PaymentBatchService.getById(batchId, companyId);
    return { success: true, data };
  } catch {
    return { success: false, error: "Error al obtener el lote" };
  }
}

// ─── Listar lotes ─────────────────────────────────────────────────────────────
export async function listPaymentBatchesAction(
  companyId: string,
  cursor?: string
): Promise<ActionResult<{ batches: PaymentBatchSummary[]; nextCursor: string | null }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.ALL)) return { success: false, error: "No autorizado" };

    const data = await PaymentBatchService.list(companyId, cursor);
    return { success: true, data };
  } catch {
    return { success: false, error: "Error al obtener lotes" };
  }
}

// ─── Listar facturas PURCHASE pendientes para selector de lote ────────────────
export async function listUnpaidPurchaseInvoicesAction(
  companyId: string
): Promise<ActionResult<UnpaidPurchaseInvoice[]>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.WRITERS)) return { success: false, error: "No autorizado" };

    const invoices = await prisma.invoice.findMany({
      where: {
        companyId,
        type: "PURCHASE",
        deletedAt: null,
        paymentStatus: { in: ["UNPAID", "PARTIAL"] },
      },
      select: {
        id: true,
        invoiceNumber: true,
        counterpartName: true,
        pendingAmount: true,
        totalAmountVes: true,
        date: true,
      },
      orderBy: { date: "desc" },
      take: 100,
    });

    return {
      success: true,
      data: invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber ?? "",
        counterpartName: inv.counterpartName ?? "",
        pendingAmount: inv.pendingAmount ? inv.pendingAmount.toString() : (inv.totalAmountVes?.toString() ?? "0"),
        totalAmountVes: inv.totalAmountVes?.toString() ?? "0",
        date: inv.date.toISOString().slice(0, 10),
      })),
    };
  } catch {
    return { success: false, error: "Error al obtener facturas pendientes" };
  }
}
