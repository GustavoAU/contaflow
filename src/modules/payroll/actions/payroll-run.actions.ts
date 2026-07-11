// src/modules/payroll/actions/payroll-run.actions.ts
// Fase NOM-C: Server Actions para procesos de nómina
//
// Seguridad (ADR-013):
//   NOM-C-01: companyMember.findFirst verifica tenant antes de toda query // ADR-004-EXCEPTION: IDOR guard — where:{userId,companyId} en resolveAuth()
//   NOM-C-02: P2002 del @@unique mapeado a mensaje amigable
//   NOM-C-08: checkRateLimit(limiters.fiscal) en create/approve/cancel
//   NOM-C-09: create/approve/cancel = ADMIN_ONLY; list/get = ACCOUNTING
//   Patrón: auth → role → rateLimit → parse → service

"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { ROLES } from "@/lib/auth-helpers";
import { hasModuleAccess, moduleAccessError } from "@/lib/module-access";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { PayrollRunService, type PayrollRunRow, type PayrollRunDetailRow } from "../services/PayrollRunService";
import { PayrollBankTxtService, type BankPaymentFile } from "../services/PayrollBankTxtService";
import {
  CreatePayrollRunSchema,
  ApprovePayrollRunSchema,
  CancelPayrollRunSchema,
} from "../schemas/payroll-run.schema";

// ─── Tipos ────────────────────────────────────────────────────────────────────

import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

function revalidate(companyId: string) {
  revalidatePath(`/company/${companyId}/payroll/runs`);
}

// ─── getPayrollRunsAction — ACCOUNTING ────────────────────────────────────────
export async function getPayrollRunsAction(
  companyId: string
): Promise<ActionResult<PayrollRunRow[]>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

  try {
    const runs = await PayrollRunService.list(companyId);
    return { success: true, data: runs };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── getPayrollRunDetailAction — ACCOUNTING ───────────────────────────────────
// NOM-C-01: IDOR guard via findFirst en PayrollRunService.getById
export async function getPayrollRunDetailAction(
  companyId: string,
  runId: string
): Promise<ActionResult<PayrollRunDetailRow>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

  try {
    const run = await PayrollRunService.getById(companyId, runId);
    if (!run) return { success: false, error: "Proceso de nómina no encontrado" };
    return { success: true, data: run };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── createPayrollRunAction — ADMIN_ONLY ──────────────────────────────────────
// NOM-C-08: rate limit fiscal
// NOM-C-09: ADMIN_ONLY
// NOM-C-02: P2002 mapeado a mensaje amigable
export async function createPayrollRunAction(
  companyId: string,
  rawInput: unknown
): Promise<ActionResult<PayrollRunRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  // ADR-025: verifica acceso base + grants granulares al módulo Nómina (check extra tras el guard)
  if (!await hasModuleAccess(companyId, ctx.role, "payroll"))
    return { success: false, error: moduleAccessError("payroll") };

  const parsed = CreatePayrollRunSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const run = await PayrollRunService.create(companyId, ctx.userId, parsed.data, ctx.ipAddress, ctx.userAgent);
    revalidate(companyId);
    return { success: true, data: run };
  } catch (err) {
    // NOM-C-02: P2002 del @@unique([companyId, periodStart, periodEnd])
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        success: false,
        error: "Ya existe un proceso de nómina para este período. Revisa los borradores existentes.",
      };
    }
    return toActionError(err);
  }
}

// ─── approvePayrollRunAction — ADMIN_ONLY ─────────────────────────────────────
// NOM-C-03: mutex en PayrollRunService.approve (updateMany status:'DRAFT')
// NOM-C-08: rate limit fiscal
// NOM-C-09: ADMIN_ONLY
export async function approvePayrollRunAction(
  companyId: string,
  rawInput: unknown
): Promise<ActionResult<PayrollRunRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  // ADR-025: verifica acceso base + grants granulares al módulo Nómina (check extra tras el guard)
  if (!await hasModuleAccess(companyId, ctx.role, "payroll"))
    return { success: false, error: moduleAccessError("payroll") };

  const parsed = ApprovePayrollRunSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const run = await PayrollRunService.approve(companyId, ctx.userId, parsed.data.runId, ctx.ipAddress, ctx.userAgent);
    revalidate(companyId);
    return { success: true, data: run };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── cancelPayrollRunAction — ADMIN_ONLY ──────────────────────────────────────
// NOM-C-04: solo DRAFT es cancelable — guard en PayrollRunService.cancel
// NOM-C-08: rate limit fiscal
// NOM-C-09: ADMIN_ONLY
export async function cancelPayrollRunAction(
  companyId: string,
  rawInput: unknown
): Promise<ActionResult<PayrollRunRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  // ADR-025: verifica acceso base + grants granulares al módulo Nómina (check extra tras el guard)
  if (!await hasModuleAccess(companyId, ctx.role, "payroll"))
    return { success: false, error: moduleAccessError("payroll") };

  const parsed = CancelPayrollRunSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const run = await PayrollRunService.cancel(
      companyId,
      ctx.userId,
      parsed.data.runId,
      parsed.data.reason,
      ctx.ipAddress,
      ctx.userAgent
    );
    revalidate(companyId);
    return { success: true, data: run };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── exportPayrollBankTxtAction — ACCOUNTING ─────────────────────────────────
// Genera el archivo TXT de pago masivo bancario (Ítem 53).
// Accesible desde ACCOUNTING+ — cualquier rol que pueda ver la nómina puede
// generar el archivo de pago. El contenido lo descarga el cliente, no se persiste.
export async function exportPayrollBankTxtAction(
  companyId: string,
  runId: string,
): Promise<ActionResult<BankPaymentFile>> {
  // HIGH-06: rate limit en exportación de datos bancarios sensibles
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING, limiter: limiters.export });
  if (!ctx.ok) return ctx.error;

  try {
    const file = await PayrollBankTxtService.generate(companyId, runId);
    return { success: true, data: file };
  } catch (err) {
    return toActionError(err);
  }
}
