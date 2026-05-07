// src/modules/expenses/__tests__/ExpenseService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn((fn: (tx: unknown) => unknown) =>
      fn({
        expense: {
          create: vi.fn().mockResolvedValue(makeDbExpense()),
          update: vi.fn().mockResolvedValue(makeDbExpense({ status: "CONFIRMED" })),
        },
        expenseCategory: { createMany: vi.fn(), create: vi.fn() },
        auditLog: { create: vi.fn() },
      })
    ),
    expense: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    expenseCategory: {
      findFirstOrThrow: vi.fn().mockResolvedValue({ id: "cat-1" }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
    vendor: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: "vendor-1" }) },
    account: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: "acc-1" }) },
    auditLog: { create: vi.fn() },
  },
}));

import prisma from "@/lib/prisma";
import {
  createExpense,
  confirmExpense,
  voidExpense,
  listExpenses,
  seedExpenseCategories,
  DEFAULT_EXPENSE_CATEGORIES,
} from "../services/ExpenseService";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeDbExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: "expense-1",
    companyId: "company-1",
    vendorId: null,
    supplierName: "Proveedor Demo",
    concept: "Servicio de internet",
    categoryId: "cat-1",
    amount: new Decimal("100"),
    currency: "VES",
    exchangeRate: null,
    amountVes: new Decimal("100"),
    hasIva: false,
    ivaAmount: null,
    isDeductible: true,
    invoiceNumber: null,
    invoiceDate: null,
    attachmentUrl: null,
    transactionId: null,
    expenseAccountId: null,
    status: "DRAFT",
    idempotencyKey: "uuid-1234",
    deletedAt: null,
    deletedBy: null,
    createdBy: "user-1",
    createdAt: new Date("2026-05-06"),
    updatedAt: new Date("2026-05-06"),
    category: { name: "Servicios Básicos" },
    ...overrides,
  };
}

const makeCreateInput = (overrides = {}) => ({
  companyId: "company-1",
  supplierName: "Proveedor Demo",
  concept: "Servicio de internet",
  categoryId: "cat-1",
  amount: "100",
  currency: "VES" as const,
  hasIva: false,
  isDeductible: true,
  idempotencyKey: "123e4567-e89b-12d3-a456-426614174000",
  ...overrides,
});

// ─── seedExpenseCategories ────────────────────────────────────────────────────
describe("seedExpenseCategories", () => {
  it("llama createMany con las 9 categorías semilla", async () => {
    const txMock = {
      expenseCategory: { createMany: vi.fn().mockResolvedValue({ count: 9 }) },
    };

    await seedExpenseCategories("company-1", txMock as unknown as Parameters<typeof seedExpenseCategories>[1]);

    expect(txMock.expenseCategory.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ name: "Servicios Básicos", isDefault: true }),
        expect.objectContaining({ name: "Alquiler", isDefault: true }),
        expect.objectContaining({ name: "Otros Gastos Operativos", isDefault: true }),
      ]),
      skipDuplicates: true,
    });
    expect(DEFAULT_EXPENSE_CATEGORIES).toHaveLength(9);
  });
});

