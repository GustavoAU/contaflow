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

export type ActivePeriodInfo = {
  id: string;
  year: number;
  month: number;
  openedAt: Date;
  fiscalYear: number;
};

// ─── Obtener "período activo" (ADR-055: derivado del ejercicio activo) ─────────
//
// Ya no existe "el único período OPEN de la empresa" — un ejercicio abierto tiene
// sus 12 meses OPEN en paralelo. Lo que los callers necesitan (banner de estado,
// default de fecha en formularios) es: el mes de HOY si cae dentro del ejercicio
// activo, o si no, el mes más reciente de ese ejercicio (p. ej. para preseleccionar
// fecha al registrar algo con el ejercicio ya iniciado). `fiscalYear` es la etiqueta
// del ejercicio activo, para el indicador "Ejercicio activo: {año}" en el topbar.
export async function getActivePeriodAction(
  companyId: string
): Promise<ActionResult<ActivePeriodInfo | null>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY" });
    if (!ctx.ok) return ctx.error;

    const fiscalYear = await FiscalYearService.getActiveFiscalYear(companyId);
    if (!fiscalYear || fiscalYear.periods.length === 0) {
      return { success: true, data: null };
    }

    const today = new Date();
    const ty = today.getUTCFullYear();
    const tm = today.getUTCMonth() + 1;

    const current = fiscalYear.periods.find(
      (p) => p.year === ty && p.month === tm && p.status === "OPEN"
    );
    const mostRecent = [...fiscalYear.periods].sort(
      (a, b) =>
        FiscalYearService.chronologicalKey(fiscalYear.year, fiscalYear.startMonth, b) -
        FiscalYearService.chronologicalKey(fiscalYear.year, fiscalYear.startMonth, a)
    )[0];
    const chosen = current ?? mostRecent;

    return {
      success: true,
      data: {
        id: chosen.id,
        year: chosen.year,
        month: chosen.month,
        openedAt: fiscalYear.openedAt,
        fiscalYear: fiscalYear.year,
      },
    };
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
