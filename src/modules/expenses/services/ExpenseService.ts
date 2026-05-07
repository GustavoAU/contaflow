// src/modules/expenses/services/ExpenseService.ts
// Dominio ACCOUNTANT — gestión de gastos operativos (ADR-024 D-3)
// Patrón: plain functions (ADR-022 reference)

import Decimal from "decimal.js";
import prisma from "@/lib/prisma";
import type {
  CreateExpenseCategoryInput,
  CreateExpenseInput,
  ConfirmExpenseInput,
  VoidExpenseInput,
  ListExpensesInput,
} from "../schemas/expense.schema";

// ─── Categorías semilla — 9 categorías base (ADR-024 D-3.2) ──────────────────
export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: "Servicios Básicos", description: "Electricidad, agua, internet, teléfono", isDefault: true },
  { name: "Alquiler", description: "Arrendamiento de local, oficina o galpón", isDefault: true },
  { name: "Honorarios Profesionales", description: "Contabilidad, legal, consultoría", isDefault: true },
  { name: "Publicidad y Propaganda", description: "Marketing, redes sociales, impresos", isDefault: true },
  { name: "Transporte y Fletes", description: "Envíos, mensajería, transporte de mercancía", isDefault: true },
  { name: "Sueldos y Salarios", description: "Pagos de nómina no procesados por módulo Nómina", isDefault: true },
  { name: "Gastos de Oficina", description: "Papelería, útiles, suministros", isDefault: true },
  { name: "Mantenimiento y Reparaciones", description: "Equipos, vehículos, instalaciones", isDefault: true },
  { name: "Otros Gastos Operativos", description: "Gastos no clasificados en otras categorías", isDefault: true },
] as const;

// ─── Tipos de retorno ─────────────────────────────────────────────────────────

export type ExpenseSummary = {
  id: string;
  companyId: string;
  vendorId: string | null;
  supplierName: string | null;
  concept: string;
  categoryId: string;
  categoryName: string;
  amount: string;
  currency: string;
  exchangeRate: string | null;
  amountVes: string;
  hasIva: boolean;
  ivaAmount: string | null;
  isDeductible: boolean;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  attachmentUrl: string | null;
  status: string;
  createdBy: string;
  createdAt: Date;
};

export type ExpensePage = {
  data: ExpenseSummary[];
  nextCursor: string | null;
  hasNextPage: boolean;
};

export type ExpenseCategorySummary = {
  id: string;
  name: string;
  description: string | null;
  accountId: string | null;
  isDefault: boolean;
};

// ─── Seed de categorías para empresa nueva ────────────────────────────────────
// Llamado desde CompanyService.createCompany() en el mismo $transaction
export async function seedExpenseCategories(
  companyId: string,
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
): Promise<void> {
  await tx.expenseCategory.createMany({
    data: DEFAULT_EXPENSE_CATEGORIES.map((cat) => ({
      companyId,
      name: cat.name,
      description: cat.description,
      isDefault: cat.isDefault,
    })),
    skipDuplicates: true,
  });
}

// ─── Crear categoría personalizada ────────────────────────────────────────────
export async function createExpenseCategory(
  input: CreateExpenseCategoryInput,
  userId: string,
  ipAddress: string | null = null,
  userAgent: string | null = null
): Promise<ExpenseCategorySummary> {
  // Verificar accountId pertenece a la empresa (ADR-004)
  if (input.accountId) {
    await prisma.account.findFirstOrThrow({
      where: { id: input.accountId, companyId: input.companyId },
      select: { id: true },
    });
  }

  const category = await prisma.$transaction(async (tx) => {
    const created = await tx.expenseCategory.create({
      data: {
        companyId: input.companyId,
        name: input.name,
        description: input.description ?? null,
        accountId: input.accountId ?? null,
        isDefault: false,
      },
    });

    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        entityId: created.id,
        entityName: "ExpenseCategory",
        action: "CREATE",
        userId,
        ipAddress,
        userAgent,
        newValue: { name: input.name, companyId: input.companyId },
      },
    });

    return created;
  });

  return {
    id: category.id,
    name: category.name,
    description: category.description,
    accountId: category.accountId,
    isDefault: category.isDefault,
  };
}

