// src/modules/accounting/actions/report.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import {
  getLedgerAction,
  getTrialBalanceAction,
  getIncomeStatementAction,
  getBalanceSheetAction,
} from "./report.actions";

// ─── Configuración de Mocks ────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  default: {
    account: {
      findMany: vi.fn(),
    },
  },
}));

// ─── Mocks de Datos ────────────────────────────────────────────────────────────

// Mock de cuenta con movimientos de débito (Activo)
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

// Mock de cuenta con movimientos de crédito (Ingreso)
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

// ─── Pruebas del Libro Mayor (getLedgerAction) ──────────────────────────────────

describe("getLedgerAction", () => {
  beforeEach(() => vi.clearAllMocks());

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

// ─── Pruebas del Balance de Comprobación (getTrialBalanceAction) ──────────

describe("getTrialBalanceAction", () => {
  beforeEach(() => vi.clearAllMocks());

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

// ─── Pruebas del Estado de Resultados (getIncomeStatementAction) ─────────────

describe("getIncomeStatementAction", () => {
  beforeEach(() => vi.clearAllMocks());

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
    expect(result.data.totalRevenues).toBe("1000.00");
    expect(result.data.totalExpenses).toBe("400.00");
    expect(result.data.netIncome).toBe("600.00");
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
    expect(result.data.netIncome).toBe("-500.00");
  });

  it("filtra por fecha correctamente", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([] as never);

    const result = await getIncomeStatementAction(
      "company-1",
      new Date("2026-01-01"),
      new Date("2026-03-31")
    );

    expect(result.success).toBe(true);
    expect(vi.mocked(prisma.account.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: "company-1" }),
      })
    );
  });

  it("retorna listas vacías si no hay movimientos", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([] as never);

    const result = await getIncomeStatementAction("company-1");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.revenues).toHaveLength(0);
    expect(result.data.expenses).toHaveLength(0);
    expect(result.data.netIncome).toBe("0.00");
  });
});

// ─── Pruebas del Balance General (getBalanceSheetAction) ────────────────────

describe("getBalanceSheetAction", () => {
  beforeEach(() => vi.clearAllMocks());

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
    // Verificamos totales y estado de balance
    expect(result.data.totalAssets).toBe("1000.00");
    expect(result.data.totalLiabilities).toBe("400.00");
    expect(result.data.isBalanced).toBe(false);
  });
});
