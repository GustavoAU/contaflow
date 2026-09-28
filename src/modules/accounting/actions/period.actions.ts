// src/modules/accounting/actions/period.actions.ts
"use server";

import { PeriodService } from "../services/PeriodService";
import { FiscalYearService } from "../services/FiscalYearService";
import { requireCompanyAction } from "@/lib/action-guard";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ADR-055: openPeriodAction/closePeriodAction (mes individual) se retiraron de la
// superficie pública — D-7. Usa fiscal-year.actions.ts (openFiscalYearAction) y
// fiscal-close.actions.ts (closeFiscalYearAction) en su lugar.

export type { ActiveFiscalPeriodInfo as ActivePeriodInfo } from "../services/FiscalYearService";

// ─── Obtener "período activo" (ADR-055: derivado del ejercicio activo) ─────────
//
// Ya no existe "el único período OPEN de la empresa" — un ejercicio abierto tiene
// sus 12 meses OPEN en paralelo. Lo que los callers necesitan (banner de estado,
// default de fecha en formularios) es: el mes de HOY si cae dentro del ejercicio
// activo, o si no, el mes más reciente de ese ejercicio (p. ej. para preseleccionar
// fecha al registrar algo con el ejercicio ya iniciado). `fiscalYear` es la etiqueta
// del ejercicio activo, para el indicador "Ejercicio activo: {año}" en el topbar.
// Lógica real vive en FiscalYearService.getActivePeriodInfo — fuente única (también
// la usa retentions/retention.actions.ts, ALERTA 20).
export async function getActivePeriodAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof FiscalYearService.getActivePeriodInfo>>>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY" });
    if (!ctx.ok) return ctx.error;
    const info = await FiscalYearService.getActivePeriodInfo(companyId);
    return { success: true, data: info };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Obtener todos los períodos (para /periods, agrupados en la UI por ejercicio) ─

export async function getPeriodsAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof PeriodService.getPeriods>>>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY" });
    if (!ctx.ok) return ctx.error;
    const periods = await PeriodService.getPeriods(companyId);
    return { success: true, data: periods };
  } catch (error) {
    return toActionError(error);
  }
}