// ─── createExpense ─────────────────────────────────────────────────────────────
describe("createExpense", () => {
  beforeEach(() => {
    vi.mocked(prisma.expense.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.expense.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.expenseCategory.findFirstOrThrow).mockResolvedValue({ id: "cat-1" } as never);
  });

  it("crea un gasto en VES correctamente", async () => {
    const txFn = vi.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        expense: { create: vi.fn().mockResolvedValue(makeDbExpense()) },
        auditLog: { create: vi.fn() },
      };
      return fn(tx);
    });
    vi.mocked(prisma.$transaction).mockImplementation(txFn as never);

    const result = await createExpense(makeCreateInput(), "user-1");

    expect(result.id).toBe("expense-1");
    expect(result.status).toBe("DRAFT");
    expect(result.amountVes).toBe("100.0000");
  });

  it("calcula amountVes correctamente para USD con tasa de cambio", async () => {
    const txFn = vi.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        expense: {
          create: vi.fn().mockResolvedValue(
            makeDbExpense({
              amount: new Decimal("10"),
              currency: "USD",
              exchangeRate: new Decimal("36.50"),
              amountVes: new Decimal("365"),
            })
          ),
        },
        auditLog: { create: vi.fn() },
      };
      return fn(tx);
    });
    vi.mocked(prisma.$transaction).mockImplementation(txFn as never);

    const result = await createExpense(
      makeCreateInput({ amount: "10", currency: "USD", exchangeRate: "36.50" }),
      "user-1"
    );

    expect(result.amountVes).toBe("365.0000"); // 10 × 36.50
  });

  it("retorna el gasto existente si ya existe idempotencyKey", async () => {
    vi.mocked(prisma.expense.findUnique).mockResolvedValue(makeDbExpense() as never);
    vi.mocked(prisma.$transaction).mockClear();

    const result = await createExpense(makeCreateInput(), "user-1");
    expect(result.id).toBe("expense-1");
    // No debe llamar a $transaction cuando existe idempotencyKey
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ─── confirmExpense ────────────────────────────────────────────────────────────
describe("confirmExpense", () => {
  it("confirma un gasto DRAFT correctamente", async () => {
    vi.mocked(prisma.expense.findFirst).mockResolvedValue(makeDbExpense() as never);

    const txFn = vi.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        expense: {
          update: vi.fn().mockResolvedValue(
            makeDbExpense({ status: "CONFIRMED" })
          ),
        },
        auditLog: { create: vi.fn() },
      };
      return fn(tx);
    });
    vi.mocked(prisma.$transaction).mockImplementation(txFn as never);

    const result = await confirmExpense(
      { expenseId: "expense-1", companyId: "company-1" },
      "user-1"
    );

    expect(result.status).toBe("CONFIRMED");
  });

  it("lanza error si el gasto no está en DRAFT", async () => {
    vi.mocked(prisma.expense.findFirst).mockResolvedValue(
      makeDbExpense({ status: "CONFIRMED" }) as never
    );

    await expect(
      confirmExpense({ expenseId: "expense-1", companyId: "company-1" }, "user-1")
    ).rejects.toThrow("Solo se pueden confirmar gastos en estado DRAFT");
  });

  it("lanza error si el gasto no pertenece a la empresa (IDOR guard)", async () => {
    vi.mocked(prisma.expense.findFirst).mockResolvedValue(null);

    await expect(
      confirmExpense({ expenseId: "expense-1", companyId: "otra-empresa" }, "user-1")
    ).rejects.toThrow("no pertenece a esta empresa");
  });
});

// ─── voidExpense ───────────────────────────────────────────────────────────────
describe("voidExpense", () => {
  it("anula un gasto correctamente", async () => {
    vi.mocked(prisma.expense.findFirst).mockResolvedValue(
      makeDbExpense({ status: "CONFIRMED" }) as never
    );

    const txFn = vi.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        expense: {
          update: vi.fn().mockResolvedValue(makeDbExpense({ status: "VOIDED" })),
        },
        auditLog: { create: vi.fn() },
      };
      return fn(tx);
    });
    vi.mocked(prisma.$transaction).mockImplementation(txFn as never);

    const result = await voidExpense(
      { expenseId: "expense-1", companyId: "company-1", reason: "Error de captura" },
      "user-1"
    );

    expect(result.status).toBe("VOIDED");
  });

  it("lanza error si el gasto ya está anulado", async () => {
    vi.mocked(prisma.expense.findFirst).mockResolvedValue(
      makeDbExpense({ status: "VOIDED" }) as never
    );

    await expect(
      voidExpense(
        { expenseId: "expense-1", companyId: "company-1", reason: "test" },
        "user-1"
      )
    ).rejects.toThrow("ya está anulado");
  });
});

// ─── listExpenses ──────────────────────────────────────────────────────────────
describe("listExpenses", () => {
  it("retorna página vacía cuando no hay gastos", async () => {
    vi.mocked(prisma.expense.findMany).mockResolvedValue([]);

    const result = await listExpenses({ companyId: "company-1", limit: 50 });

    expect(result.data).toHaveLength(0);
    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("pagina correctamente con cursor cuando hay más resultados", async () => {
    const expenses = Array.from({ length: 51 }, (_, i) =>
      makeDbExpense({ id: `expense-${i + 1}` })
    );
    vi.mocked(prisma.expense.findMany).mockResolvedValue(expenses as never);

    const result = await listExpenses({ companyId: "company-1", limit: 50 });

    expect(result.data).toHaveLength(50);
    expect(result.hasNextPage).toBe(true);
    expect(result.nextCursor).toBe("expense-50");
  });
});
