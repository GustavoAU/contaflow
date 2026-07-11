"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { PaymentMethod } from "@prisma/client";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { limiters } from "@/lib/ratelimit";
import {
  CreateBatchSchema,
  ApplyBatchSchema,
  VoidBatchSchema,
  DiscardBatchSchema,
} from "../schemas/payment-batch.schema";
import { PaymentBatchService, PaymentBatchSummary } from "../services/PaymentBatchService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

export type UnpaidPurchaseInvoice = {
  id: string;
  invoiceNumber: string;
  counterpartName: string;
  pendingAmount: string;
  totalAmountVes: string;
  date: string;
};

// ─── Crear lote DRAFT ─────────────────────────────────────────────────────────
export async function createPaymentBatchAction(
  input: unknown
): Promise<ActionResult<PaymentBatchSummary>> {
  try {
    const parsed = CreateBatchSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    const d = parsed.data;

    const ctx = await requireCompanyAction(d.companyId, {
      roles: ROLES.WRITERS,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

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
    revalidatePath(`/company/${d.companyId}/payments/batches`);
    return { success: true, data: result };
  } catch (err) {
    // Sanitización centralizada: errores técnicos de BD nunca llegan crudos al cliente.
    return toActionError(err);
  }
}

// ─── Aplicar lote DRAFT → APPLIED ────────────────────────────────────────────
export async function applyPaymentBatchAction(
  input: unknown
): Promise<ActionResult<PaymentBatchSummary>> {
  try {
    const parsed = ApplyBatchSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    const d = parsed.data;

    const ctx = await requireCompanyAction(d.companyId, {
      roles: ROLES.WRITERS,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const result = await PaymentBatchService.applyBatch({
      batchId: d.batchId,
      companyId: d.companyId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    revalidatePath(`/company/${d.companyId}/payments`);
    revalidatePath(`/company/${d.companyId}/payments/batches`);
    return { success: true, data: result };
  } catch (err) {
    // Sanitización centralizada: errores técnicos de BD nunca llegan crudos al cliente.
    return toActionError(err);
  }
}

// ─── Anular lote APPLIED → VOID ───────────────────────────────────────────────
export async function voidPaymentBatchAction(
  input: unknown
): Promise<ActionResult<PaymentBatchSummary>> {
  try {
    const parsed = VoidBatchSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    const d = parsed.data;

    const ctx = await requireCompanyAction(d.companyId, {
      roles: ROLES.WRITERS,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const result = await PaymentBatchService.voidBatch({
      batchId: d.batchId,
      companyId: d.companyId,
      userId: ctx.userId,
      voidReason: d.voidReason,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    revalidatePath(`/company/${d.companyId}/payments`);
    revalidatePath(`/company/${d.companyId}/payments/batches`);
    return { success: true, data: result };
  } catch (err) {
    // Sanitización centralizada: errores técnicos de BD nunca llegan crudos al cliente.
    return toActionError(err);
  }
}

// ─── Descartar lote DRAFT → soft-delete (HA-02) ──────────────────────────────
export async function discardPaymentBatchAction(
  input: unknown
): Promise<ActionResult<PaymentBatchSummary>> {
  try {
    const parsed = DiscardBatchSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    const d = parsed.data;

    const ctx = await requireCompanyAction(d.companyId, {
      roles: ROLES.WRITERS,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const result = await PaymentBatchService.discardBatch({
      batchId: d.batchId,
      companyId: d.companyId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    revalidatePath(`/company/${d.companyId}/payments`);
    revalidatePath(`/company/${d.companyId}/payments/batches`);
    return { success: true, data: result };
  } catch (err) {
    // Sanitización centralizada: errores técnicos de BD nunca llegan crudos al cliente.
    return toActionError(err);
  }
}

// ─── Obtener lote por ID ───────────────────────────────────────────────────────
export async function getPaymentBatchAction(
  companyId: string,
  batchId: string
): Promise<ActionResult<PaymentBatchSummary | null>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ALL });
    if (!ctx.ok) return ctx.error;

    const data = await PaymentBatchService.getById(batchId, companyId);
    return { success: true, data };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Listar lotes ─────────────────────────────────────────────────────────────
export async function listPaymentBatchesAction(
  companyId: string,
  cursor?: string
): Promise<ActionResult<{ batches: PaymentBatchSummary[]; nextCursor: string | null }>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ALL, limiter: limiters.read });
    if (!ctx.ok) return ctx.error;

    const data = await PaymentBatchService.list(companyId, cursor);
    return { success: true, data };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Listar facturas PURCHASE pendientes para selector de lote ────────────────
export async function listUnpaidPurchaseInvoicesAction(
  companyId: string
): Promise<ActionResult<UnpaidPurchaseInvoice[]>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS, limiter: limiters.read });
    if (!ctx.ok) return ctx.error;

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
  } catch (error) {
    return toActionError(error);
  }
}
