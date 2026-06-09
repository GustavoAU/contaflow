"use server";
// src/modules/payroll/actions/employee.actions.ts
// Fase NOM-B: Server Actions para CRUD de empleados
//
// Security findings addressed (audit NOM-B 2026-04-15):
//   NOM-B-01 (CRITICAL): companyId verificado vía companyMember.findFirst
//   NOM-B-02 (CRITICAL): cédula única por empresa — P2002 → mensaje amigable
//   NOM-B-03 (HIGH):     SalaryHistory + AuditLog dentro de $transaction (en service)
//   NOM-B-04 (HIGH):     write = ADMIN_ONLY; read = WRITERS (todos menos VIEWER)

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveAuth(companyId: string) {
  const { userId } = await auth();
  if (!userId) return { userId: null, member: null };
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  return { userId, member };
}

function revalidate(companyId: string) {
  revalidatePath(`/company/${companyId}/payroll/employees`);
}

// ── listEmployeesAction ───────────────────────────────────────────────────────
export async function listEmployeesAction(
  companyId: string
): Promise<ActionResult<EmployeeListRow[]>> {
  try {
    const { userId, member } = await resolveAuth(companyId);
    if (!userId || !member) return { success: false, error: "No autorizado" };

    // VIEWER no accede a datos de empleados (datos sensibles)
    if (!canAccess(member.role, ROLES.WRITERS))
      return { success: false, error: "Acceso denegado" };

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
    const { userId, member } = await resolveAuth(companyId);
    if (!userId || !member) return { success: false, error: "No autorizado" };
    if (!canAccess(member.role, ROLES.WRITERS)) return { success: false, error: "Acceso denegado" };

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
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };

  // NOM-B-04: solo ADMIN puede crear empleados
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Solo el Administrador puede registrar empleados" };

  // Rate limit (datos fiscales)
  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed)
    return { success: false, error: "Demasiadas solicitudes. Intenta en unos minutos." };

  const parsed = CreateEmployeeSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

  try {
    const emp = await EmployeeService.create(companyId, userId, parsed.data, ipAddress, userAgent);
    revalidate(companyId);
    return { success: true, data: emp };
  } catch (err) {
    // NOM-B-02: P2002 → cédula duplicada
    if (err instanceof Error && err.message.includes("P2002"))
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
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Solo el Administrador puede modificar empleados" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed)
    return { success: false, error: "Demasiadas solicitudes. Intenta en unos minutos." };

  const parsed = UpdateEmployeeSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

  try {
    const emp = await EmployeeService.update(companyId, userId, employeeId, parsed.data, ipAddress, userAgent);
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
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Solo el Administrador puede registrar egresos" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed)
    return { success: false, error: "Demasiadas solicitudes. Intenta en unos minutos." };

  const parsed = TerminateEmployeeSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

  try {
    const emp = await EmployeeService.terminate(companyId, userId, employeeId, parsed.data, ipAddress, userAgent);
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
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Solo el Administrador puede modificar salarios" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed)
    return { success: false, error: "Demasiadas solicitudes. Intenta en unos minutos." };

  const parsed = AddSalarySchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

  try {
    const entry = await EmployeeService.addSalary(companyId, userId, employeeId, parsed.data, ipAddress, userAgent);
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
    const { userId, member } = await resolveAuth(companyId);
    if (!userId || !member) return { success: false, error: "No autorizado" };
    if (!canAccess(member.role, ROLES.WRITERS)) return { success: false, error: "Acceso denegado" };

    const rows = await EmployeeService.getSalaryHistory(companyId, employeeId);
    return { success: true, data: rows };
  } catch (e) {
    return toActionError(e);
  }
}
