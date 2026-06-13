// src/modules/accounting/__tests__/report.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { fiscal: {}, ocr: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    transaction: { findMany: vi.fn() },
    account: { findMany: vi.fn() },
    accountingPeriod: { findFirst: vi.fn() },
    journalEntry: { groupBy: vi.fn() },
  },
}));

import prisma from "@/lib/prisma";
import {
  getJournalAction,
  getLedgerAction,
  getTrialBalanceAction,
  getIncomeStatementAction,
  getBalanceSheetAction,
} from "../actions/report.actions";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const MEMBER = { role: "ACCOUNTANT" };

const mockAccountAsset = {
  id: "acc-1",
  code: "1110",
  name: "Bancos",
  type: "ASSET",
  isCurrent: true,
  journalEntries: [
    {
      amount: 1000,
      transactionId: "tx-1",
      transaction: {
        id: "tx-1",
        number: "2026-03-000001",
        description: "Venta de mercancía",
        date: new Date("2026-03-10"),
        status: "POSTED",
      },
    },
  ],
};

const mockAccountRevenue = {
  id: "acc-2",
  code: "4135",
  name: "Ventas",
  type: "REVENUE",
  isCurrent: false,
  journalEntries: [
    {
      amount: -1000,
      transactionId: "tx-1",
      transaction: {
        id: "tx-1",
        number: "2026-03-000001",
        description: "Venta de mercancía",
        date: new Date("2026-03-10"),
        status: "POSTED",
      },
    },
  ],
};

// Helper: configura auth y rate-limit OK para el test activo
function setupAuthOk() {
  mockAuth.mockResolvedValue({ userId: USER_ID });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER as never);
  vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);
  vi.mocked(prisma.account.findMany).mockResolvedValue([]);
  vi.mocked(prisma.journalEntry.groupBy).mockResolvedValue([]);
}

// ─── Security guards — tabla de acciones ─────────────────────────────────────

const REPORT_ACTIONS = [
  { name: "getJournalAction",        fn: () => getJournalAction(COMPANY_ID) },
  { name: "getLedgerAction",         fn: () => getLedgerAction(COMPANY_ID) },
  { name: "getTrialBalanceAction",   fn: () => getTrialBalanceAction(COMPANY_ID) },
  { name: "getIncomeStatementAction",fn: () => getIncomeStatementAction(COMPANY_ID) },
  { name: "getBalanceSheetAction",   fn: () => getBalanceSheetAction(COMPANY_ID) },
];

describe("report.actions — security guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthOk();
  });

  for (const { name, fn } of REPORT_ACTIONS) {
    it(`${name}: rechaza solicitud sin sesión autenticada`, async () => {
      mockAuth.mockResolvedValue({ userId: null });

      const result = await fn();

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe("No autorizado");
      expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
    });

    it(`${name}: rechaza cuando rate limit está agotado`, async () => {
      mockCheckRateLimit.mockResolvedValue({
        allowed: false,
        error: "Demasiadas solicitudes. Intenta de nuevo en 30 segundos.",
      });

      const result = await fn();

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("Demasiadas solicitudes");
      expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
    });

    it(`${name}: rechaza usuario que no es miembro de la empresa (IDOR)`, async () => {
      vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

      const result = await fn();

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("Acceso denegado");
    });

    it(`${name}: rechaza rol VIEWER (requiere ACCOUNTING o superior)`, async () => {
      vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);

      const result = await fn();

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("Acceso denegado");
    });
  }
});

// ─── Validación de rango de fechas (M-7) ─────────────────────────────────────

describe("report.actions — validación dateFrom > dateTo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthOk();
  });

  it("getLedgerAction rechaza dateFrom posterior a dateTo", async () => {
    const result = await getLedgerAction(
      COMPANY_ID,
      new Date("2026-03-31"),
      new Date("2026-03-01"),
    );
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error).toContain("fecha de inicio debe ser anterior");
  });

  it("getTrialBalanceAction rechaza dateFrom posterior a dateTo", async () => {
    const result = await getTrialBalanceAction(
      COMPANY_ID,
      new Date("2026-12-31"),
      new Date("2026-01-01"),
    );
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error).toContain("fecha de inicio debe ser anterior");
  });

  it("getJournalAction rechaza dateFrom posterior a dateTo", async () => {
    const result = await getJournalAction(
      COMPANY_ID,
      new Date("2026-06-30"),
      new Date("2026-06-01"),
    );
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error).toContain("fecha de inicio debe ser anterior");
  });

  it("permite dateFrom === dateTo (mismo día)", async () => {
    const sameDay = new Date("2026-03-15");
    const result = await getLedgerAction(COMPANY_ID, sameDay, sameDay);
    expect(result.success).toBe(true);
  });
});

// ─── getLedgerAction — lógica ─────────────────────────────────────────────────