// ─── Listar categorías ────────────────────────────────────────────────────────
export async function listExpenseCategories(
  companyId: string
): Promise<ExpenseCategorySummary[]> {
  const cats = await prisma.expenseCategory.findMany({
    where: { companyId, deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, name: true, description: true, accountId: true, isDefault: true },
  });
  return cats;
}

// ─── Crear gasto ──────────────────────────────────────────────────────────────
export async function createExpense(
  input: CreateExpenseInput,
  userId: string,
  ipAddress: string | null = null,
  userAgent: string | null = null
): Promise<ExpenseSummary> {
  // Idempotencia
  const existing = await prisma.expense.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { category: { select: { name: true } } },
  });
  if (existing) {
    return serializeExpense(existing, existing.category.name);
  }

  // Verificar categoryId pertenece a la empresa (ADR-004)
  await prisma.expenseCategory.findFirstOrThrow({
    where: { id: input.categoryId, companyId: input.companyId, deletedAt: null },
    select: { id: true },
  });

  // Verificar vendorId pertenece a la empresa si se provee (ADR-004)
  if (input.vendorId) {
    await prisma.vendor.findFirstOrThrow({
      where: { id: input.vendorId, companyId: input.companyId, deletedAt: null },
      select: { id: true },
    });
  }

  // Verificar expenseAccountId pertenece a la empresa si se provee (ADR-004)
  if (input.expenseAccountId) {
    await prisma.account.findFirstOrThrow({
      where: { id: input.expenseAccountId, companyId: input.companyId },
      select: { id: true },
    });
  }

  // Calcular amountVes (R-5: todo Decimal.js)
  const amount = new Decimal(input.amount);
  const amountVes =
    input.currency === "VES"
      ? amount
      : amount.mul(new Decimal(input.exchangeRate!));

  const expense = await prisma.$transaction(async (tx) => {
    const created = await tx.expense.create({
      data: {
        companyId: input.companyId,
        vendorId: input.vendorId ?? null,
        supplierName: input.supplierName ?? null,
        concept: input.concept,
        categoryId: input.categoryId,
        amount,
        currency: input.currency,
        exchangeRate: input.exchangeRate ? new Decimal(input.exchangeRate) : null,
        amountVes,
        hasIva: input.hasIva,
        ivaAmount: input.ivaAmount ? new Decimal(input.ivaAmount) : null,
        isDeductible: input.isDeductible,
        invoiceNumber: input.invoiceNumber ?? null,
        invoiceDate: input.invoiceDate ?? null,
        attachmentUrl: input.attachmentUrl ?? null,
        expenseAccountId: input.expenseAccountId ?? null,
        status: "DRAFT",
        idempotencyKey: input.idempotencyKey,
        createdBy: userId,
      },
      include: { category: { select: { name: true } } },
    });

    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        entityId: created.id,
        entityName: "Expense",
        action: "CREATE",
        userId,
        ipAddress,
        userAgent,
        newValue: {
          concept: input.concept,
          amount: amount.toFixed(4),
          amountVes: amountVes.toFixed(4),
          currency: input.currency,
          categoryId: input.categoryId,
        },
      },
    });

    return created;
  });

  return serializeExpense(expense, expense.category.name);
}

// ─── Confirmar gasto ──────────────────────────────────────────────────────────
export async function confirmExpense(
  input: ConfirmExpenseInput,
  userId: string,
  ipAddress: string | null = null,
  userAgent: string | null = null
): Promise<ExpenseSummary> {
  const expense = await prisma.expense.findFirst({
    where: { id: input.expenseId, companyId: input.companyId, deletedAt: null },
    include: { category: { select: { name: true } } },
  });
  if (!expense) throw new Error("Gasto no encontrado o no pertenece a esta empresa");
  if (expense.status !== "DRAFT") throw new Error("Solo se pueden confirmar gastos en estado DRAFT");

  const updated = await prisma.$transaction(async (tx) => {
    const upd = await tx.expense.update({
      where: { id: input.expenseId },
      data: {
        status: "CONFIRMED",
        expenseAccountId: input.expenseAccountId ?? expense.expenseAccountId,
      },
      include: { category: { select: { name: true } } },
    });

    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        entityId: input.expenseId,
        entityName: "Expense",
        action: "CONFIRM",
        userId,
        ipAddress,
        userAgent,
        newValue: { status: "CONFIRMED" },
      },
    });

    return upd;
  });

  return serializeExpense(updated, updated.category.name);
}

