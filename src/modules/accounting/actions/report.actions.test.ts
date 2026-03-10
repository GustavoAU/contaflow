// src/modules/accounting/actions/report.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    account: {
      findMany: vi.fn(),
    },
  },
}));

import prisma from "@/lib/prisma";
import { getLedgerAction, getTrialBalanceAction } from "./report.actions";

// ─── Mock de cuenta con movimientos ──────────────────────────────────────────

const mockAccount = {
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
        description: "Venta de mercancia",
        date: new Date("2026-03-10"),
        status: "POSTED",
      },
    },
  ],
};

const mockAccountCredit = {
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
        description: "Venta de mercancia",
        date: new Date("2026-03-10"),
        status: "POSTED",
      },
    },
  ],
};

describe("getLedgerAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna cuentas con movimientos correctamente", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([mockAccount] as never);

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

  it("calcula saldo acumulado correctamente", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([mockAccountCredit] as never);

    const result = await getLedgerAction("company-1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].totalCredit).toBe("1000.00");
      expect(result.data[0].balance).toBe("-1000.00");
    }
  });

  it("excluye cuentas sin movimientos", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { ...mockAccount, journalEntries: [] },
    ] as never);

    const result = await getLedgerAction("company-1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });
});

describe("getTrialBalanceAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna balance de comprobacion balanceado", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([mockAccount, mockAccountCredit] as never);

    const result = await getTrialBalanceAction("company-1");

    expect(result.success).toBe(true);
    if (result.success) {
      const totalDebit = result.data.reduce((acc, r) => acc + Number(r.totalDebit), 0);
      const totalCredit = result.data.reduce((acc, r) => acc + Number(r.totalCredit), 0);
      expect(totalDebit).toBe(totalCredit);
    }
  });

  it("calcula saldo correcto por cuenta", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([mockAccount] as never);

    const result = await getTrialBalanceAction("company-1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].balance).toBe("1000.00");
    }
  });
});