describe("getLedgerAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthOk();
  });

  it("retorna cuentas con movimientos correctamente", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([mockAccountAsset] as never);

    const result = await getLedgerAction(COMPANY_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].code).toBe("1110");
      expect(result.data[0].totalDebit).toBe("1000.00");
      expect(result.data[0].totalCredit).toBe("0.00");
      expect(result.data[0].balance).toBe("1000.00");
    }
  });

  it("calcula saldo acumulado correctamente para cuentas de crédito", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([mockAccountRevenue] as never);

    const result = await getLedgerAction(COMPANY_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].totalCredit).toBe("1000.00");
      expect(result.data[0].balance).toBe("-1000.00");
    }
  });

  it("excluye cuentas sin movimientos", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { ...mockAccountAsset, journalEntries: [] },
    ] as never);

    const result = await getLedgerAction(COMPANY_ID);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(0);
  });
});

// ─── getTrialBalanceAction — lógica ──────────────────────────────────────────

describe("getTrialBalanceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthOk();
  });

  it("retorna balance de comprobación balanceado", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      mockAccountAsset,
      mockAccountRevenue,
    ] as never);

    const result = await getTrialBalanceAction(COMPANY_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      const totalDebit = result.data.reduce((acc, r) => acc + Number(r.totalDebit), 0);
      const totalCredit = result.data.reduce((acc, r) => acc + Number(r.totalCredit), 0);
      expect(totalDebit).toBe(totalCredit);
    }
  });

  it("calcula saldo correcto por cuenta", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([mockAccountAsset] as never);

    const result = await getTrialBalanceAction(COMPANY_ID);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data[0].balance).toBe("1000.00");
  });
});

// ─── getIncomeStatementAction — lógica ───────────────────────────────────────

describe("getIncomeStatementAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthOk();
  });

  it("retorna utilidad cuando ingresos > gastos", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValueOnce([
      { id: "acc-1", code: "4135", name: "Ventas",            type: "REVENUE"  },
      { id: "acc-2", code: "5105", name: "Gastos de Personal", type: "EXPENSE" },
    ] as never);
    vi.mocked(prisma.journalEntry.groupBy).mockResolvedValueOnce([
      { accountId: "acc-1", _sum: { amount: "-1000" } },
      { accountId: "acc-2", _sum: { amount: "400"   } },
    ] as never);

    const result = await getIncomeStatementAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.current.totalRevenues).toBe("1000.00");
    expect(result.data.current.totalExpenses).toBe("400.00");
    expect(result.data.current.netIncome).toBe("600.00");
    expect(result.data.compare).toBeUndefined();
  });

  it("retorna pérdida cuando gastos > ingresos", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValueOnce([
      { id: "acc-1", code: "4135", name: "Ventas",  type: "REVENUE"  },
      { id: "acc-2", code: "5105", name: "Gastos",  type: "EXPENSE"  },
    ] as never);
    vi.mocked(prisma.journalEntry.groupBy).mockResolvedValueOnce([
      { accountId: "acc-1", _sum: { amount: "-300" } },
      { accountId: "acc-2", _sum: { amount: "800"  } },
    ] as never);

    const result = await getIncomeStatementAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.current.netIncome).toBe("-500.00");
  });

  it("filtra por fecha correctamente", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([] as never);

    const result = await getIncomeStatementAction(
      COMPANY_ID,
      new Date("2026-01-01"),
      new Date("2026-03-31"),
    );

    expect(result.success).toBe(true);
    expect(vi.mocked(prisma.account.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: COMPANY_ID }),
      }),
    );
  });

  it("retorna listas vacías si no hay movimientos", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([] as never);

    const result = await getIncomeStatementAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.current.revenues).toHaveLength(0);
    expect(result.data.current.expenses).toHaveLength(0);
    expect(result.data.current.netIncome).toBe("0.00");
  });

  it("retorna período comparativo cuando se pasan fechas de comparación", async () => {
    vi.mocked(prisma.account.findMany)
      .mockResolvedValueOnce([{ id: "acc-1", code: "4135", name: "Ventas", type: "REVENUE" }] as never)
      .mockResolvedValueOnce([{ id: "acc-1", code: "4135", name: "Ventas", type: "REVENUE" }] as never);
    vi.mocked(prisma.journalEntry.groupBy)
      .mockResolvedValueOnce([{ accountId: "acc-1", _sum: { amount: "-1000" } }] as never)
      .mockResolvedValueOnce([{ accountId: "acc-1", _sum: { amount: "-800"  } }] as never);

    const result = await getIncomeStatementAction(
      COMPANY_ID,
      new Date("2026-04-01"),
      new Date("2026-04-30"),
      new Date("2026-03-01"),
      new Date("2026-03-31"),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.current.totalRevenues).toBe("1000.00");
    expect(result.data.compare?.totalRevenues).toBe("800.00");
  });
});

// ─── getBalanceSheetAction — lógica ──────────────────────────────────────────

