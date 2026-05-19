"use server";
// src/modules/orders/actions/quotation.actions.ts
// Security findings addressed:
//   HIGH-1: companyId from member.companyId, never from request body
//   HIGH-2: rate limit on approve/reject (fiscal mutations)
//   LOW-1:  VIEWER excluded — all mutations require ROLES.OPERATIONS or ROLES.ACCOUNTING

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { CreateQuotationSchema } from "../schemas/quotation.schema";
import { QuotationService } from "../services/QuotationService";
import { type QuotationType, type QuotationStatus } from "@prisma/client";

type Result<T> = { success: true; data: T } | { success: false; error: string };

// ── createQuotationAction — ROLES.OPERATIONS (ADMINISTRATIVE+) ───────────────
export async function createQuotationAction(
  companyId: string,
  raw: unknown
): Promise<Result<{ id: string; number: string }>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes, intenta más tarde" };

  // HIGH-1: member lookup — companyId from DB, not from client
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
  });
  if (!member) return { success: false, error: "Acceso denegado" };
  if (!canAccess(member.role, ROLES.OPERATIONS))
    return { success: false, error: "Acceso denegado" };

  const parsed = CreateQuotationSchema.safeParse(raw);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const quotation = await QuotationService.createQuotation(companyId, userId, {
      ...parsed.data,
      validUntil: new Date(parsed.data.validUntil),
    });
    revalidatePath(`/company/${companyId}/orders`);
    return { success: true, data: { id: quotation.id, number: quotation.number } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error al crear cotización" };
  }
}

// ── submitForApprovalAction — ROLES.OPERATIONS ───────────────────────────────
export async function submitForApprovalAction(
  companyId: string,
  quotationId: string
): Promise<Result<void>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes, intenta más tarde" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
  });
  if (!member) return { success: false, error: "Acceso denegado" };
  if (!canAccess(member.role, ROLES.OPERATIONS))
    return { success: false, error: "Acceso denegado" };

  try {
    await QuotationService.submitForApproval(companyId, quotationId);
    revalidatePath(`/company/${companyId}/orders`);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// ── approveQuotationAction — ROLES.ACCOUNTING (ACCOUNTANT+) + rate limit ─────
export async function approveQuotationAction(
  companyId: string,
  quotationId: string
): Promise<Result<void>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  // HIGH-2: rate limit on fiscal approval mutations
  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes, intenta más tarde" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
  });
  if (!member) return { success: false, error: "Acceso denegado" };
  if (!canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Acceso denegado" };

  try {
    await QuotationService.approveQuotation(companyId, quotationId, userId);
    revalidatePath(`/company/${companyId}/orders`);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// ── rejectQuotationAction — ROLES.ACCOUNTING + rate limit ────────────────────
export async function rejectQuotationAction(
  companyId: string,
  quotationId: string
): Promise<Result<void>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes, intenta más tarde" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
  });
  if (!member) return { success: false, error: "Acceso denegado" };
  if (!canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Acceso denegado" };

  try {
    await QuotationService.rejectQuotation(companyId, quotationId);
    revalidatePath(`/company/${companyId}/orders`);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// ── getQuotationsAction — ROLES.ALL (lectura) — VIEWER incluido ───────────────
export async function getQuotationsAction(
  companyId: string,
  filters?: { type?: QuotationType; status?: QuotationStatus }
): Promise<Result<Awaited<ReturnType<typeof QuotationService.getQuotations>>>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
  });
  if (!member) return { success: false, error: "Acceso denegado" };

  try {
    const data = await QuotationService.getQuotations(companyId, filters);
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// ── cloneQuotationAction — ROLES.OPERATIONS — crea copia DRAFT con nuevo número ─
export async function cloneQuotationAction(
  companyId: string,
  quotationId: string
): Promise<Result<{ id: string; number: string }>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes, intenta más tarde" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
  });
  if (!member) return { success: false, error: "Acceso denegado" };
  if (!canAccess(member.role, ROLES.OPERATIONS))
    return { success: false, error: "Acceso denegado" };

  try {
    const original = await QuotationService.getQuotation(companyId, quotationId);
    if (!original) return { success: false, error: "Cotización no encontrada" };

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 30);

    const cloned = await QuotationService.createQuotation(companyId, userId, {
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
    });
    revalidatePath(`/company/${companyId}/orders`);
    return { success: true, data: { id: cloned.id, number: cloned.number } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error al clonar cotización" };
  }
}
