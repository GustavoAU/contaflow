"use server";

// src/modules/expenses/actions/expense.actions.ts
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { VEN_TAX_RATES } from "@/lib/tax-config";
import prisma from "@/lib/prisma";
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

async function getAuthContext() {
  const { userId } = await auth();
  if (!userId) return null;
  const h = await headers();
  const ipAddress =
    h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;
  return { userId, ipAddress, userAgent };
}

// MEDIUM-05: assertMember verifica membresía Y rol mínimo requerido
async function assertMember(companyId: string, userId: string, allowed = ROLES.WRITERS) {
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) throw new Error("No perteneces a esta empresa");
  if (!canAccess(member.role, allowed)) throw new Error("No autorizado");
  return member;
}

// ─── Crear gasto ──────────────────────────────────────────────────────────────
export async function createExpenseAction(
  input: unknown
): Promise<ActionResult<ExpenseSummary>> {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(ctx.userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const parsed = CreateExpenseSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    await assertMember(parsed.data.companyId, ctx.userId, ROLES.WRITERS);

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
    const ctx = await getAuthContext();
    if (!ctx) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(ctx.userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const parsed = ConfirmExpenseSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    await assertMember(parsed.data.companyId, ctx.userId, ROLES.WRITERS);

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
    const ctx = await getAuthContext();
    if (!ctx) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(ctx.userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const parsed = VoidExpenseSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    // voidExpense genera asiento de reversión — requiere rol ACCOUNTING mínimo
    await assertMember(parsed.data.companyId, ctx.userId, ROLES.ACCOUNTING);

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
    const ctx = await getAuthContext();
    if (!ctx) return { success: false, error: "No autorizado" };

    // MEDIUM-06: rate limit en lectura paginada
    const rl = await checkRateLimit(ctx.userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const parsed = ListExpensesSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    await assertMember(parsed.data.companyId, ctx.userId);

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
    const ctx = await getAuthContext();
    if (!ctx) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(ctx.userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const parsed = CreateExpenseCategorySchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    await assertMember(parsed.data.companyId, ctx.userId, ROLES.WRITERS);

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
    const ctx = await getAuthContext();
    if (!ctx) return { success: false, error: "No autorizado" };

    // MEDIUM-07: rate limit en lectura
    const rl = await checkRateLimit(ctx.userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    await assertMember(companyId, ctx.userId);

    const data = await listExpenseCategories(companyId);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}
