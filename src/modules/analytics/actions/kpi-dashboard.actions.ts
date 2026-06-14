"use server";
// src/modules/analytics/actions/kpi-dashboard.actions.ts

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters, fiscalKey } from "@/lib/ratelimit";
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

    // Lectura de KPIs del dashboard — limiter de lecturas (120/min por empresa×usuario),
    // no el fiscal (10/min).
    const rl = await checkRateLimit(fiscalKey(companyId, userId), limiters.read);
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
