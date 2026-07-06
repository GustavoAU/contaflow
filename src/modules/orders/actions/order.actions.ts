"use server";
// src/modules/orders/actions/order.actions.ts
// Security findings addressed:
//   CRITICAL-1: orderId scoped to companyId in OrderService (findFirst with companyId)
//   CRITICAL-2: status === 'APPROVED' asserted atomically in $transaction
//   HIGH-1: companyId from member record, never from request body
//   HIGH-2: rate limit on approve + convert (fiscal mutations)
//   LOW-1:  VIEWER excluded from all mutations
//
// ADR-041: módulo PILOTO de requireCompanyAction — el ritual auth → rate limit →
// member → rol (+ ip/ua para R-6) vive en src/lib/action-guard.ts, no aquí.

import { revalidatePath } from "next/cache";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { CreateOrderSchema, ConvertOrderSchema } from "../schemas/order.schema";
import { OrderService } from "../services/OrderService";
import { type QuotationType, type OrderStatus } from "@prisma/client";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ── createOrderAction — ROLES.OPERATIONS ─────────────────────────────────────
export async function createOrderAction(
  companyId: string,
  raw: unknown
): Promise<ActionResult<{ id: string; number: string }>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.OPERATIONS,
    limiter: limiters.fiscal,
    captureNet: true, // AUD-01 (R-6)
  });
  if (!ctx.ok) return ctx.error;

  const parsed = CreateOrderSchema.safeParse(raw);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const order = await OrderService.createOrder(
      companyId,
      ctx.userId,
      {
        ...parsed.data,
        expectedDate: parsed.data.expectedDate
          ? new Date(parsed.data.expectedDate)
          : undefined,
      },
      ctx.ipAddress,
      ctx.userAgent
    );
    revalidatePath(`/company/${companyId}/orders`);
    return { success: true, data: { id: order.id, number: order.number } };
  } catch (e) {
    return toActionError(e);
  }
}

// ── approveOrderAction — ROLES.ACCOUNTING + rate limit ───────────────────────
export async function approveOrderAction(
  companyId: string,
  orderId: string
): Promise<ActionResult<void>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ACCOUNTING,
    limiter: limiters.fiscal, // HIGH-2
    captureNet: true, // AUD-01 (R-6)
  });
  if (!ctx.ok) return ctx.error;

  try {
    // CRITICAL-1: companyId guard enforced inside OrderService.approveOrder
    await OrderService.approveOrder(companyId, orderId, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${companyId}/orders`);
    return { success: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

// ── convertOrderToInvoiceAction — ROLES.ACCOUNTING + rate limit ──────────────
// CRITICAL-1: OrderService.convertOrderToInvoice uses findFirst({where:{id,companyId}})
// CRITICAL-2: status === 'APPROVED' asserted atomically inside $transaction
// MEDIUM-1:   AuditLog inside same $transaction in OrderService
export async function convertOrderToInvoiceAction(
  companyId: string,
  raw: unknown
): Promise<ActionResult<{ invoiceId: string }>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ACCOUNTING,
    limiter: limiters.fiscal, // HIGH-2: la conversión crea una Invoice
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  const parsed = ConvertOrderSchema.safeParse(raw);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const result = await OrderService.convertOrderToInvoice(
      companyId,
      parsed.data.orderId,
      ctx.userId,
      {
        invoiceNumber: parsed.data.invoiceNumber,
        controlNumber: parsed.data.controlNumber,
        date: new Date(parsed.data.date),
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
        periodId: parsed.data.periodId,
      },
      ctx.ipAddress,
      ctx.userAgent
    );
    revalidatePath(`/company/${companyId}/orders`);
    revalidatePath(`/company/${companyId}/invoices`);
    return { success: true, data: result };
  } catch (e) {
    return toActionError(e);
  }
}

// ── getOrdersAction — lectura (solo membresía, sin canAccess — incluye SENIAT) ─
export async function getOrdersAction(
  companyId: string,
  filters?: { type?: QuotationType; status?: OrderStatus }
): Promise<ActionResult<Awaited<ReturnType<typeof OrderService.getOrders>>>> {
  const ctx = await requireCompanyAction(companyId, {});
  if (!ctx.ok) return ctx.error;

  try {
    const data = await OrderService.getOrders(companyId, filters);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── getOrderAction — lectura (solo membresía) ─────────────────────────────────
export async function getOrderAction(
  companyId: string,
  orderId: string
): Promise<ActionResult<Awaited<ReturnType<typeof OrderService.getOrder>>>> {
  const ctx = await requireCompanyAction(companyId, {});
  if (!ctx.ok) return ctx.error;

  try {
    // CRITICAL-1: companyId guard in service
    const data = await OrderService.getOrder(companyId, orderId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── cloneOrderAction — ROLES.OPERATIONS — crea copia DRAFT con nuevo número ────
export async function cloneOrderAction(
  companyId: string,
  orderId: string
): Promise<ActionResult<{ id: string; number: string }>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.OPERATIONS,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  try {
    const original = await OrderService.getOrder(companyId, orderId);
    if (!original) return { success: false, error: "Orden no encontrada" };

    const cloned = await OrderService.createOrder(
      companyId,
      ctx.userId,
      {
        type: original.type,
        counterpartName: original.counterpartName,
        counterpartRif: original.counterpartRif ?? undefined,
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
