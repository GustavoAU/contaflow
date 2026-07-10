"use server";
// src/modules/payroll/actions/employee.actions.ts
// Fase NOM-B: Server Actions para CRUD de empleados
//
// Security findings addressed (audit NOM-B 2026-04-15):
//   NOM-B-01 (CRITICAL): companyId verificado vía companyMember.findFirst
//   NOM-B-02 (CRITICAL): cédula única por empresa — P2002 → mensaje amigable
//   NOM-B-03 (HIGH):     SalaryHistory + AuditLog dentro de $transaction (en service)
//   NOM-B-04 (HIGH):     write = ADMIN_ONLY; read = WRITERS (todos menos VIEWER)

import { revalidatePath } from "next/cache";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import {
  CreateEmployeeSchema,
  UpdateEmployeeSchema,
  TerminateEmployeeSchema,
  AddSalarySchema,
} from "../schemas/employee.schema";
import { EmployeeService } from "../services/EmployeeService";
import type { EmployeeRow, EmployeeListRow, SalaryHistoryRow } from "../services/EmployeeService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";
import { isPrismaError } from "@/lib/prisma-errors";

function revalidate(companyId: string) {
  revalidatePath(`/company/${companyId}/payroll/employees`);
}

// ── listEmployeesAction ───────────────────────────────────────────────────────
export async function listEmployeesAction(
  companyId: string
): Promise<ActionResult<EmployeeListRow[]>> {
  try {
    // VIEWER no accede a datos de empleados (datos sensibles)
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS });
    if (!ctx.ok) return ctx.error;

    const rows = await EmployeeService.list(companyId);
    return { success: true, data: rows };
  } catch (e) {
    return toActionError(e);
  }
}

// ── getEmployeeAction ─────────────────────────────────────────────────────────
export async function getEmployeeAction(
  companyId: string,
  employeeId: string
): Promise<ActionResult<EmployeeRow | null>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS });
    if (!ctx.ok) return ctx.error;

    const emp = await EmployeeService.getById(companyId, employeeId);
    return { success: true, data: emp };
  } catch (e) {
    return toActionError(e);
  }
}

// ── createEmployeeAction — ADMIN_ONLY + rate limit ───────────────────────────
export async function createEmployeeAction(
  companyId: string,
  rawInput: unknown
): Promise<ActionResult<EmployeeRow>> {
  // NOM-B-04: solo ADMIN puede crear empleados
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  const parsed = CreateEmployeeSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const emp = await EmployeeService.create(companyId, ctx.userId, parsed.data, ctx.ipAddress, ctx.userAgent);
    revalidate(companyId);
    return { success: true, data: emp };
  } catch (err) {
    // NOM-B-02: P2002 → cédula duplicada
    if (isPrismaError(err, "P2002"))
      return { success: false, error: "Ya existe un empleado con esa cédula en esta empresa" };
    return toActionError(err);
  }
}

// ── updateEmployeeAction — ADMIN_ONLY ─────────────────────────────────────────
export async function updateEmployeeAction(
  companyId: string,
  employeeId: string,
  rawInput: unknown
): Promise<ActionResult<EmployeeRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  const parsed = UpdateEmployeeSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const emp = await EmployeeService.update(companyId, ctx.userId, employeeId, parsed.data, ctx.ipAddress, ctx.userAgent);
    revalidate(companyId);
    return { success: true, data: emp };
  } catch (err) {
    return toActionError(err);
  }
}

// ── terminateEmployeeAction — ADMIN_ONLY ──────────────────────────────────────
export async function terminateEmployeeAction(
  companyId: string,
  employeeId: string,
  rawInput: unknown
): Promise<ActionResult<EmployeeRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  const parsed = TerminateEmployeeSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const emp = await EmployeeService.terminate(companyId, ctx.userId, employeeId, parsed.data, ctx.ipAddress, ctx.userAgent);
    revalidate(companyId);
    return { success: true, data: emp };
  } catch (err) {
    return toActionError(err);
  }
}

// ── addSalaryAction — ADMIN_ONLY ──────────────────────────────────────────────
export async function addSalaryAction(
  companyId: string,
  employeeId: string,
  rawInput: unknown
): Promise<ActionResult<SalaryHistoryRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  const parsed = AddSalarySchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const entry = await EmployeeService.addSalary(companyId, ctx.userId, employeeId, parsed.data, ctx.ipAddress, ctx.userAgent);
    revalidate(companyId);
    return { success: true, data: entry };
  } catch (err) {
    return toActionError(err);
  }
}

// ── getSalaryHistoryAction ────────────────────────────────────────────────────
export async function getSalaryHistoryAction(
  companyId: string,
  employeeId: string
): Promise<ActionResult<SalaryHistoryRow[]>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS });
    if (!ctx.ok) return ctx.error;

    const rows = await EmployeeService.getSalaryHistory(companyId, employeeId);
    return { success: true, data: rows };
  } catch (e) {
    return toActionError(e);
  }
}
