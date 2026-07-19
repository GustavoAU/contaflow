// src/modules/payroll/actions/employee-loan.actions.ts
// Server Actions para gestión de préstamos a empleados.
//
// Seguridad (ADR-041):
//   - requireCompanyAction: auth + rate limit + membresía (tenant) + net context
//   - create = ACCOUNTING o superior; approve/reject/cancel = ADMIN_ONLY
//   - R-6: ipAddress + userAgent (captureNet) en AuditLog en todo write

"use server";

import { revalidatePath } from "next/cache";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction, type GuardContext } from "@/lib/action-guard";
import { EmployeeLoanService, type EmployeeLoanRow } from "../services/EmployeeLoanService";
import { createLoanSchema, rejectLoanSchema } from "../schemas/employee-loan.schema";
import type { LoanStatus } from "@prisma/client";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// El service acepta `{ ipAddress?: string; userAgent?: string }`; el guard entrega
// `string | null` → normalizamos null a undefined. IP confiable `.at(-1)` (R-6, D-1).
function auditMeta(ctx: GuardContext) {
  return {
    ipAddress: ctx.ipAddress ?? undefined,
    userAgent: ctx.userAgent ?? undefined,
  };
}

function revalidateLoans(companyId: string) {
  revalidatePath(`/company/${companyId}/payroll/loans`);
  revalidatePath(`/company/${companyId}/payroll/employees`, "layout");
}

// ─── Crear préstamo (ACCOUNTING o superior) ────────────────────────────────────

export async function createLoanAction(
  companyId: string,
  rawInput: unknown,
): Promise<ActionResult<EmployeeLoanRow>> {
  const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY", limiter: limiters.fiscal, captureNet: true });
  if (!ctx.ok) return ctx.error;
  if (!canAccess(ctx.role, ROLES.ACCOUNTING)) return { success: false, error: "Permisos insuficientes." };

  const parsed = createLoanSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };

  try {
    const loan = await EmployeeLoanService.create(companyId, parsed.data, ctx.userId, auditMeta(ctx));
    revalidateLoans(companyId);
    return { success: true, data: loan };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Aprobar préstamo (ADMIN_ONLY) ─────────────────────────────────────────────

export async function approveLoanAction(
  companyId: string,
  loanId: string,
): Promise<ActionResult<EmployeeLoanRow>> {
  const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY", limiter: limiters.fiscal, captureNet: true });
  if (!ctx.ok) return ctx.error;
  if (!canAccess(ctx.role, ROLES.ADMIN_ONLY)) return { success: false, error: "Solo ADMIN u OWNER pueden aprobar préstamos." };

  try {
    const loan = await EmployeeLoanService.approve(companyId, loanId, ctx.userId, auditMeta(ctx));
    revalidateLoans(companyId);
    return { success: true, data: loan };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Rechazar préstamo (ADMIN_ONLY) ────────────────────────────────────────────

export async function rejectLoanAction(
  companyId: string,
  loanId: string,
  rawInput: unknown,
): Promise<ActionResult<EmployeeLoanRow>> {
  const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY", limiter: limiters.fiscal, captureNet: true });
  if (!ctx.ok) return ctx.error;
  if (!canAccess(ctx.role, ROLES.ADMIN_ONLY)) return { success: false, error: "Solo ADMIN u OWNER pueden rechazar préstamos." };

  const parsed = rejectLoanSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };

  try {
    const loan = await EmployeeLoanService.reject(companyId, loanId, ctx.userId, parsed.data.rejectionReason, auditMeta(ctx));
    revalidateLoans(companyId);
    return { success: true, data: loan };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Listar préstamos ─────────────────────────────────────────────────────────

export async function listLoansAction(
  companyId: string,
  filters?: { employeeId?: string; status?: LoanStatus },
): Promise<ActionResult<EmployeeLoanRow[]>> {
  const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY" });
  if (!ctx.ok) return ctx.error;
  if (!canAccess(ctx.role, ROLES.ACCOUNTING)) return { success: false, error: "Permisos insuficientes." };

  try {
    const loans = await EmployeeLoanService.list(companyId, filters);
    return { success: true, data: loans };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Cancelar préstamo (ADMIN_ONLY) ───────────────────────────────────────────

export async function cancelLoanAction(
  companyId: string,
  loanId: string,
): Promise<ActionResult<void>> {
  const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY", limiter: limiters.fiscal, captureNet: true });
  if (!ctx.ok) return ctx.error;
  if (!canAccess(ctx.role, ROLES.ADMIN_ONLY)) return { success: false, error: "Permisos insuficientes." };

  try {
    await EmployeeLoanService.cancel(companyId, loanId, ctx.userId, auditMeta(ctx));
    revalidateLoans(companyId);
    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}
