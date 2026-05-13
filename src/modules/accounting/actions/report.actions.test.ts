// src/modules/accounting/actions/report.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { fiscal: {}, ocr: {} },
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    account: { findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
  },
}));

import prisma from "@/lib/prisma";
import {
  getLedgerAction,
  getTrialBalanceAction,
  getIncomeStatementAction,
  getBalanceSheetAction,
} from "./report.actions";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockAccountAsset = {
  id: "acc-1",
  code: "1110",
  name: "Bancos",
  type: "ASSET",
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

// ─── Setup auth/rateLimit por defecto ─────────────────────────────────────────

function setupAuthOk() {
  mockAuth.mockResolvedValue({ userId: "user-1" });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
}

// ─── getLedgerAction ──────────────────────────────────────────────────────────

describe("getLedgerAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthOk();
  });

  it("retorna cuentas con movimientos correctamente", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([mockAccountAsset] as never);

    const result = await getLedgerAction("company-1");

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

    const result = await getLedgerAction("company-1");

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

    const result = await getLedgerAction("company-1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });
});

// ─── getTrialBalanceAction ────────────────────────────────────────────────────

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

    const result = await getTrialBalanceAction("company-1");

    expect(result.success).toBe(true);
    if (result.success) {
      const totalDebit = result.data.reduce((acc, r) => acc + Number(r.totalDebit), 0);
      const totalCredit = result.data.reduce((acc, r) => acc + Number(r.totalCredit), 0);
      expect(totalDebit).toBe(totalCredit);
    }
  });

  it("calcula saldo correcto por cuenta", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([mockAccountAsset] as never);

    const result = await getTrialBalanceAction("company-1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].balance).toBe("1000.00");
    }
  });
});

// ─── getIncomeStatementAction ─────────────────────────────────────────────────

describe("getIncomeStatementAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthOk();
  });

  it("retorna utilidad cuando ingresos > gastos", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      {
        id: "acc-1",
        code: "4135",
        name: "Ventas",
        type: "REVENUE",
        journalEntries: [{ amount: { toString: () => "-1000" } }],
      },
      {
        id: "acc-2",
        code: "5105",
        name: "Gastos de Personal",
        type: "EXPENSE",
        journalEntries: [{ amount: { toString: () => "400" } }],
      },
    ] as never);

    const result = await getIncomeStatementAction("company-1");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.current.totalRevenues).toBe("1000.00");
    expect(result.data.current.totalExpenses).toBe("400.00");
    expect(result.data.current.netIncome).toBe("600.00");
    expect(result.data.compare).toBeUndefined();
  });

  it("retorna pérdida cuando gastos > ingresos", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      {
        id: "acc-1",
        code: "4135",
        name: "Ventas",
        type: "REVENUE",
        journalEntries: [{ amount: { toString: () => "-300" } }],
      },
      {
        id: "acc-2",
        code: "5105",
        name: "Gastos",
        type: "EXPENSE",
        journalEntries: [{ amount: { toString: () => "800" } }],
      },
    ] as never);

    const result = await getIncomeStatementAction("company-1");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.current.netIncome).toBe("-500.00");
  });

  it("filtra por fecha correctamente", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([] as never);

    const result = await getIncomeStatementAction(
      "company-1",
      new Date("2026-01-01"),
      new Date("2026-03-31"),
    );

    expect(result.success).toBe(true);
    expect(vi.mocked(prisma.account.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: "company-1" }),
      }),
    );
  });

  it("retorna listas vacías si no hay movimientos", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([] as never);

    const result = await getIncomeStatementAction("company-1");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.current.revenues).toHaveLength(0);
    expect(result.data.current.expenses).toHaveLength(0);
    expect(result.data.current.netIncome).toBe("0.00");
  });

  it("retorna período comparativo cuando se pasan fechas cmp", async () => {
    vi.mocked(prisma.account.findMany)
      .mockResolvedValueOnce([
        {
          id: "acc-1", code: "4135", name: "Ventas", type: "REVENUE",
          journalEntries: [{ amount: { toString: () => "-1000" } }],
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: "acc-1", code: "4135", name: "Ventas", type: "REVENUE",
          journalEntries: [{ amount: { toString: () => "-800" } }],
        },
      ] as never);

    const result = await getIncomeStatementAction(
      "company-1",
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

// ─── getBalanceSheetAction ────────────────────────────────────────────────────

describe("getBalanceSheetAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthOk();
  });

  it("retorna balance cuadrado cuando Activos = Pasivos + Patrimonio", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      {
        id: "acc-1",
        code: "1105",
        name: "Caja",
        type: "ASSET",
        journalEntries: [{ amount: { toString: () => "1000" } }],
      },
      {
        id: "acc-2",
        code: "2205",
        name: "Proveedores",
        type: "LIABILITY",
        journalEntries: [{ amount: { toString: () => "-600" } }],
      },
      {
        id: "acc-3",
        code: "3105",
        name: "Capital",
        type: "EQUITY",
        journalEntries: [{ amount: { toString: () => "-400" } }],
      },
    ] as never);

    const result = await getBalanceSheetAction("company-1");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.totalAssets).toBe("1000.00");
    expect(result.data.totalLiabilities).toBe("600.00");
    expect(result.data.totalEquity).toBe("400.00");
    expect(result.data.isBalanced).toBe(true);
  });

  it("detecta balance descuadrado", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      {
        id: "acc-1",
        code: "1105",
        name: "Caja",
        type: "ASSET",
        journalEntries: [{ amount: { toString: () => "1000" } }],
      },
      {
        id: "acc-2",
        code: "2205",
        name: "Proveedores",
        type: "LIABILITY",
        journalEntries: [{ amount: { toString: () => "-400" } }],
      },
    ] as never);

    const result = await getBalanceSheetAction("company-1");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.totalAssets).toBe("1000.00");
    expect(result.data.totalLiabilities).toBe("400.00");
    expect(result.data.isBalanced).toBe(false);
  });

  it("contra-activo (saldo crédito) reduce totalActivos — regresión bug balance.abs()", async () => {
    vi.mocked(prisma.account.findMany)
      .mockResolvedValueOnce([
        {
          id: "acc-1", code: "1640", name: "Maquinaria", type: "ASSET",
          journalEntries: [{ amount: { toString: () => "10000" } }],
        },
        {
          id: "acc-2", code: "1691", name: "Depreciación Acumulada Maquinaria", type: "ASSET",
          journalEntries: [{ amount: { toString: () => "-4000" } }],
        },
        {
          id: "acc-3", code: "2205", name: "Proveedores", type: "LIABILITY",
          journalEntries: [{ amount: { toString: () => "-4000" } }],
        },
        {
          id: "acc-4", code: "3105", name: "Capital", type: "EQUITY",
          journalEntries: [{ amount: { toString: () => "-2000" } }],
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const result = await getBalanceSheetAction("company-1");
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.totalAssets).toBe("6000.00");
    expect(result.data.totalLiabilities).toBe("4000.00");
    expect(result.data.totalEquity).toBe("2000.00");
    expect(result.data.isBalanced).toBe(true);

    const depRow = result.data.assets.find((r) => r.code === "1691");
    expect(depRow?.balance).toBe("-4000.00");
  });
});
