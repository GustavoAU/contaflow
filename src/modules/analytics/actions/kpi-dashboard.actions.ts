"use server";
// src/modules/analytics/actions/kpi-dashboard.actions.ts

import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
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
    // Lectura de KPIs del dashboard — limiter de lecturas (120/min por empresa×usuario),
    // no el fiscal (10/min).
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING, limiter: limiters.read });
    if (!ctx.ok) return ctx.error;

    const [summary, cashFlow] = await Promise.all([
      KpiDashboardService.getKpiSummary(companyId),
      KpiDashboardService.getCashFlowProjection(companyId),
    ]);
    return { success: true, data: { summary, cashFlow } };
  } catch (error) {
    return toActionError(error);
  }
}
