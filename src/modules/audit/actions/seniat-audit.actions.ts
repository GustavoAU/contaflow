"use server";

/**
 * seniat-audit.actions.ts — Fase 35H (ADR-019 D-3)
 *
 * Informes de auditoría para el rol SENIAT.
 * Solo lectura. Guard obligatorio: companyId + rol SENIAT.
 * Los queries filtran siempre por companyId — nunca retornan datos de otras empresas.
 */

import { auth } from "@clerk/nextjs/server";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import prisma from "@/lib/prisma";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

export interface InvoiceAuditEntry {
  invoiceNumber: string;
  controlNumber: string | null;
  type: string;
  date: string;
  counterpartName: string | null;
  counterpartRif: string | null;
  currency: string;
  totalAmount: string;
  status: string;
  submissionStatus: string | null;
  submittedAt: string | null;
}

export interface CashAuditEntry {
  date: string;
  description: string;
  amount: string;
  currency: string;
  paymentMethod: string;
}

export interface InvoiceAuditReport {
  entries: InvoiceAuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CashAuditReport {
  entries: CashAuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Guard compartido ─────────────────────────────────────────────────────────

async function guardSeniatAccess(companyId: string) {
  const { userId } = await auth();
  if (!userId) return null;

  const member = await prisma.companyMember.findUnique({
    where: { userId_companyId: { userId, companyId } },
    select: { role: true },
  });

  if (!member) return null;
  if (!canAccess(member.role, [...ROLES.ADMIN_ONLY, ...ROLES.SENIAT_READ])) return null;

  return member;
}

// ─── Informe de facturas (Libro de Ventas SENIAT) ─────────────────────────────

export async function getInvoiceAuditReportAction(
  companyId: string,
  page = 1,
  pageSize = 50
): Promise<ActionResult<InvoiceAuditReport>> {
  try {
    const member = await guardSeniatAccess(companyId);
    if (!member) return { success: false, error: "No autorizado" };

    const skip = (page - 1) * pageSize;

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where: { companyId },
        select: {
          invoiceNumber: true,
          controlNumber: true,
          type: true,
          date: true,
          counterpartName: true,
          counterpartRif: true,
          currency: true,
          totalAmountVes: true,
          deletedAt: true,
          seniatSubmission: {
            select: { status: true, sentAt: true },
          },
        },
        orderBy: { date: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.invoice.count({ where: { companyId } }),
    ]);

    const entries: InvoiceAuditEntry[] = invoices.map((inv) => ({
      invoiceNumber: inv.invoiceNumber,
      controlNumber: inv.controlNumber ?? null,
      type: inv.type,
      date: inv.date.toISOString().split("T")[0],
      counterpartName: inv.counterpartName ?? null,
      counterpartRif: inv.counterpartRif ?? null,
      currency: inv.currency,
      totalAmount: inv.totalAmountVes?.toString() ?? "0",
      status: inv.deletedAt ? "ANULADA" : "VIGENTE",
      submissionStatus: inv.seniatSubmission?.status ?? null,
      submittedAt: inv.seniatSubmission?.sentAt?.toISOString() ?? null,
    }));

    return { success: true, data: { entries, total, page, pageSize } };
  } catch {
    return { success: false, error: "Error al obtener el informe de facturas" };
  }
}

// ─── Informe de caja (Registro de Caja SENIAT) ───────────────────────────────

export async function getCashAuditReportAction(
  companyId: string,
  page = 1,
  pageSize = 50
): Promise<ActionResult<CashAuditReport>> {
  try {
    const member = await guardSeniatAccess(companyId);
    if (!member) return { success: false, error: "No autorizado" };

    const skip = (page - 1) * pageSize;

    const [payments, total] = await Promise.all([
      prisma.paymentRecord.findMany({
        where: { companyId },
        select: {
          date: true,
          notes: true,
          amountVes: true,
          currency: true,
          method: true,
        },
        orderBy: { date: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.paymentRecord.count({ where: { companyId } }),
    ]);

    const entries: CashAuditEntry[] = payments.map((p) => ({
      date: p.date.toISOString().split("T")[0],
      description: p.notes ?? "Pago",
      amount: p.amountVes.toString(),
      currency: p.currency,
      paymentMethod: p.method,
    }));

    return { success: true, data: { entries, total, page, pageSize } };
  } catch {
    return { success: false, error: "Error al obtener el informe de caja" };
  }
}
