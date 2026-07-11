// src/modules/expenses/__tests__/expense.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  fiscalKey: (c: string, u: string) => `${c}:${u}`,
  limiters: { fiscal: {}, read: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: { companyMember: { findFirst: vi.fn() } },
}));
vi.mock("../services/ExpenseService", () => ({
  createExpense: vi.fn(),
  confirmExpense: vi.fn(),
  voidExpense: vi.fn(),
  listExpenses: vi.fn(),
  createExpenseCategory: vi.fn(),
  listExpenseCategories: vi.fn(),
}));

import prisma from "@/lib/prisma";
import * as ExpenseService from "../services/ExpenseService";
import {
  createExpenseAction,
  confirmExpenseAction,
  voidExpenseAction,
  listExpensesAction,
  createExpenseCategoryAction,
  listExpenseCategoriesAction,
} from "../actions/expense.actions";

const COMPANY_ID = "co-1";
const USER_ID = "usr-1";
const EXPENSE_ID = "exp-1";

const EXPENSE_STUB = {
  id: EXPENSE_ID,
  companyId: COMPANY_ID,
  concept: "Papelería",
  amount: "100.00",
  status: "DRAFT",
};

const IDEMPOTENCY_KEY = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

// CreateExpenseSchema requires: companyId, concept, categoryId, amount,
// idempotencyKey, and (vendorId OR supplierName).
const VALID_CREATE_INPUT = {
  companyId: COMPANY_ID,
  concept: "Papelería",
  amount: "100.00",
  currency: "VES",
  hasIva: false,
  categoryId: "cat-1",
  supplierName: "Proveedor Test",
  idempotencyKey: IDEMPOTENCY_KEY,
};

function setAuth(userId: string | null) {
  mockAuth.mockResolvedValue({ userId });
}
function setMember(role = "ACCOUNTANT") {
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role } as never);
}
function setNoMember() {
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);
}
function setRateLimit(allowed = true) {
  mockCheckRateLimit.mockResolvedValue({ allowed, error: allowed ? undefined : "Límite excedido" });
}

beforeEach(() => {
  vi.clearAllMocks();
  setAuth(USER_ID);
  setMember();
  setRateLimit();
});

// ─── createExpenseAction ──────────────────────────────────────────────────────

