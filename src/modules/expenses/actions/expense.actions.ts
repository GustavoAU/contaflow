"use server";

// src/modules/expenses/actions/expense.actions.ts
import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { limiters } from "@/lib/ratelimit";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { VEN_TAX_RATES } from "@/lib/tax-config";
import {
  CreateExpenseSchema,
  CreateExpenseCategorySchema,
  ConfirmExpenseSchema,
  VoidExpenseSchema,
  ListExpensesSchema,
} from "../schemas/expense.schema";
import {
  createExpense,
  confirmExpense,
  voidExpense,
  listExpenses,
  createExpenseCategory,
  listExpenseCategories,
  type ExpenseSummary,
  type ExpensePage,
  type ExpenseCategorySummary,
} from "../services/ExpenseService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";
import { assertWriteAllowed } from "@/modules/billing/services/SubscriptionService";

// ─── Crear gasto ──────────────────────────────────────────────────────────────
export async function createExpenseAction(
  input: unknown
): Promise<ActionResult<ExpenseSummary>> {
  try {
    const parsed = CreateExpenseSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    const ctx = await requireCompanyAction(parsed.data.companyId, {
      roles: ROLES.WRITERS,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    // Corte por suscripción vencida (solo lectura)
    await assertWriteAllowed(parsed.data.companyId);

    // MEDIUM-08: IVA siempre computado server-side — Z-2, nunca confiar en el cliente
    const computedIva = parsed.data.hasIva
      ? new Decimal(parsed.data.amount).times(new Decimal(VEN_TAX_RATES.ivaGeneral)).toFixed(2)
      : undefined;

    const data = await createExpense(
      { ...parsed.data, ivaAmount: computedIva },
      ctx.userId,
      ctx.ipAddress,
      ctx.userAgent,
    );
    revalidatePath(`/dashboard/${parsed.data.companyId}/expenses`);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Confirmar gasto ──────────────────────────────────────────────────────────
export async function confirmExpenseAction(
  input: unknown
): Promise<ActionResult<ExpenseSummary>> {
  try {
    const parsed = ConfirmExpenseSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    const ctx = await requireCompanyAction(parsed.data.companyId, {
      roles: ROLES.WRITERS,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const data = await confirmExpense(parsed.data, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/dashboard/${parsed.data.companyId}/expenses`);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Anular gasto ─────────────────────────────────────────────────────────────
export async function voidExpenseAction(
  input: unknown
): Promise<ActionResult<ExpenseSummary>> {
  try {
    const parsed = VoidExpenseSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    // voidExpense genera asiento de reversión — requiere rol ACCOUNTING mínimo
    const ctx = await requireCompanyAction(parsed.data.companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const data = await voidExpense(parsed.data, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/dashboard/${parsed.data.companyId}/expenses`);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Listar gastos ────────────────────────────────────────────────────────────
export async function listExpensesAction(
  input: unknown
): Promise<ActionResult<ExpensePage>> {
  try {
    const parsed = ListExpensesSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    // MEDIUM-06: rate limit en lectura paginada
    const ctx = await requireCompanyAction(parsed.data.companyId, {
      roles: "MEMBER_ANY",
      limiter: limiters.read,
    });
    if (!ctx.ok) return ctx.error;

    const data = await listExpenses(parsed.data);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Crear categoría ──────────────────────────────────────────────────────────
export async function createExpenseCategoryAction(
  input: unknown
): Promise<ActionResult<ExpenseCategorySummary>> {
  try {
    const parsed = CreateExpenseCategorySchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    const ctx = await requireCompanyAction(parsed.data.companyId, {
      roles: ROLES.WRITERS,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const data = await createExpenseCategory(parsed.data, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/dashboard/${parsed.data.companyId}/expenses`);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Listar categorías ────────────────────────────────────────────────────────
export async function listExpenseCategoriesAction(
  companyId: string
): Promise<ActionResult<ExpenseCategorySummary[]>> {
  try {
    // MEDIUM-07: rate limit en lectura
    const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY", limiter: limiters.read });
    if (!ctx.ok) return ctx.error;

    const data = await listExpenseCategories(companyId);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}