// ─── Anular gasto ─────────────────────────────────────────────────────────────
export async function voidExpense(
  input: VoidExpenseInput,
  userId: string,
  ipAddress: string | null = null,
  userAgent: string | null = null
): Promise<ExpenseSummary> {
  const expense = await prisma.expense.findFirst({
    where: { id: input.expenseId, companyId: input.companyId, deletedAt: null },
    include: { category: { select: { name: true } } },
  });
  if (!expense) throw new Error("Gasto no encontrado o no pertenece a esta empresa");
  if (expense.status === "VOIDED") throw new Error("El gasto ya está anulado");

  const updated = await prisma.$transaction(async (tx) => {
    const upd = await tx.expense.update({
      where: { id: input.expenseId },
      data: { status: "VOIDED" },
      include: { category: { select: { name: true } } },
    });

    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        entityId: input.expenseId,
        entityName: "Expense",
        action: "VOID",
        userId,
        ipAddress,
        userAgent,
        newValue: { status: "VOIDED", reason: input.reason },
      },
    });

    return upd;
  });

  return serializeExpense(updated, updated.category.name);
}

// ─── Listado paginado cursor-based ────────────────────────────────────────────
export async function listExpenses(input: ListExpensesInput): Promise<ExpensePage> {
  const take = input.limit + 1;
  const where = {
    companyId: input.companyId,
    deletedAt: null,
    ...(input.status ? { status: input.status } : {}),
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
  };

  const expenses = await prisma.expense.findMany({
    where,
    take,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { category: { select: { name: true } } },
  });

  const hasNextPage = expenses.length > input.limit;
  const data = hasNextPage ? expenses.slice(0, input.limit) : expenses;
  const nextCursor = hasNextPage ? data[data.length - 1].id : null;

  return {
    data: data.map((e) => serializeExpense(e, e.category.name)),
    nextCursor,
    hasNextPage,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function serializeExpense(
  expense: {
    id: string;
    companyId: string;
    vendorId: string | null;
    supplierName: string | null;
    concept: string;
    categoryId: string;
    amount: { toString(): string };
    currency: string;
    exchangeRate: { toString(): string } | null;
    amountVes: { toString(): string };
    hasIva: boolean;
    ivaAmount: { toString(): string } | null;
    isDeductible: boolean;
    invoiceNumber: string | null;
    invoiceDate: Date | null;
    attachmentUrl: string | null;
    status: string;
    createdBy: string;
    createdAt: Date;
  },
  categoryName: string
): ExpenseSummary {
  return {
    id: expense.id,
    companyId: expense.companyId,
    vendorId: expense.vendorId,
    supplierName: expense.supplierName,
    concept: expense.concept,
    categoryId: expense.categoryId,
    categoryName,
    amount: new Decimal(expense.amount.toString()).toFixed(4),
    currency: expense.currency,
    exchangeRate: expense.exchangeRate
      ? new Decimal(expense.exchangeRate.toString()).toFixed(6)
      : null,
    amountVes: new Decimal(expense.amountVes.toString()).toFixed(4),
    hasIva: expense.hasIva,
    ivaAmount: expense.ivaAmount
      ? new Decimal(expense.ivaAmount.toString()).toFixed(4)
      : null,
    isDeductible: expense.isDeductible,
    invoiceNumber: expense.invoiceNumber,
    invoiceDate: expense.invoiceDate,
    attachmentUrl: expense.attachmentUrl,
    status: expense.status,
    createdBy: expense.createdBy,
    createdAt: expense.createdAt,
  };
}
