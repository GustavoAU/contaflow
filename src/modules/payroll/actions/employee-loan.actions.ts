// src/modules/payroll/actions/employee-loan.actions.ts
// Server Actions para gestión de préstamos a empleados.
//
// Seguridad:
//   - companyMember.findFirst verifica tenant antes de toda query // ADR-004-EXCEPTION: IDOR guard — where:{userId,companyId}
//   - create = ACCOUNTING o superior; approve/reject/cancel = ADMIN_ONLY
//   - checkRateLimit(limiters.fiscal) en toda acción write
//   - R-6: ipAddress + userAgent en AuditLog en todo write

"use server";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { EmployeeLoanService, type EmployeeLoanRow } from "../services/EmployeeLoanService";
import { createLoanSchema, rejectLoanSchema } from "../schemas/employee-loan.schema";
import type { LoanStatus } from "@prisma/client";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

async function resolveAuth(companyId: string) {
  const { userId } = await auth();
  if (!userId) return { userId: null, member: null };
  const member = await prisma.companyMember.findFirst({
    where: { userId, companyId },
  });
  return { userId, member };
}

async function getAuditMeta() {
  const hdrs = await headers();
  return {
    ipAddress: hdrs.get("x-forwarded-for") ?? hdrs.get("x-real-ip") ?? undefined,
    userAgent: hdrs.get("user-agent") ?? undefined,
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
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado." };
  if (!canAccess(member.role, ROLES.ACCOUNTING)) return { success: false, error: "Permisos insuficientes." };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Límite de solicitudes alcanzado. Intente más tarde." };

  const parsed = createLoanSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };

  try {
    const meta = await getAuditMeta();
    const loan = await EmployeeLoanService.create(companyId, parsed.data, userId, meta);
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
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado." };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) return { success: false, error: "Solo ADMIN u OWNER pueden aprobar préstamos." };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Límite de solicitudes alcanzado." };

  try {
    const meta = await getAuditMeta();
    const loan = await EmployeeLoanService.approve(companyId, loanId, userId, meta);
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
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado." };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) return { success: false, error: "Solo ADMIN u OWNER pueden rechazar préstamos." };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Límite de solicitudes alcanzado." };

  const parsed = rejectLoanSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };

  try {
    const meta = await getAuditMeta();
    const loan = await EmployeeLoanService.reject(companyId, loanId, userId, parsed.data.rejectionReason, meta);
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
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado." };
  if (!canAccess(member.role, ROLES.ACCOUNTING)) return { success: false, error: "Permisos insuficientes." };

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
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado." };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) return { success: false, error: "Permisos insuficientes." };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Límite de solicitudes alcanzado. Intente más tarde." };

  try {
    const meta = await getAuditMeta();
    await EmployeeLoanService.cancel(companyId, loanId, userId, meta);
    revalidateLoans(companyId);
    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}