describe("createExpenseAction", () => {
  beforeEach(() => {
    vi.mocked(ExpenseService.createExpense).mockResolvedValue(EXPENSE_STUB as never);
  });

  it("rechaza si no hay sesión", async () => {
    setAuth(null);
    const r = await createExpenseAction(VALID_CREATE_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("rechaza si rate limit excedido", async () => {
    setRateLimit(false);
    const r = await createExpenseAction(VALID_CREATE_INPUT);
    expect(r.success).toBe(false);
  });

  it("rechaza si input inválido (faltan campos requeridos)", async () => {
    const r = await createExpenseAction({ companyId: "" });
    expect(r.success).toBe(false);
  });

  it("rechaza si usuario no es miembro (IDOR)", async () => {
    setNoMember();
    const r = await createExpenseAction(VALID_CREATE_INPUT);
    expect(r.success).toBe(false);
  });

  it("crea gasto en camino feliz", async () => {
    const r = await createExpenseAction(VALID_CREATE_INPUT);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.id).toBe(EXPENSE_ID);
  });

  it("MEDIUM-08: IVA siempre computado server-side (16%) cuando hasIva=true", async () => {
    // Client sends wrong ivaAmount — server must override to amount * 0.16
    await createExpenseAction({
      ...VALID_CREATE_INPUT,
      hasIva: true,
      ivaAmount: "99",
    });
    expect(vi.mocked(ExpenseService.createExpense)).toHaveBeenCalledWith(
      expect.objectContaining({ ivaAmount: "16.00" }),
      USER_ID,
      null,
      null,
    );
  });

  it("MEDIUM-08: ivaAmount undefined cuando hasIva=false", async () => {
    await createExpenseAction(VALID_CREATE_INPUT);
    const firstCallFirstArg = vi.mocked(ExpenseService.createExpense).mock.calls[0]?.[0];
    expect(firstCallFirstArg?.ivaAmount).toBeUndefined();
  });
});

// ─── confirmExpenseAction ─────────────────────────────────────────────────────

describe("confirmExpenseAction", () => {
  const VALID_INPUT = { companyId: COMPANY_ID, expenseId: EXPENSE_ID };

  beforeEach(() => {
    vi.mocked(ExpenseService.confirmExpense).mockResolvedValue({
      ...EXPENSE_STUB,
      status: "CONFIRMED",
    } as never);
  });

  it("rechaza sin sesión", async () => {
    setAuth(null);
    const r = await confirmExpenseAction(VALID_INPUT);
    expect(r.success).toBe(false);
  });

  it("rechaza VIEWER (requiere WRITERS)", async () => {
    setMember("VIEWER");
    const r = await confirmExpenseAction(VALID_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("confirma gasto en camino feliz", async () => {
    const r = await confirmExpenseAction(VALID_INPUT);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe("CONFIRMED");
  });
});

// ─── voidExpenseAction ────────────────────────────────────────────────────────

describe("voidExpenseAction", () => {
  const VALID_INPUT = { companyId: COMPANY_ID, expenseId: EXPENSE_ID, reason: "Duplicado" };

  beforeEach(() => {
    vi.mocked(ExpenseService.voidExpense).mockResolvedValue({
      ...EXPENSE_STUB,
      status: "VOID",
    } as never);
  });

  it("rechaza sin sesión", async () => {
    setAuth(null);
    const r = await voidExpenseAction(VALID_INPUT);
    expect(r.success).toBe(false);
  });

  it("rechaza ADMINISTRATIVE (requiere ACCOUNTING mínimo)", async () => {
    setMember("ADMINISTRATIVE");
    const r = await voidExpenseAction(VALID_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("ACCOUNTANT puede anular gasto", async () => {
    const r = await voidExpenseAction(VALID_INPUT);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe("VOID");
  });
});

// ─── listExpensesAction ───────────────────────────────────────────────────────

describe("listExpensesAction", () => {
  // ListExpensesSchema: companyId required, others optional
  const VALID_INPUT = { companyId: COMPANY_ID };

  beforeEach(() => {
    vi.mocked(ExpenseService.listExpenses).mockResolvedValue({
      data: [EXPENSE_STUB],
      nextCursor: null,
      hasNextPage: false,
    } as never);
  });

  it("rechaza sin sesión", async () => {
    setAuth(null);
    const r = await listExpensesAction(VALID_INPUT);
    expect(r.success).toBe(false);
  });

  it("rechaza si no es miembro (IDOR)", async () => {
    setNoMember();
    const r = await listExpensesAction(VALID_INPUT);
    expect(r.success).toBe(false);
  });

  it("retorna lista en camino feliz", async () => {
    const r = await listExpensesAction(VALID_INPUT);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.data).toHaveLength(1);
  });
});

// ─── createExpenseCategoryAction ──────────────────────────────────────────────

describe("createExpenseCategoryAction", () => {
  const VALID_INPUT = { companyId: COMPANY_ID, name: "Servicios" };

  beforeEach(() => {
    vi.mocked(ExpenseService.createExpenseCategory).mockResolvedValue({
      id: "cat-1",
      name: "Servicios",
      description: null,
    } as never);
  });

  it("rechaza sin sesión", async () => {
    setAuth(null);
    const r = await createExpenseCategoryAction(VALID_INPUT);
    expect(r.success).toBe(false);
  });

  it("crea categoría en camino feliz", async () => {
    const r = await createExpenseCategoryAction(VALID_INPUT);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Servicios");
  });
});

// ─── listExpenseCategoriesAction ─────────────────────────────────────────────

describe("listExpenseCategoriesAction", () => {
  beforeEach(() => {
    vi.mocked(ExpenseService.listExpenseCategories).mockResolvedValue([
      { id: "cat-1", name: "Servicios", description: null },
    ] as never);
  });

  it("rechaza sin sesión", async () => {
    setAuth(null);
    const r = await listExpenseCategoriesAction(COMPANY_ID);
    expect(r.success).toBe(false);
  });

  it("retorna lista en camino feliz", async () => {
    const r = await listExpenseCategoriesAction(COMPANY_ID);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveLength(1);
  });

  it("devuelve error estructurado si servicio lanza excepción", async () => {
    vi.mocked(ExpenseService.listExpenseCategories).mockRejectedValueOnce(
      new Error("DB no disponible"),
    );
    const r = await listExpenseCategoriesAction(COMPANY_ID);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBeTruthy();
  });
});