describe("getBalanceSheetAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthOk();
  });

  it("retorna balance cuadrado cuando Activos = Pasivos + Patrimonio", async () => {
    vi.mocked(prisma.account.findMany)
      .mockResolvedValueOnce([
        { id: "acc-1", code: "1105", name: "Caja",        type: "ASSET",     isCurrent: true  },
        { id: "acc-2", code: "2205", name: "Proveedores", type: "LIABILITY", isCurrent: true  },
        { id: "acc-3", code: "3105", name: "Capital",     type: "EQUITY",    isCurrent: false },
      ] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.journalEntry.groupBy)
      .mockResolvedValueOnce([
        { accountId: "acc-1", _sum: { amount: "1000"  } },
        { accountId: "acc-2", _sum: { amount: "-600"  } },
        { accountId: "acc-3", _sum: { amount: "-400"  } },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const result = await getBalanceSheetAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.totalAssets).toBe("1000.00");
    expect(result.data.totalLiabilities).toBe("600.00");
    expect(result.data.totalEquity).toBe("400.00");
    expect(result.data.isBalanced).toBe(true);
  });

  it("detecta balance descuadrado", async () => {
    vi.mocked(prisma.account.findMany)
      .mockResolvedValueOnce([
        { id: "acc-1", code: "1105", name: "Caja",        type: "ASSET",     isCurrent: true },
        { id: "acc-2", code: "2205", name: "Proveedores", type: "LIABILITY", isCurrent: true },
      ] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.journalEntry.groupBy)
      .mockResolvedValueOnce([
        { accountId: "acc-1", _sum: { amount: "1000" } },
        { accountId: "acc-2", _sum: { amount: "-400" } },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const result = await getBalanceSheetAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.isBalanced).toBe(false);
  });

  it("contra-activo (saldo crédito) reduce totalActivos — regresión bug balance.abs()", async () => {
    vi.mocked(prisma.account.findMany)
      .mockResolvedValueOnce([
        { id: "acc-1", code: "1640", name: "Maquinaria",              type: "ASSET",        isCurrent: false },
        { id: "acc-2", code: "1691", name: "Depreciación Acumulada",  type: "CONTRA_ASSET", isCurrent: false },
        { id: "acc-3", code: "2205", name: "Proveedores",             type: "LIABILITY",    isCurrent: true  },
        { id: "acc-4", code: "3105", name: "Capital",                 type: "EQUITY",       isCurrent: false },
      ] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.journalEntry.groupBy)
      .mockResolvedValueOnce([
        { accountId: "acc-1", _sum: { amount: "10000"  } },
        { accountId: "acc-2", _sum: { amount: "-4000"  } },
        { accountId: "acc-3", _sum: { amount: "-4000"  } },
        { accountId: "acc-4", _sum: { amount: "-2000"  } },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const result = await getBalanceSheetAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.totalAssets).toBe("6000.00");
    expect(result.data.totalLiabilities).toBe("4000.00");
    expect(result.data.totalEquity).toBe("2000.00");
    expect(result.data.isBalanced).toBe(true);

    const depRow = result.data.assets.find((r) => r.code === "1691");
    expect(depRow?.balance).toBe("-4000.00");
  });

  // H-3: "Resultado del Ejercicio" en Balance usa el año fiscal del corte, no all-time (hallazgo #3)
  it("Resultado del Ejercicio refleja solo el año del dateTo, no acumulado histórico", async () => {
    vi.mocked(prisma.account.findMany)
      .mockResolvedValueOnce([
        { id: "acc-1", code: "1105", name: "Caja",    type: "ASSET",  isCurrent: true  },
        { id: "acc-2", code: "3105", name: "Capital", type: "EQUITY", isCurrent: false },
      ] as never)
      // Income accounts scoped to fiscal year
      .mockResolvedValueOnce([
        { id: "acc-3", code: "4135", name: "Ventas", type: "REVENUE", isCurrent: false },
        { id: "acc-4", code: "5105", name: "Gastos", type: "EXPENSE", isCurrent: false },
      ] as never);
    vi.mocked(prisma.journalEntry.groupBy)
      .mockResolvedValueOnce([
        { accountId: "acc-1", _sum: { amount: "1600"  } },
        { accountId: "acc-2", _sum: { amount: "-1000" } },
      ] as never)
      // Income sums scoped to fiscal year → utilidad 600
      .mockResolvedValueOnce([
        { accountId: "acc-3", _sum: { amount: "-1000" } },
        { accountId: "acc-4", _sum: { amount: "400"   } },
      ] as never);

    const result = await getBalanceSheetAction(COMPANY_ID, new Date("2026-12-31"));
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Resultado del Ejercicio = 1000 - 400 = 600
    const resultadoRow = result.data.equity.find((r) => r.id === "net-income");
    expect(resultadoRow?.balance).toBe("600.00");
    // Balance cuadrado: Activos(1600) = Pasivos(0) + Patrimonio(1000 + 600)
    expect(result.data.isBalanced).toBe(true);
  });
});
