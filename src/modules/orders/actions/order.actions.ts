"use server";
// src/modules/orders/actions/order.actions.ts
// Security findings addressed:
//   CRITICAL-1: orderId scoped to companyId in OrderService (findFirst with companyId)
//   CRITICAL-2: status === 'APPROVED' asserted atomically in $transaction
//   HIGH-1: companyId from member record, never from request body
//   HIGH-2: rate limit on approve + convert (fiscal mutations)
//   LOW-1:  VIEWER excluded from all mutations

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { CreateOrderSchema, ConvertOrderSchema } from "../schemas/order.schema";
import { OrderService } from "../services/OrderService";
import { type QuotationType, type OrderStatus } from "@prisma/client";

type Result<T> = { success: true; data: T } | { success: false; error: string };

// ── createOrderAction — ROLES.OPERATIONS ─────────────────────────────────────
export async function createOrderAction(
  companyId: string,
  raw: unknown
): Promise<Result<{ id: string; number: string }>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes, intenta más tarde" };

  // HIGH-1: member lookup — companyId is authoritative from DB
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
  });
  if (!member) return { success: false, error: "Acceso denegado" };
  if (!canAccess(member.role, ROLES.OPERATIONS))
    return { success: false, error: "Acceso denegado" };

  const parsed = CreateOrderSchema.safeParse(raw);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const order = await OrderService.createOrder(companyId, userId, {
      ...parsed.data,
      expectedDate: parsed.data.expectedDate
        ? new Date(parsed.data.expectedDate)
        : undefined,
    });
    revalidatePath(`/company/${companyId}/orders`);
    return { success: true, data: { id: order.id, number: order.number } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error al crear orden" };
  }
}

// ── approveOrderAction — ROLES.ACCOUNTING + rate limit ───────────────────────
export async function approveOrderAction(
  companyId: string,
  orderId: string
): Promise<Result<void>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  // HIGH-2: rate limit
  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes, intenta más tarde" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
  });
  if (!member) return { success: false, error: "Acceso denegado" };
  if (!canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Acceso denegado" };

  try {
    // CRITICAL-1: companyId guard enforced inside OrderService.approveOrder
    await OrderService.approveOrder(companyId, orderId, userId);
    revalidatePath(`/company/${companyId}/orders`);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error al aprobar orden" };
  }
}

// ── convertOrderToInvoiceAction — ROLES.ACCOUNTING + rate limit ──────────────
// CRITICAL-1: OrderService.convertOrderToInvoice uses findFirst({where:{id,companyId}})
// CRITICAL-2: status === 'APPROVED' asserted atomically inside $transaction
// MEDIUM-1:   AuditLog inside same $transaction in OrderService
export async function convertOrderToInvoiceAction(
  companyId: string,
  raw: unknown
): Promise<Result<{ invoiceId: string }>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  // HIGH-2: rate limit on conversion (creates an Invoice)
  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes, intenta más tarde" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
  });
  if (!member) return { success: false, error: "Acceso denegado" };
  if (!canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Acceso denegado" };

  const parsed = ConvertOrderSchema.safeParse(raw);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const result = await OrderService.convertOrderToInvoice(
      companyId,
      parsed.data.orderId,
      userId,
      {
        invoiceNumber: parsed.data.invoiceNumber,
        controlNumber: parsed.data.controlNumber,
        date: new Date(parsed.data.date),
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
        periodId: parsed.data.periodId,
      }
    );
    revalidatePath(`/company/${companyId}/orders`);
    revalidatePath(`/company/${companyId}/invoices`);
    return { success: true, data: result };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Error al convertir orden a factura",
    };
  }
}

// ── getOrdersAction — ROLES.ALL (lectura) ─────────────────────────────────────
export async function getOrdersAction(
  companyId: string,
  filters?: { type?: QuotationType; status?: OrderStatus }
): Promise<Result<Awaited<ReturnType<typeof OrderService.getOrders>>>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
  });
  if (!member) return { success: false, error: "Acceso denegado" };

  try {
    const data = await OrderService.getOrders(companyId, filters);
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// ── getOrderAction — ROLES.ALL (lectura) ──────────────────────────────────────
export async function getOrderAction(
  companyId: string,
  orderId: string
): Promise<Result<Awaited<ReturnType<typeof OrderService.getOrder>>>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
  });
  if (!member) return { success: false, error: "Acceso denegado" };

  try {
    // CRITICAL-1: companyId guard in service
    const data = await OrderService.getOrder(companyId, orderId);
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// ── cloneOrderAction — ROLES.OPERATIONS — crea copia DRAFT con nuevo número ────
export async function cloneOrderAction(
  companyId: string,
  orderId: string
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
    const original = await OrderService.getOrder(companyId, orderId);
    if (!original) return { success: false, error: "Orden no encontrada" };

    const cloned = await OrderService.createOrder(companyId, userId, {
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
    });
    revalidatePath(`/company/${companyId}/orders`);
    return { success: true, data: { id: cloned.id, number: cloned.number } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error al clonar orden" };
  }
}
