"use server";
// src/modules/orders/actions/quotation.actions.ts
// Security findings addressed:
//   HIGH-1: companyId from member.companyId, never from request body
//   HIGH-2: rate limit on approve/reject (fiscal mutations)
//   LOW-1:  VIEWER excluded — all mutations require ROLES.OPERATIONS or ROLES.ACCOUNTING
//
// ADR-041: módulo PILOTO de requireCompanyAction — el ritual auth → rate limit →
// member → rol (+ ip/ua para R-6) vive en src/lib/action-guard.ts, no aquí.

import { revalidatePath } from "next/cache";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { CreateQuotationSchema } from "../schemas/quotation.schema";
import { QuotationService } from "../services/QuotationService";
import { type QuotationType, type QuotationStatus } from "@prisma/client";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ── createQuotationAction — ROLES.OPERATIONS (ADMINISTRATIVE+) ───────────────
export async function createQuotationAction(
  companyId: string,
  raw: unknown
): Promise<ActionResult<{ id: string; number: string }>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.OPERATIONS,
    limiter: limiters.fiscal,
    captureNet: true, // AUD-01 (R-6)
  });
  if (!ctx.ok) return ctx.error;

  const parsed = CreateQuotationSchema.safeParse(raw);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const quotation = await QuotationService.createQuotation(
      companyId,
      ctx.userId,
      { ...parsed.data, validUntil: new Date(parsed.data.validUntil) },
      ctx.ipAddress,
      ctx.userAgent
    );
    revalidatePath(`/company/${companyId}/orders`);
    return { success: true, data: { id: quotation.id, number: quotation.number } };
  } catch (e) {
    return toActionError(e);
  }
}

// ── submitForApprovalAction — ROLES.OPERATIONS ───────────────────────────────
export async function submitForApprovalAction(
  companyId: string,
  quotationId: string
): Promise<ActionResult<void>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.OPERATIONS,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  try {
    await QuotationService.submitForApproval(
      companyId, quotationId, ctx.userId, ctx.ipAddress, ctx.userAgent
    );
    revalidatePath(`/company/${companyId}/orders`);
    return { success: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

// ── approveQuotationAction — ROLES.ACCOUNTING (ACCOUNTANT+) + rate limit ─────
export async function approveQuotationAction(
  companyId: string,
  quotationId: string
): Promise<ActionResult<void>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ACCOUNTING,
    limiter: limiters.fiscal, // HIGH-2
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  try {
    await QuotationService.approveQuotation(
      companyId, quotationId, ctx.userId, ctx.ipAddress, ctx.userAgent
    );
    revalidatePath(`/company/${companyId}/orders`);
    return { success: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

// ── rejectQuotationAction — ROLES.ACCOUNTING + rate limit ────────────────────
export async function rejectQuotationAction(
  companyId: string,
  quotationId: string
): Promise<ActionResult<void>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ACCOUNTING,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  try {
    await QuotationService.rejectQuotation(
      companyId, quotationId, ctx.userId, ctx.ipAddress, ctx.userAgent
    );
    revalidatePath(`/company/${companyId}/orders`);
    return { success: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

// ── getQuotationsAction — lectura (solo membresía, incluye SENIAT) ────────────
export async function getQuotationsAction(
  companyId: string,
  filters?: { type?: QuotationType; status?: QuotationStatus }
): Promise<ActionResult<Awaited<ReturnType<typeof QuotationService.getQuotations>>>> {
  const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY" });
  if (!ctx.ok) return ctx.error;

  try {
    const data = await QuotationService.getQuotations(companyId, filters);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── cloneQuotationAction — ROLES.OPERATIONS — crea copia DRAFT con nuevo número ─
export async function cloneQuotationAction(
  companyId: string,
  quotationId: string
): Promise<ActionResult<{ id: string; number: string }>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.OPERATIONS,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  try {
    const original = await QuotationService.getQuotation(companyId, quotationId);
    if (!original) return { success: false, error: "Cotización no encontrada" };

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 30);

    const cloned = await QuotationService.createQuotation(
      companyId,
      ctx.userId,
      {
        type: original.type,
        counterpartName: original.counterpartName,
        counterpartRif: original.counterpartRif ?? undefined,
        validUntil,
        notes: original.notes ?? undefined,
        currency: original.currency,
        items: original.items.map((i) => ({
          description: i.description,
          unit: i.unit,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          taxRate: i.taxRate,
        })),
      },
      ctx.ipAddress,
      ctx.userAgent
    );
    revalidatePath(`/company/${companyId}/orders`);
    return { success: true, data: { id: cloned.id, number: cloned.number } };
  } catch (e) {
    return toActionError(e);
  }
}
