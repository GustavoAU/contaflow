// src/modules/budgets/actions/budget.actions.ts
// Q3-3: Presupuestos y Proyecciones — Server Actions.
// ADR-004: companyId guard en todos los handlers.

"use server";

import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
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
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ── Budget CRUD ───────────────────────────────────────────────────────────────

export async function listBudgetsAction(companyId: string): Promise<ActionResult<BudgetRow[]>> {
  try {
    // Read-only: ROLES.ALL (VIEWER incluido — solo consulta)
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ALL });
    if (!ctx.ok) return ctx.error;
    const data = await BudgetService.list(companyId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function getBudgetAction(
  companyId: string,
  budgetId: string,
): Promise<ActionResult<BudgetRow>> {
  try {
    // Read-only: ROLES.ALL
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ALL });
    if (!ctx.ok) return ctx.error;
    const data = await BudgetService.get(companyId, budgetId);
    if (!data) return { success: false, error: "Presupuesto no encontrado" };
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function createBudgetAction(
  companyId: string,
  input: CreateBudgetInput,
): Promise<ActionResult<BudgetRow>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS, limiter: limiters.fiscal });
  if (!ctx.ok) return ctx.error;
  const userId = ctx.userId;

  const parsed = CreateBudgetSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const data = await BudgetService.create(companyId, parsed.data, userId);
    return { success: true, data };
  } catch (e) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") {
      return { success: false, error: "Ya existe un presupuesto con ese nombre para ese año." };
    }
    return toActionError(e);
  }
}

export async function updateBudgetAction(
  companyId: string,
  budgetId: string,
  input: UpdateBudgetInput,
): Promise<ActionResult<BudgetRow>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS, limiter: limiters.fiscal });
  if (!ctx.ok) return ctx.error;

  const parsed = UpdateBudgetSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const data = await BudgetService.update(companyId, budgetId, parsed.data);
    if (!data) return { success: false, error: "Presupuesto no encontrado" };
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteBudgetAction(
  companyId: string,
  budgetId: string,
): Promise<ActionResult<true>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ADMIN_ONLY, limiter: limiters.fiscal });
  if (!ctx.ok) return ctx.error;

  try {
    const ok = await BudgetService.delete(companyId, budgetId);
    if (!ok) return { success: false, error: "Presupuesto no encontrado" };
    return { success: true, data: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Budget Lines ──────────────────────────────────────────────────────────────

export async function upsertBudgetLineAction(
  companyId: string,
  budgetId: string,
  input: UpsertBudgetLineInput,
): Promise<ActionResult<BudgetLineRow>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS, limiter: limiters.fiscal });
  if (!ctx.ok) return ctx.error;

  const parsed = UpsertBudgetLineSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const data = await BudgetService.upsertLine(companyId, budgetId, parsed.data);
    if (!data) return { success: false, error: "Presupuesto o cuenta no válidos para esta empresa" };
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteBudgetLineAction(
  companyId: string,
  budgetId: string,
  accountId: string,
): Promise<ActionResult<true>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS, limiter: limiters.fiscal });
  if (!ctx.ok) return ctx.error;

  try {
    const ok = await BudgetService.deleteLine(companyId, budgetId, accountId);
    if (!ok) return { success: false, error: "Línea no encontrada" };
    return { success: true, data: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Reports ───────────────────────────────────────────────────────────────────

export async function getBudgetVsActualAction(
  companyId: string,
  budgetId: string,
): Promise<ActionResult<BudgetVsActualLine[]>> {
  // Read-only report: ROLES.ACCOUNTING (requiere comprensión contable)
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

  try {
    const data = await BudgetService.compareWithActual(companyId, budgetId);
    if (!data) return { success: false, error: "Presupuesto no encontrado" };
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function getCashFlowProjectionAction(
  companyId: string,
): Promise<ActionResult<CashFlowProjection>> {
  // Read-only report: ROLES.ACCOUNTING
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

  try {
    const data = await CashFlowProjectionService.project(companyId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}
