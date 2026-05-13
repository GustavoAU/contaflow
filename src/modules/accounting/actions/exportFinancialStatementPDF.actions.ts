"use server";

// src/modules/accounting/actions/exportFinancialStatementPDF.actions.ts

import { auth } from "@clerk/nextjs/server";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import prisma from "@/lib/prisma";
import { getBalanceSheetAction, getIncomeStatementAction, getLedgerAction, getTrialBalanceAction } from "./report.actions";
import {
  generateBalanceSheetPDF,
  generateIncomeStatementPDF,
  generateLedgerPDF,
  generateTrialBalancePDF,
} from "../services/FinancialStatementsPDFService";

type PDFResult = { success: true; data: { pdf: string; filename: string } } | { success: false; error: string };

async function guardAccounting(companyId: string): Promise<{ userId: string; companyName: string; companyRif: string | null } | { success: false; error: string }> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

  const [member, company] = await Promise.all([
    prisma.companyMember.findFirst({ where: { companyId, userId }, select: { role: true } }),
    prisma.company.findFirst({ where: { id: companyId }, select: { name: true, rif: true } }),
  ]);

  if (!member || !canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Acceso denegado" };
  if (!company) return { success: false, error: "Empresa no encontrada" };

  return { userId, companyName: company.name, companyRif: company.rif };
}

// ─── Balance General ──────────────────────────────────────────────────────────

export async function exportBalanceSheetPDFAction(companyId: string): Promise<PDFResult> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  const reportResult = await getBalanceSheetAction(companyId);
  if (!reportResult.success) return { success: false, error: reportResult.error };

  if (!reportResult.data.isBalanced) {
    return {
      success: false,
      error:
        "El Balance General no está cuadrado (Activos ≠ Pasivos + Patrimonio). Revise los asientos contables antes de exportar.",
    };
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const buffer = await generateBalanceSheetPDF({
      companyName: guard.companyName,
      companyRif: guard.companyRif,
      dateTo: today,
      data: reportResult.data,
    });

    return {
      success: true,
      data: {
        pdf: buffer.toString("base64"),
        filename: `Balance-General-${today}.pdf`,
      },
    };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al generar el PDF" };
  }
}

// ─── Estado de Resultados ─────────────────────────────────────────────────────

export async function exportIncomeStatementPDFAction(companyId: string): Promise<PDFResult> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  const reportResult = await getIncomeStatementAction(companyId);
  if (!reportResult.success) return { success: false, error: reportResult.error };

  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${new Date().getFullYear()}-01-01`;

  try {
    const buffer = await generateIncomeStatementPDF({
      companyName: guard.companyName,
      companyRif: guard.companyRif,
      dateFrom: yearStart,
      dateTo: today,
      data: reportResult.data.current,
    });

    return {
      success: true,
      data: {
        pdf: buffer.toString("base64"),
        filename: `Estado-Resultados-${today}.pdf`,
      },
    };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al generar el PDF" };
  }
}

// ─── Balance de Comprobación ──────────────────────────────────────────────────

export async function exportTrialBalancePDFAction(companyId: string): Promise<PDFResult> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  const reportResult = await getTrialBalanceAction(companyId);
  if (!reportResult.success) return { success: false, error: reportResult.error };

  const today = new Date().toISOString().slice(0, 10);

  try {
    const buffer = await generateTrialBalancePDF({
      companyName: guard.companyName,
      companyRif: guard.companyRif,
      dateTo: today,
      data: reportResult.data,
    });

    return {
      success: true,
      data: {
        pdf: buffer.toString("base64"),
        filename: `Balance-Comprobacion-${today}.pdf`,
      },
    };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al generar el PDF" };
  }
}

// ─── Libro Mayor ──────────────────────────────────────────────────────────────

export async function exportLedgerPDFAction(
  companyId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<PDFResult> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  const reportResult = await getLedgerAction(
    companyId,
    dateFrom ? new Date(dateFrom) : undefined,
    dateTo ? new Date(dateTo + "T23:59:59") : undefined,
  );
  if (!reportResult.success) return { success: false, error: reportResult.error };

  const filename = `Libro-Mayor-${dateFrom ?? "todos"}-${dateTo ?? "hoy"}.pdf`;

  const generatedAt = new Date().toLocaleString("es-VE", {
    timeZone: "America/Caracas",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  try {
    const buffer = await generateLedgerPDF({
      companyName: guard.companyName,
      companyRif: guard.companyRif,
      dateFrom,
      dateTo,
      accounts: reportResult.data,
      generatedAt,
    });

    return {
      success: true,
      data: {
        pdf: buffer.toString("base64"),
        filename,
      },
    };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al generar el PDF del Libro Mayor" };
  }
}
