// src/modules/budgets/services/BudgetService.ts
// Q3-3: Presupuestos y Proyecciones — CRUD + comparación Presupuestado vs Real.
// ADR-004: todos los queries filtran por companyId.
// R-5: Decimal.js para todos los importes.

import prisma from "@/lib/prisma";
import Decimal from "decimal.js";
import type { BudgetStatus } from "@prisma/client";
import type { CreateBudgetInput, UpdateBudgetInput, UpsertBudgetLineInput } from "../schemas/budget.schemas";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BudgetLineRow = {
  id: string;
  budgetId: string;
  companyId: string;
  accountId: string;
  amount: string;     // Decimal serialized as string (R-5: never number)
  notes: string | null;
  account: {
    id: string;
    code: string;
    name: string;
    type: string;
  };
};

export type BudgetRow = {
  id: string;
  companyId: string;
  periodYear: number;
  name: string;
  status: BudgetStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  lines: BudgetLineRow[];
  totalAmount: string; // sum of lines.amount as string
};

export type BudgetVsActualLine = {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  budgeted: string;   // Decimal string
  actual: string;     // Decimal string (GL balance for the year)
  variance: string;   // budgeted - actual
  pct: number | null; // (actual / budgeted) * 100 — null if budgeted = 0
};

export type CashFlowBucket = {
  label: string;              // "Vencido" | "0-30 días" | "31-60 días" | "61-90 días"
  cxcAmount: string;          // pendingAmount CxC (Decimal string)
  cxpAmount: string;          // pendingAmount CxP (Decimal string)
  netAmount: string;          // cxc - cxp
  invoiceCount: number;
};

