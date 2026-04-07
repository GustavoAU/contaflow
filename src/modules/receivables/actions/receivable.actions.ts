// src/modules/receivables/actions/receivable.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { ReceivableService } from "../services/ReceivableService";
import type { AgingReport, InvoicePaymentSummary, ReceivablePage } from "../services/ReceivableService";
import {
  RecordPaymentSchema,
  CancelPaymentSchema,
  AgingReportFilterSchema,
  UpdatePaymentTermsSchema,
} from "../schemas/receivable.schema";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ─── Obtener cartera CxC (Aging) ───────────────────────────────────────────────
export async function getReceivablesAction(
  companyId: string,
  asOf?: string
): Promise<ActionResult<AgingReport>> {
  const parsed = AgingReportFilterSchema.safeParse({ companyId, type: "CXC", asOf });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };

    const report = await ReceivableService.getReceivables(companyId, parsed.data.asOf);
    return { success: true, data: report };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener la cartera CxC" };
  }
}

// ─── Obtener cartera CxP (Aging) ───────────────────────────────────────────────
export async function getPayablesAction(
  companyId: string,
  asOf?: string
): Promise<ActionResult<AgingReport>> {
  const parsed = AgingReportFilterSchema.safeParse({ companyId, type: "CXP", asOf });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };

    const report = await ReceivableService.getPayables(companyId, parsed.data.asOf);
    return { success: true, data: report };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener la cartera CxP" };
  }
}

// ─── Listado paginado CxC cursor-based ────────────────────────────────────────
export async function getReceivablesPaginatedAction(
  companyId: string,
  asOf: Date,
  cursor?: string,
  limit?: number
): Promise<ActionResult<ReceivablePage>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };

    const page = await ReceivableService.getReceivablesPaginated(companyId, asOf, cursor, limit);
    return { success: true, data: page };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener la cartera CxC paginada" };
  }
}

// ─── Listado paginado CxP cursor-based ────────────────────────────────────────
export async function getPayablesPaginatedAction(
  companyId: string,
  asOf: Date,
  cursor?: string,
  limit?: number
): Promise<ActionResult<ReceivablePage>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };

    const page = await ReceivableService.getPayablesPaginated(companyId, asOf, cursor, limit);
    return { success: true, data: page };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener la cartera CxP paginada" };
  }
}

// ─── Registrar pago sobre una factura ──────────────────────────────────────────
export async function recordPaymentAction(
  input: unknown
): Promise<ActionResult<InvoicePaymentSummary>> {
  const parsed = RecordPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error ?? "Límite de solicitudes alcanzado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (member.role === "VIEWER") return { success: false, error: "No autorizado" };

    const payment = await ReceivableService.recordPayment({
      ...parsed.data,
      createdBy: userId,
    });

    revalidatePath(`/company/${parsed.data.companyId}/receivables`);
    revalidatePath(`/company/${parsed.data.companyId}/payables`);
    return { success: true, data: payment };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("P2002")) {
        return { success: false, error: "Pago duplicado — ya existe un pago con esta clave de idempotencia" };
      }
      return { success: false, error: error.message };
    }
    return { success: false, error: "Error al registrar el pago" };
  }
}

// ─── Cancelar un pago ──────────────────────────────────────────────────────────
// Solo ADMIN u OWNER pueden cancelar pagos (operación de anulación — ADR-006 D-1)
export async function cancelPaymentAction(
  input: unknown
): Promise<ActionResult<{ ok: true }>> {
  const parsed = CancelPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!["OWNER", "ADMIN"].includes(member.role)) {
      return { success: false, error: "No autorizado" };
    }

    await ReceivableService.cancelPayment(parsed.data.paymentId, parsed.data.companyId, userId);

    revalidatePath(`/company/${parsed.data.companyId}/receivables`);
    revalidatePath(`/company/${parsed.data.companyId}/payables`);
    return { success: true, data: { ok: true } };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al cancelar el pago" };
  }
}

// ─── Obtener pagos de una factura ──────────────────────────────────────────────
export async function getPaymentsByInvoiceAction(
  invoiceId: string,
  companyId: string
): Promise<ActionResult<InvoicePaymentSummary[]>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };

    const payments = await ReceivableService.getPaymentsByInvoice(invoiceId, companyId);
    return { success: true, data: payments };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener los pagos" };
  }
}

// ─── Actualizar plazo de pago de empresa ───────────────────────────────────────
// Solo ADMIN puede cambiar la configuración de plazos
export async function updatePaymentTermsAction(
  input: unknown
): Promise<ActionResult<{ paymentTermDays: number }>> {
  const parsed = UpdatePaymentTermsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (member.role !== "ADMIN") {
      return { success: false, error: "Solo los administradores pueden cambiar el plazo de pago" };
    }

    const company = await prisma.company.update({
      where: { id: parsed.data.companyId },
      data: { paymentTermDays: parsed.data.paymentTermDays },
      select: { paymentTermDays: true },
    });

    await prisma.auditLog.create({
      data: {
        entityId: parsed.data.companyId,
        entityName: "Company",
        action: "UPDATE",
        userId,
        newValue: { paymentTermDays: parsed.data.paymentTermDays },
      },
    });

    revalidatePath(`/company/${parsed.data.companyId}/settings`);
    return { success: true, data: { paymentTermDays: company.paymentTermDays } };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al actualizar el plazo de pago" };
  }
}
