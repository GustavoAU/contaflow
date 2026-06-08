// src/modules/budgets/__tests__/budget.actions.test.ts
// Q3-3: Tests para presupuestos y proyecciones.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {} },
}));
vi.mock("../services/BudgetService", () => ({
  BudgetService: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    upsertLine: vi.fn(),
    deleteLine: vi.fn(),
    compareWithActual: vi.fn(),
  },
}));
vi.mock("../services/CashFlowProjectionService", () => ({
  CashFlowProjectionService: {
    project: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/ratelimit";
import { BudgetService } from "../services/BudgetService";
import { CashFlowProjectionService } from "../services/CashFlowProjectionService";
import {
  listBudgetsAction,
  getBudgetAction,
  createBudgetAction,
  updateBudgetAction,
  deleteBudgetAction,
  upsertBudgetLineAction,
  deleteBudgetLineAction,
  getBudgetVsActualAction,
  getCashFlowProjectionAction,
} from "../actions/budget.actions";

const NOW = new Date("2026-01-01");

const mockBudget = {
  id: "bgt1",
  companyId: "c1",
  periodYear: 2026,
  name: "Presupuesto Anual",
  status: "DRAFT" as const,
  createdBy: "user1",
  createdAt: NOW,
  updatedAt: NOW,
  lines: [],
  totalAmount: "0.00",
};

const mockLine = {
  id: "line1",
  budgetId: "bgt1",
  companyId: "c1",
  accountId: "acc1",
  amount: "10000.00",
  notes: null,
  account: { id: "acc1", code: "5.01", name: "Gastos Admin", type: "EXPENSE" },
};

const mockVsActual = [
  {
    accountId: "acc1",
    accountCode: "5.01",
    accountName: "Gastos Admin",
    accountType: "EXPENSE",
    budgeted: "10000.00",
    actual: "8500.00",
    variance: "1500.00",
    pct: 85.0,
  },
];

const mockCashFlow = {
  buckets: [
    { label: "Vencido",   cxcAmount: "1000.00", cxpAmount: "500.00", netAmount: "500.00", invoiceCount: 2 },
    { label: "0-30 días", cxcAmount: "3000.00", cxpAmount: "1500.00", netAmount: "1500.00", invoiceCount: 4 },
    { label: "31-60 días", cxcAmount: "0.00", cxpAmount: "0.00", netAmount: "0.00", invoiceCount: 0 },
    { label: "61-90 días", cxcAmount: "0.00", cxpAmount: "0.00", netAmount: "0.00", invoiceCount: 0 },
  ],
  totalCxC: "4000.00",
  totalCxP: "2000.00",
  totalNet: "2000.00",
};

function setAuth(userId: string | null) {
  mockAuth.mockResolvedValue({ userId });
}
function setMember(role: string | null) {
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(
    role ? ({ role } as never) : (null as never),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
});

// ── Auth guards ───────────────────────────────────────────────────────────────
describe("Auth guards — sin sesión", () => {
  beforeEach(() => setAuth(null));

  it("listBudgetsAction → no autorizado", async () => {
    const r = await listBudgetsAction("c1");
    expect(r.success).toBe(false);
  });

  it("createBudgetAction → no autorizado", async () => {
    const r = await createBudgetAction("c1", { periodYear: 2026, name: "Test" });
    expect(r.success).toBe(false);
  });

  it("deleteBudgetAction → no autorizado", async () => {
    const r = await deleteBudgetAction("c1", "bgt1");
    expect(r.success).toBe(false);
  });

  it("getCashFlowProjectionAction → no autorizado", async () => {
    const r = await getCashFlowProjectionAction("c1");
    expect(r.success).toBe(false);
  });
});

// ── RBAC ─────────────────────────────────────────────────────────────────────
describe("RBAC", () => {
  it("ACCOUNTANT puede listar presupuestos", async () => {
    setAuth("user1");
    setMember("ACCOUNTANT");
    vi.mocked(BudgetService.list).mockResolvedValue([mockBudget] as never);

    const r = await listBudgetsAction("c1");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveLength(1);
  });

  it("VIEWER puede listar presupuestos (ROLES.ALL)", async () => {
    setAuth("user1");
    setMember("VIEWER");
    vi.mocked(BudgetService.list).mockResolvedValue([]) as never;

    const r = await listBudgetsAction("c1");
    expect(r.success).toBe(true);
  });

  it("VIEWER no puede crear presupuesto (requiere WRITERS)", async () => {
    setAuth("user1");
    setMember("VIEWER");

    const r = await createBudgetAction("c1", { periodYear: 2026, name: "Test" });
    expect(r.success).toBe(false);
    expect(BudgetService.create).not.toHaveBeenCalled();
  });

  it("ACCOUNTANT no puede eliminar presupuesto (requiere ADMIN_ONLY)", async () => {
    setAuth("user1");
    setMember("ACCOUNTANT");

    const r = await deleteBudgetAction("c1", "bgt1");
    expect(r.success).toBe(false);
    expect(BudgetService.delete).not.toHaveBeenCalled();
  });
});

// ── createBudgetAction ────────────────────────────────────────────────────────
describe("createBudgetAction", () => {
  beforeEach(() => {
    setAuth("user1");
    setMember("ACCOUNTANT");
  });

  it("crea presupuesto correctamente", async () => {
    vi.mocked(BudgetService.create).mockResolvedValue(mockBudget as never);

    const r = await createBudgetAction("c1", { periodYear: 2026, name: "Presupuesto Anual" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.periodYear).toBe(2026);
    expect(BudgetService.create).toHaveBeenCalledWith("c1", expect.objectContaining({ periodYear: 2026 }), "user1");
  });

  it("rechaza año inválido", async () => {
    const r = await createBudgetAction("c1", { periodYear: 1999, name: "Test" });
    expect(r.success).toBe(false);
    expect(BudgetService.create).not.toHaveBeenCalled();
  });

  it("rechaza nombre vacío", async () => {
    const r = await createBudgetAction("c1", { periodYear: 2026, name: "" });
    expect(r.success).toBe(false);
  });
});

// ── getBudgetAction ───────────────────────────────────────────────────────────
describe("getBudgetAction", () => {
  beforeEach(() => {
    setAuth("user1");
    setMember("ACCOUNTANT");
  });

  it("retorna presupuesto existente", async () => {
    vi.mocked(BudgetService.get).mockResolvedValue(mockBudget as never);
    const r = await getBudgetAction("c1", "bgt1");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.id).toBe("bgt1");
  });

  it("retorna error si no existe (ADR-004)", async () => {
    vi.mocked(BudgetService.get).mockResolvedValue(null as never);
    const r = await getBudgetAction("c1", "ghost");
    expect(r.success).toBe(false);
  });
});

// ── updateBudgetAction ────────────────────────────────────────────────────────
describe("updateBudgetAction", () => {
  beforeEach(() => {
    setAuth("user1");
    setMember("ACCOUNTANT");
  });

  it("actualiza status a ACTIVE", async () => {
    vi.mocked(BudgetService.update).mockResolvedValue({ ...mockBudget, status: "ACTIVE" } as never);
    const r = await updateBudgetAction("c1", "bgt1", { status: "ACTIVE" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe("ACTIVE");
  });

  it("retorna error si presupuesto no existe (ADR-004)", async () => {
    vi.mocked(BudgetService.update).mockResolvedValue(null as never);
    const r = await updateBudgetAction("c1", "ghost", { name: "Nuevo" });
    expect(r.success).toBe(false);
  });
});

// ── upsertBudgetLineAction ────────────────────────────────────────────────────
describe("upsertBudgetLineAction", () => {
  beforeEach(() => {
    setAuth("user1");
    setMember("ACCOUNTANT");
  });

  it("upsert correcto", async () => {
    vi.mocked(BudgetService.upsertLine).mockResolvedValue(mockLine as never);
    const r = await upsertBudgetLineAction("c1", "bgt1", { accountId: "acc1", amount: "10000" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBe("10000.00");
  });

  it("rechaza importe ≤ 0", async () => {
    const r = await upsertBudgetLineAction("c1", "bgt1", { accountId: "acc1", amount: "0" });
    expect(r.success).toBe(false);
    expect(BudgetService.upsertLine).not.toHaveBeenCalled();
  });

  it("rechaza importe negativo", async () => {
    const r = await upsertBudgetLineAction("c1", "bgt1", { accountId: "acc1", amount: "-500" });
    expect(r.success).toBe(false);
  });

  it("retorna error si cuenta no pertenece a empresa (ADR-004)", async () => {
    vi.mocked(BudgetService.upsertLine).mockResolvedValue(null as never);
    const r = await upsertBudgetLineAction("c1", "bgt1", { accountId: "acc-ajena", amount: "1000" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("no válidos");
  });
});

// ── deleteBudgetLineAction ────────────────────────────────────────────────────
describe("deleteBudgetLineAction", () => {
  beforeEach(() => {
    setAuth("user1");
    setMember("ACCOUNTANT");
  });

  it("elimina línea correctamente", async () => {
    vi.mocked(BudgetService.deleteLine).mockResolvedValue(true as never);
    const r = await deleteBudgetLineAction("c1", "bgt1", "acc1");
    expect(r.success).toBe(true);
  });

  it("retorna error si la línea no existe", async () => {
    vi.mocked(BudgetService.deleteLine).mockResolvedValue(false as never);
    const r = await deleteBudgetLineAction("c1", "bgt1", "acc-ghost");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("no encontrada");
  });

  it("rechaza si no está autenticado", async () => {
    setAuth(null);
    const r = await deleteBudgetLineAction("c1", "bgt1", "acc1");
    expect(r.success).toBe(false);
  });
});

// ── createBudgetAction P2002 ──────────────────────────────────────────────────
describe("createBudgetAction — P2002 nombre duplicado", () => {
  beforeEach(() => {
    setAuth("user1");
    setMember("ACCOUNTANT");
  });

  it("devuelve mensaje de negocio si ya existe el nombre para ese año", async () => {
    vi.mocked(BudgetService.create).mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint"), { code: "P2002" }),
    );
    const r = await createBudgetAction("c1", { periodYear: 2026, name: "Dup" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("Ya existe un presupuesto");
  });
});

// ── getBudgetVsActualAction ───────────────────────────────────────────────────
describe("getBudgetVsActualAction", () => {
  beforeEach(() => {
    setAuth("user1");
    setMember("ACCOUNTANT");
  });

  it("retorna comparación presupuestado vs real", async () => {
    vi.mocked(BudgetService.compareWithActual).mockResolvedValue(mockVsActual as never);
    const r = await getBudgetVsActualAction("c1", "bgt1");
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0].pct).toBe(85.0);
    }
  });

  it("retorna error si presupuesto no existe (ADR-004)", async () => {
    vi.mocked(BudgetService.compareWithActual).mockResolvedValue(null as never);
    const r = await getBudgetVsActualAction("c1", "ghost");
    expect(r.success).toBe(false);
  });
});

// ── getCashFlowProjectionAction ───────────────────────────────────────────────
describe("getCashFlowProjectionAction", () => {
  beforeEach(() => {
    setAuth("user1");
    setMember("ACCOUNTANT");
  });

  it("retorna proyección de flujo de caja", async () => {
    vi.mocked(CashFlowProjectionService.project).mockResolvedValue(mockCashFlow as never);
    const r = await getCashFlowProjectionAction("c1");
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.totalCxC).toBe("4000.00");
      expect(r.data.buckets).toHaveLength(4);
    }
    expect(CashFlowProjectionService.project).toHaveBeenCalledWith("c1");
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
describe("Rate limiting", () => {
  beforeEach(() => {
    setAuth("user1");
    setMember("ACCOUNTANT");
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);
  });

  it("createBudgetAction bloqueado por rate limit", async () => {
    const r = await createBudgetAction("c1", { periodYear: 2026, name: "Test" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("Demasiadas");
  });

  it("upsertBudgetLineAction bloqueado por rate limit", async () => {
    const r = await upsertBudgetLineAction("c1", "bgt1", { accountId: "acc1", amount: "1000" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("Demasiadas");
  });
});