export type CashFlowProjection = {
  buckets: CashFlowBucket[];
  totalCxC: string;
  totalCxP: string;
  totalNet: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACCOUNT_SELECT = {
  id: true,
  code: true,
  name: true,
  type: true,
} as const;

function serializeLine(line: {
  id: string; budgetId: string; companyId: string; accountId: string;
  amount: { toString(): string }; notes: string | null;
  account: { id: string; code: string; name: string; type: string };
}): BudgetLineRow {
  return { ...line, amount: line.amount.toString() };
}

function buildBudgetRow(budget: {
  id: string; companyId: string; periodYear: number; name: string;
  status: BudgetStatus; createdBy: string; createdAt: Date; updatedAt: Date;
  lines: Array<{
    id: string; budgetId: string; companyId: string; accountId: string;
    amount: { toString(): string }; notes: string | null;
    account: { id: string; code: string; name: string; type: string };
  }>;
}): BudgetRow {
  const lines = budget.lines.map(serializeLine);
  const total = lines.reduce((s, l) => s.plus(new Decimal(l.amount)), new Decimal(0));
  return { ...budget, lines, totalAmount: total.toFixed(2) };
}

// ── Service ───────────────────────────────────────────────────────────────────

export const BudgetService = {
  // ── List (all budgets for a company) ────────────────────────────────────────
  async list(companyId: string): Promise<BudgetRow[]> {
    const budgets = await prisma.budget.findMany({
      where: { companyId },                 // ADR-004
      orderBy: [{ periodYear: "desc" }, { name: "asc" }],
      include: { lines: { include: { account: { select: ACCOUNT_SELECT } } } },
    });
    return budgets.map(buildBudgetRow);
  },

  // ── Get (single budget with lines) ──────────────────────────────────────────
  async get(companyId: string, budgetId: string): Promise<BudgetRow | null> {
    const budget = await prisma.budget.findUnique({
      where: { id: budgetId },
      include: { lines: { include: { account: { select: ACCOUNT_SELECT } } } },
    });
    if (!budget || budget.companyId !== companyId) return null;  // ADR-004
    return buildBudgetRow(budget);
  },

  // ── Create ───────────────────────────────────────────────────────────────────
  async create(companyId: string, input: CreateBudgetInput, userId: string): Promise<BudgetRow> {
    const budget = await prisma.budget.create({
      data: {
        companyId,
        periodYear: input.periodYear,
        name: input.name ?? "Presupuesto Anual",
        createdBy: userId,
      },
      include: { lines: { include: { account: { select: ACCOUNT_SELECT } } } },
    });
    return buildBudgetRow(budget);
  },

  // ── Update (name / status) ───────────────────────────────────────────────────
  async update(companyId: string, budgetId: string, input: UpdateBudgetInput): Promise<BudgetRow | null> {
    const existing = await prisma.budget.findUnique({ where: { id: budgetId } });
    if (!existing || existing.companyId !== companyId) return null;   // ADR-004
    const budget = await prisma.budget.update({
      where: { id: budgetId },
      data: {
        ...(input.name   !== undefined ? { name: input.name }     : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      include: { lines: { include: { account: { select: ACCOUNT_SELECT } } } },
    });
    return buildBudgetRow(budget);
  },

  // ── Delete (soft delete not needed — budgets have no fiscal obligation) ──────
  async delete(companyId: string, budgetId: string): Promise<boolean> {
    const existing = await prisma.budget.findUnique({ where: { id: budgetId } });
    if (!existing || existing.companyId !== companyId) return false;  // ADR-004
    await prisma.budget.delete({ where: { id: budgetId } });
    return true;
  },

  // ── Upsert line (insert or update by accountId) ──────────────────────────────
  async upsertLine(
    companyId: string,
    budgetId: string,
    input: UpsertBudgetLineInput,
  ): Promise<BudgetLineRow | null> {
    const budget = await prisma.budget.findUnique({ where: { id: budgetId } });
    if (!budget || budget.companyId !== companyId) return null;       // ADR-004

    // Verify account belongs to this company
    const account = await prisma.account.findUnique({ where: { id: input.accountId } });
    if (!account || account.companyId !== companyId) return null;     // ADR-004

    const line = await prisma.budgetLine.upsert({
      where: { budgetId_accountId: { budgetId, accountId: input.accountId } },
      create: {
        budgetId,
        companyId,
        accountId: input.accountId,
        amount: new Decimal(input.amount).toDecimalPlaces(4).toString(),
        notes: input.notes ?? null,
      },
      update: {
        amount: new Decimal(input.amount).toDecimalPlaces(4).toString(),
        notes: input.notes ?? null,
      },
      include: { account: { select: ACCOUNT_SELECT } },
    });
    return serializeLine(line);
  },

  // ── Delete line ──────────────────────────────────────────────────────────────
  async deleteLine(companyId: string, budgetId: string, accountId: string): Promise<boolean> {
    const line = await prisma.budgetLine.findUnique({
      where: { budgetId_accountId: { budgetId, accountId } },
    });
    if (!line || line.companyId !== companyId) return false;          // ADR-004
    await prisma.budgetLine.delete({ where: { budgetId_accountId: { budgetId, accountId } } });
    return true;
  },

  // ── Presupuestado vs Real ─────────────────────────────────────────────────────
  // Compara líneas del presupuesto con movimientos GL del año correspondiente.
  // "Real" = suma (débitos − créditos) de JournalEntry por cuenta en el año.
  async compareWithActual(companyId: string, budgetId: string): Promise<BudgetVsActualLine[] | null> {
    const budget = await prisma.budget.findUnique({
      where: { id: budgetId },
      include: { lines: { include: { account: { select: ACCOUNT_SELECT } } } },
    });
    if (!budget || budget.companyId !== companyId) return null;       // ADR-004

    if (budget.lines.length === 0) return [];

    const yearStart = new Date(budget.periodYear, 0, 1);
    const yearEnd   = new Date(budget.periodYear, 11, 31, 23, 59, 59, 999);

    // One batch query: sum JournalEntry.amount per account in the year.
    // Convention: positive amount = Débito, negative = Crédito.
    // Filter POSTED only (VOIDED transactions excluded).
    const actuals = await prisma.journalEntry.groupBy({
      by: ["accountId"],
      where: {
        accountId: { in: budget.lines.map((l) => l.accountId) },
        transaction: {
          companyId,
          date: { gte: yearStart, lte: yearEnd },
          status: "POSTED",
        },
      },
      _sum: { amount: true },
    });

    const actualMap = new Map(
      actuals.map((a) => [
        a.accountId,
        new Decimal(a._sum?.amount?.toString() ?? "0"),
      ]),
    );

    return budget.lines.map((line) => {
      const budgeted = new Decimal(line.amount.toString());
      const actual   = actualMap.get(line.accountId) ?? new Decimal(0);
      const variance = budgeted.minus(actual);
      const pct      = budgeted.isZero()
        ? null
        : actual.div(budgeted).times(100).toDecimalPlaces(1).toNumber();

      return {
        accountId:   line.accountId,
        accountCode: line.account.code,
        accountName: line.account.name,
        accountType: line.account.type,
        budgeted:    budgeted.toFixed(2),
        actual:      actual.toFixed(2),
        variance:    variance.toFixed(2),
        pct,
      };
    });
  },
};
