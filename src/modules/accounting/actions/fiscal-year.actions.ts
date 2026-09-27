// src/modules/accounting/actions/fiscal-year.actions.ts
// ADR-055: Ejercicio Fiscal Anual — reemplaza openPeriodAction/closePeriodAction
// (mes individual, retirados de la superficie pública — D-7) por la apertura del
// ejercicio completo. El cierre sigue viviendo en fiscal-close.actions.ts
// (closeFiscalYearAction, sin cambio de firma — D-8).
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FiscalYearService } from "../services/FiscalYearService";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { limiters } from "@/lib/ratelimit";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

const OpenFiscalYearSchema = z.object({
  companyId: z.string().min(1),
  // Solo requerido para el PRIMER ejercicio de la empresa (bootstrap). Para los
  // siguientes, el año se calcula siempre en el servidor (D-10) — cualquier valor
  // enviado aquí se ignora si ya existe un FiscalYear previo.
  year: z.number().int().min(2000).max(2100).optional(),
});

// ─── Ejercicio activo (derivado — D-3) ─────────────────────────────────────────

export async function getActiveFiscalYearAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof FiscalYearService.getActiveFiscalYear>>>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY" });
    if (!ctx.ok) return ctx.error;
    const fiscalYear = await FiscalYearService.getActiveFiscalYear(companyId);
    return { success: true, data: fiscalYear };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Listar todos los ejercicios (para la UI de /periods) ──────────────────────

export async function getFiscalYearsAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof FiscalYearService.getFiscalYears>>>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY" });
    if (!ctx.ok) return ctx.error;
    const fiscalYears = await FiscalYearService.getFiscalYears(companyId);
    return { success: true, data: fiscalYears };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Abrir el ejercicio completo ────────────────────────────────────────────────

export async function openFiscalYearAction(
  input: z.infer<typeof OpenFiscalYearSchema>
): Promise<ActionResult<{ id: string; year: number; startMonth: number; periodCount: number }>> {
  try {
    const validated = OpenFiscalYearSchema.parse(input);

    // Mismo nivel de rol que el flujo que reemplaza (openPeriodAction era ADMIN_ONLY).
    const ctx = await requireCompanyAction(validated.companyId, {
      roles: ROLES.ADMIN_ONLY,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const fiscalYear = await FiscalYearService.openFiscalYear(
      validated.companyId,
      ctx.userId,
      validated.year,
      ctx.ipAddress,
      ctx.userAgent,
    );

    revalidatePath(`/company/${validated.companyId}/periods`);
    revalidatePath(`/company/${validated.companyId}/settings`);

    return {
      success: true,
      data: {
        id: fiscalYear.id,
        year: fiscalYear.year,
        startMonth: fiscalYear.startMonth,
        periodCount: fiscalYear.periods.length,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}
