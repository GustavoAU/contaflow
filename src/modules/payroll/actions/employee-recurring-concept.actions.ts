"use server";
// src/modules/payroll/actions/employee-recurring-concept.actions.ts
//
// Asignaciones fijas por trabajador (bono en divisas, cesta ticket, descuentos
// recurrentes). Escritura ACCOUNTING y no ADMIN_ONLY, igual que el registro de
// horas extra: lo lleva quien administra la nómina día a día, y algo que sólo
// puede tocar el dueño de la empresa termina no llevándose.

import { revalidatePath } from "next/cache";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { hasModuleAccess, moduleAccessError } from "@/lib/module-access";
import {
  CreateRecurringConceptSchema,
  EndRecurringConceptSchema,
} from "../schemas/employee-recurring-concept.schema";
import { EmployeeRecurringConceptService } from "../services/EmployeeRecurringConceptService";
import type { RecurringConceptRow } from "../services/EmployeeRecurringConceptService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

function revalidate(companyId: string) {
  revalidatePath(`/company/${companyId}/payroll/employees`);
  revalidatePath(`/company/${companyId}/payroll/runs`);
}

// ── listRecurringConceptsAction — ACCOUNTING ─────────────────────────────────
export async function listRecurringConceptsAction(
  companyId: string,
  employeeId?: string,
): Promise<ActionResult<RecurringConceptRow[]>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;
  if (!await hasModuleAccess(companyId, ctx.role, "payroll"))
    return { success: false, error: moduleAccessError("payroll") };

  try {
    const rows = await EmployeeRecurringConceptService.list(companyId, { employeeId });
    return { success: true, data: rows };
  } catch (err) {
    return toActionError(err);
  }
}

// ── createRecurringConceptAction — ACCOUNTING ────────────────────────────────
export async function createRecurringConceptAction(
  companyId: string,
  rawInput: unknown,
): Promise<ActionResult<RecurringConceptRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ACCOUNTING,
    limiter: limiters.fiscal,
    // R-6: decide un pago recurrente. IP y user-agent al AuditLog.
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  if (!await hasModuleAccess(companyId, ctx.role, "payroll"))
    return { success: false, error: moduleAccessError("payroll") };

  const parsed = CreateRecurringConceptSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const row = await EmployeeRecurringConceptService.create(
      companyId, ctx.userId, parsed.data, ctx.ipAddress, ctx.userAgent,
    );
    revalidate(companyId);
    return { success: true, data: row };
  } catch (err) {
    return toActionError(err);
  }
}

// ── endRecurringConceptAction — ACCOUNTING ───────────────────────────────────
export async function endRecurringConceptAction(
  companyId: string,
  rawInput: unknown,
): Promise<ActionResult<RecurringConceptRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ACCOUNTING,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  if (!await hasModuleAccess(companyId, ctx.role, "payroll"))
    return { success: false, error: moduleAccessError("payroll") };

  const parsed = EndRecurringConceptSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const row = await EmployeeRecurringConceptService.end(
      companyId, ctx.userId, parsed.data, ctx.ipAddress, ctx.userAgent,
    );
    revalidate(companyId);
    return { success: true, data: row };
  } catch (err) {
    return toActionError(err);
  }
}
