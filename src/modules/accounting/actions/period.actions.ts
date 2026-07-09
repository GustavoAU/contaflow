// src/modules/accounting/actions/period.actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PeriodService } from "../services/PeriodService";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const OpenPeriodSchema = z.object({
  companyId: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  userId: z.string().optional(), // kept for backward compat — action uses auth() userId
});

const ClosePeriodSchema = z.object({
  companyId: z.string().min(1),
  userId: z.string().optional(), // kept for backward compat — action uses auth() userId
});

// ─── Obtener período activo ───────────────────────────────────────────────────

export async function getActivePeriodAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof PeriodService.getActivePeriod>>>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY" });
    if (!ctx.ok) return ctx.error;
    const period = await PeriodService.getActivePeriod(companyId);
    return { success: true, data: period };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Obtener todos los períodos ───────────────────────────────────────────────

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

// ─── Abrir período ────────────────────────────────────────────────────────────

export async function openPeriodAction(
  input: z.infer<typeof OpenPeriodSchema>
): Promise<ActionResult<{ id: string; year: number; month: number }>> {
  try {
    const validated = OpenPeriodSchema.parse(input);

    const ctx = await requireCompanyAction(validated.companyId, {
      roles: ROLES.ADMIN_ONLY,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const period = await PeriodService.openPeriod(
      validated.companyId,
      validated.year,
      validated.month,
      ctx.userId,
      ctx.ipAddress,
      ctx.userAgent,
    );

    revalidatePath(`/company/${validated.companyId}/settings`);

    return { success: true, data: { id: period.id, year: period.year, month: period.month } };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Cerrar período ───────────────────────────────────────────────────────────

export async function closePeriodAction(
  input: z.infer<typeof ClosePeriodSchema>
): Promise<ActionResult<{ id: string }>> {
  try {
    const validated = ClosePeriodSchema.parse(input);

    const ctx = await requireCompanyAction(validated.companyId, {
      roles: ROLES.ADMIN_ONLY,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const period = await PeriodService.closePeriod(validated.companyId, ctx.userId, ctx.ipAddress, ctx.userAgent);

    revalidatePath(`/company/${validated.companyId}/settings`);

    return { success: true, data: { id: period.id } };
  } catch (error) {
    return toActionError(error);
  }
}
