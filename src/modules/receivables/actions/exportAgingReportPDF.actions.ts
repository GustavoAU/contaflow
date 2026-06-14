"use server";

// src/modules/receivables/actions/exportAgingReportPDF.actions.ts

import { auth } from "@clerk/nextjs/server";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import prisma from "@/lib/prisma";
import { ReceivableService } from "../services/ReceivableService";
import { generateAgingReportPDF } from "../services/AgingReportPDFService";
import { mapPrismaError } from "@/lib/prisma-errors";
import type { ActionResult } from "../types/action-result";

type PDFResult = ActionResult<{ pdf: string; filename: string }>;

// ─── Guard compartido ─────────────────────────────────────────────────────────

async function guardReceivables(companyId: string) {
  const { userId } = await auth();
  if (!userId) return { success: false as const, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.read);
  if (!rl.allowed) return { success: false as const, error: "Demasiadas solicitudes. Intente más tarde." };

  const [member, company] = await Promise.all([
    prisma.companyMember.findFirst({ where: { companyId, userId }, select: { role: true } }),
    prisma.company.findFirst({ where: { id: companyId }, select: { name: true, rif: true } }),
  ]);

  // ADR-025: ROLES.ALL — CxC/CxP visible para todos los roles (incluye VIEWER)
  if (!member || !canAccess(member.role, ROLES.ALL))
    return { success: false as const, error: "Acceso denegado" };
  if (!company) return { success: false as const, error: "Empresa no encontrada" };

  return { success: true as const, companyName: company.name, companyRif: company.rif };
}

// ─── Exportar Antigüedad CxC ──────────────────────────────────────────────────

export async function exportReceivablesAgingPDFAction(
  companyId: string,
  asOf?: string
): Promise<PDFResult> {
  const guard = await guardReceivables(companyId);
  if (!guard.success) return guard;

  try {
    const asOfDate = asOf ? new Date(asOf) : new Date();
    const report = await ReceivableService.getReceivables(companyId, asOfDate);

    const buffer = await generateAgingReportPDF({
      report,
      companyName: guard.companyName,
      companyRif: guard.companyRif,
    });

    const dateStr = asOfDate.toISOString().slice(0, 10);
    return {
      success: true,
      data: {
        pdf: buffer.toString("base64"),
        filename: `Antigüedad-CxC-${dateStr}.pdf`,
      },
    };
  } catch (error) {
    return { success: false, error: mapPrismaError(error) };
  }
}

// ─── Exportar Antigüedad CxP ──────────────────────────────────────────────────

export async function exportPayablesAgingPDFAction(
  companyId: string,
  asOf?: string
): Promise<PDFResult> {
  const guard = await guardReceivables(companyId);
  if (!guard.success) return guard;

  try {
    const asOfDate = asOf ? new Date(asOf) : new Date();
    const report = await ReceivableService.getPayables(companyId, asOfDate);

    const buffer = await generateAgingReportPDF({
      report,
      companyName: guard.companyName,
      companyRif: guard.companyRif,
    });

    const dateStr = asOfDate.toISOString().slice(0, 10);
    return {
      success: true,
      data: {
        pdf: buffer.toString("base64"),
        filename: `Antigüedad-CxP-${dateStr}.pdf`,
      },
    };
  } catch (error) {
    return { success: false, error: mapPrismaError(error) };
  }
}
