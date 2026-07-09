"use server";
// src/modules/payroll/actions/payroll-concept.actions.ts
// Fase NOM-B: Server Actions para conceptos de nómina
//
// Security findings:
//   NOM-B-01 (CRITICAL): companyId verificado vía companyMember
//   NOM-B-04 (HIGH):     write = ADMIN_ONLY; read = ACCOUNTING (contador necesita ver conceptos)

import { revalidatePath } from "next/cache";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { CreateConceptSchema, UpdateConceptSchema } from "../schemas/payroll-concept.schema";
import { PayrollConceptService } from "../services/PayrollConceptService";
import type { PayrollConceptRow } from "../services/PayrollConceptService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";
import { isPrismaError } from "@/lib/prisma-errors";

function revalidate(companyId: string) {
  revalidatePath(`/company/${companyId}/payroll/concepts`);
}

// ── listConceptsAction — ACCOUNTING (contador necesita verlos) ────────────────
export async function listConceptsAction(
  companyId: string
): Promise<ActionResult<PayrollConceptRow[]>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

  // Seed defaults si no existen aún (idempotente)
  await PayrollConceptService.seedDefaults(companyId);
  const concepts = await PayrollConceptService.list(companyId);
  return { success: true, data: concepts };
}

// ── createConceptAction — ADMIN_ONLY ─────────────────────────────────────────
export async function createConceptAction(
  companyId: string,
  rawInput: unknown
): Promise<ActionResult<PayrollConceptRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  const parsed = CreateConceptSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const concept = await PayrollConceptService.create(companyId, ctx.userId, parsed.data, ctx.ipAddress, ctx.userAgent);
    revalidate(companyId);
    return { success: true, data: concept };
  } catch (err) {
    if (isPrismaError(err, "P2002"))
      return { success: false, error: "Ya existe un concepto con ese código" };
    return toActionError(err);
  }
}

// ── updateConceptAction — ADMIN_ONLY ─────────────────────────────────────────
export async function updateConceptAction(
  companyId: string,
  conceptId: string,
  rawInput: unknown
): Promise<ActionResult<PayrollConceptRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  const parsed = UpdateConceptSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const concept = await PayrollConceptService.update(companyId, ctx.userId, conceptId, parsed.data, ctx.ipAddress, ctx.userAgent);
    revalidate(companyId);
    return { success: true, data: concept };
  } catch (err) {
    return toActionError(err);
  }
}

// ── deleteConceptAction — ADMIN_ONLY (solo no-sistema) ───────────────────────
export async function deleteConceptAction(
  companyId: string,
  conceptId: string
): Promise<ActionResult<{ deleted: true }>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  try {
    await PayrollConceptService.delete(companyId, ctx.userId, conceptId, ctx.ipAddress, ctx.userAgent);
    revalidate(companyId);
    return { success: true, data: { deleted: true } };
  } catch (err) {
    return toActionError(err);
  }
}
