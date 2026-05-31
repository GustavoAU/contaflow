// src/modules/budgets/actions/budget.actions.ts
// Q3-3: Presupuestos y Proyecciones — Server Actions.
// ADR-004: companyId guard en todos los handlers.

"use server";

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { BudgetService, type BudgetRow, type BudgetLineRow, type BudgetVsActualLine, type CashFlowProjection } from "../services/BudgetService";
import { CashFlowProjectionService } from "../services/CashFlowProjectionService";
import {
  CreateBudgetSchema,
  UpdateBudgetSchema,
  UpsertBudgetLineSchema,
  type CreateBudgetInput,
  type UpdateBudgetInput,
  type UpsertBudgetLineInput,
} from "../schemas/budget.schemas";

type Result<T> = { success: true; data: T } | { success: false; error: string };

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function resolveAccounting(companyId: string): Promise<{ userId: string; allowed: boolean }> {
  const { userId } = await auth();
  if (!userId) return { userId: "", allowed: false };
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ACCOUNTING)) return { userId, allowed: false };
  return { userId, allowed: true };
}

async function resolveWriters(companyId: string): Promise<{ userId: string; allowed: boolean }> {
  const { userId } = await auth();
  if (!userId) return { userId: "", allowed: false };
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.WRITERS)) return { userId, allowed: false };
  return { userId, allowed: true };
}

async function resolveAdmin(companyId: string): Promise<{ userId: string; allowed: boolean }> {
  const { userId } = await auth();
  if (!userId) return { userId: "", allowed: false };
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ADMIN_ONLY)) return { userId, allowed: false };
  return { userId, allowed: true };
}

// ── Budget CRUD ───────────────────────────────────────────────────────────────

export async function listBudgetsAction(companyId: string): Promise<Result<BudgetRow[]>> {
  try {
    // Read-only: ROLES.ALL (VIEWER incluido — solo consulta)
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };
    const member = await prisma.companyMember.findFirst({ where: { companyId, userId }, select: { role: true } });
    if (!member || !canAccess(member.role, ROLES.ALL)) return { success: false, error: "No autorizado" };
    const data = await BudgetService.list(companyId);
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

export async function getBudgetAction(
  companyId: string,
  budgetId: string,
): Promise<Result<BudgetRow>> {
  try {
    // Read-only: ROLES.ALL
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };
    const member = await prisma.companyMember.findFirst({ where: { companyId, userId }, select: { role: true } });
    if (!member || !canAccess(member.role, ROLES.ALL)) return { success: false, error: "No autorizado" };
    const data = await BudgetService.get(companyId, budgetId);
    if (!data) return { success: false, error: "Presupuesto no encontrado" };
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

export async function createBudgetAction(
  companyId: string,
  input: CreateBudgetInput,
): Promise<Result<BudgetRow>> {
  const { userId, allowed } = await resolveWriters(companyId);
  if (!allowed) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

  const parsed = CreateBudgetSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const data = await BudgetService.create(companyId, parsed.data, userId);
    return { success: true, data };
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") {
      return { success: false, error: "Ya existe un presupuesto con ese nombre para ese año." };
    }
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

export async function updateBudgetAction(
  companyId: string,
  budgetId: string,
  input: UpdateBudgetInput,
): Promise<Result<BudgetRow>> {
  const { userId, allowed } = await resolveWriters(companyId);
  if (!allowed) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

  const parsed = UpdateBudgetSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const data = await BudgetService.update(companyId, budgetId, parsed.data);
    if (!data) return { success: false, error: "Presupuesto no encontrado" };
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

export async function deleteBudgetAction(
  companyId: string,
  budgetId: string,
): Promise<Result<true>> {
  const { userId, allowed } = await resolveAdmin(companyId);
  if (!allowed) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

  try {
    const ok = await BudgetService.delete(companyId, budgetId);
    if (!ok) return { success: false, error: "Presupuesto no encontrado" };
    return { success: true, data: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

// ── Budget Lines ──────────────────────────────────────────────────────────────

export async function upsertBudgetLineAction(
  companyId: string,
  budgetId: string,
  input: UpsertBudgetLineInput,
): Promise<Result<BudgetLineRow>> {
  const { userId, allowed } = await resolveWriters(companyId);
  if (!allowed) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

  const parsed = UpsertBudgetLineSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const data = await BudgetService.upsertLine(companyId, budgetId, parsed.data);
    if (!data) return { success: false, error: "Presupuesto o cuenta no válidos para esta empresa" };
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

export async function deleteBudgetLineAction(
  companyId: string,
  budgetId: string,
  accountId: string,
): Promise<Result<true>> {
  const { userId, allowed } = await resolveWriters(companyId);
  if (!allowed) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

  try {
    const ok = await BudgetService.deleteLine(companyId, budgetId, accountId);
    if (!ok) return { success: false, error: "Línea no encontrada" };
    return { success: true, data: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

// ── Reports ───────────────────────────────────────────────────────────────────

export async function getBudgetVsActualAction(
  companyId: string,
  budgetId: string,
): Promise<Result<BudgetVsActualLine[]>> {
  // Read-only report: ROLES.ACCOUNTING (requiere comprensión contable)
  const { allowed } = await resolveAccounting(companyId);
  if (!allowed) return { success: false, error: "No autorizado" };

  try {
    const data = await BudgetService.compareWithActual(companyId, budgetId);
    if (!data) return { success: false, error: "Presupuesto no encontrado" };
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

export async function getCashFlowProjectionAction(
  companyId: string,
): Promise<Result<CashFlowProjection>> {
  // Read-only report: ROLES.ACCOUNTING
  const { allowed } = await resolveAccounting(companyId);
  if (!allowed) return { success: false, error: "No autorizado" };

  try {
    const data = await CashFlowProjectionService.project(companyId);
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}
