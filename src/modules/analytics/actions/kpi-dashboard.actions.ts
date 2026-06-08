"use server";
// src/modules/analytics/actions/kpi-dashboard.actions.ts

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import {
  KpiDashboardService,
  type KpiSummary,
  type CashFlowProjection,
} from "../services/KpiDashboardService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

export type KpiDashboardData = {
  summary: KpiSummary;
  cashFlow: CashFlowProjection;
};

export async function getKpiDashboardAction(
  companyId: string,
): Promise<ActionResult<KpiDashboardData>> {
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
    if (!canAccess(member.role, ROLES.ACCOUNTING))
      return { success: false, error: "Se requiere rol Contador o superior" };

    const [summary, cashFlow] = await Promise.all([
      KpiDashboardService.getKpiSummary(companyId),
      KpiDashboardService.getCashFlowProjection(companyId),
    ]);
    return { success: true, data: { summary, cashFlow } };
  } catch (error) {
    return toActionError(error);
  }
}
