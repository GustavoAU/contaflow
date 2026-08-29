"use server";
// src/modules/payroll/actions/overtime.actions.ts
// LOTTT Art. 183 — registro de horas extraordinarias.
//
// Escritura ACCOUNTING y no ADMIN_ONLY a propósito: el registro lo lleva quien
// administra la nómina día a día, y un registro que sólo puede tocar el dueño de
// la empresa no se lleva. El Art. 183 castiga que NO exista o que no se lleve
// conforme a la Ley — invirtiendo la carga de la prueba a favor del trabajador —,
// así que la fricción de más aquí juega en contra.

import { revalidatePath } from "next/cache";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { hasModuleAccess, moduleAccessError } from "@/lib/module-access";
import { CreateOvertimeEntrySchema } from "../schemas/overtime.schema";
import { OvertimeService } from "../services/OvertimeService";
import type { OvertimeEntryRow } from "../services/OvertimeService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

function revalidate(companyId: string) {
  revalidatePath(`/company/${companyId}/payroll/overtime`);
  revalidatePath(`/company/${companyId}/payroll/runs`);
}

// ── listOvertimeAction — ACCOUNTING ──────────────────────────────────────────
export async function listOvertimeAction(
  companyId: string,
  filters?: { employeeId?: string; from?: string; to?: string },
): Promise<ActionResult<OvertimeEntryRow[]>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;
  // Consistencia con el resto del modulo (createPayrollRunAction, approve,
  // cancel). Hoy es no-op —los baseRoles de `payroll` coinciden con ACCOUNTING—
  // pero el dia que se estrechen, estas tres actions no quedan abiertas solas.
  if (!await hasModuleAccess(companyId, ctx.role, "payroll"))
    return { success: false, error: moduleAccessError("payroll") };

  try {
    const rows = await OvertimeService.list(companyId, {
      employeeId: filters?.employeeId,
      from: filters?.from ? new Date(`${filters.from}T00:00:00.000Z`) : undefined,
      to: filters?.to ? new Date(`${filters.to}T00:00:00.000Z`) : undefined,
    });
    return { success: true, data: rows };
  } catch (err) {
    return toActionError(err);
  }
}

// ── createOvertimeAction — ACCOUNTING ────────────────────────────────────────
export async function createOvertimeAction(
  companyId: string,
  rawInput: unknown,
): Promise<ActionResult<OvertimeEntryRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ACCOUNTING,
    limiter: limiters.fiscal,
    // R-6: el registro sustenta un pago salarial. IP y user-agent al AuditLog.
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  // Consistencia con el resto del modulo (createPayrollRunAction, approve,
  // cancel). Hoy es no-op —los baseRoles de `payroll` coinciden con ACCOUNTING—
  // pero el dia que se estrechen, estas tres actions no quedan abiertas solas.
  if (!await hasModuleAccess(companyId, ctx.role, "payroll"))
    return { success: false, error: moduleAccessError("payroll") };

  const parsed = CreateOvertimeEntrySchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const row = await OvertimeService.create(
      companyId, ctx.userId, parsed.data, ctx.ipAddress, ctx.userAgent,
    );
    revalidate(companyId);
    return { success: true, data: row };
  } catch (err) {
    return toActionError(err);
  }
}

// ── deleteOvertimeAction — ACCOUNTING ────────────────────────────────────────
export async function deleteOvertimeAction(
  companyId: string,
  entryId: string,
): Promise<ActionResult<null>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ACCOUNTING,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  // Consistencia con el resto del modulo (createPayrollRunAction, approve,
  // cancel). Hoy es no-op —los baseRoles de `payroll` coinciden con ACCOUNTING—
  // pero el dia que se estrechen, estas tres actions no quedan abiertas solas.
  if (!await hasModuleAccess(companyId, ctx.role, "payroll"))
    return { success: false, error: moduleAccessError("payroll") };

  try {
    await OvertimeService.delete(companyId, ctx.userId, entryId, ctx.ipAddress, ctx.userAgent);
    revalidate(companyId);
    return { success: true, data: null };
  } catch (err) {
    return toActionError(err);
  }
}
