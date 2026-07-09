"use server";
// src/modules/payroll/actions/legal-threshold.actions.ts
// Ítem 72: Server Actions para gestión de topes legales venezolanos.
//
// Seguridad:
//   - getLegalThresholdsAction: cualquier miembro (ROLES.ALL)
//   - createLegalThresholdAction / deleteLegalThresholdAction: ROLES.ACCOUNTING (OWNER+ADMIN+ACCOUNTANT)
//   - companyMember.findFirst siempre verifica pertenencia (IDOR guard)
//   - rate limit con limiters.fiscal en escrituras

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import Decimal from "decimal.js";
import { LegalThresholdService, type LegalThresholdRow } from "../services/LegalThresholdService";
import type { LegalThresholdType } from "@prisma/client";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

const CreateSchema = z.object({
  type: z.enum([
    "SALARY_MIN_VES", "UT_VALUE",
    "IVSS_OBR_RATE", "IVSS_PAT_RATE",
    "INCES_OBR_RATE", "INCES_PAT_RATE",
    "FAOV_OBR_RATE", "FAOV_PAT_RATE",
    "RPE_OBR_RATE", "RPE_PAT_RATE",
  ]),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD requerido"),
  value: z.string().refine((v) => {
    try { return new Decimal(v).gt(0); } catch { return false; }
  }, "Valor debe ser un número positivo"),
  notes: z.string().max(200).optional(),
});

// ── getLegalThresholdsAction ──────────────────────────────────────────────────
export async function getLegalThresholdsAction(
  companyId: string,
): Promise<ActionResult<LegalThresholdRow[]>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ALL });
    if (!ctx.ok) return ctx.error;
    const data = await LegalThresholdService.list(companyId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── createLegalThresholdAction — ROLES.ACCOUNTING + rate limit ───────────────
export async function createLegalThresholdAction(
  companyId: string,
  rawInput: unknown,
): Promise<ActionResult<LegalThresholdRow>> {
  try {
    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const parsed = CreateSchema.safeParse(rawInput);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    const { type, effectiveFrom, value, notes } = parsed.data;

    const data = await LegalThresholdService.create(companyId, {
      type: type as LegalThresholdType,
      effectiveFrom: new Date(effectiveFrom),
      value: new Decimal(value),
      notes,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    revalidatePath(`/payroll/legal-thresholds`);
    return { success: true, data };
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return { success: false, error: "Ya existe un registro para ese tipo y fecha de vigencia" };
    }
    return toActionError(e);
  }
}

// ── deleteLegalThresholdAction — ROLES.ACCOUNTING ────────────────────────────
export async function deleteLegalThresholdAction(
  companyId: string,
  id: string,
): Promise<ActionResult<void>> {
  try {
    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    await LegalThresholdService.delete(companyId, id, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/payroll/legal-thresholds`);
    return { success: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}
