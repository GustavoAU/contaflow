// src/modules/accounting/actions/dashboard.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    account: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    transaction: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    accountingPeriod: {
      findFirst: vi.fn(),
    },
  },
}));

import prisma from "@/lib/prisma";
import { getDashboardMetricsAction } from "./dashboard.actions";

const mockActivePeriod = {
  id: "period-1",
  year: 2026,
  month: 3,
  status: "OPEN",
};

const mockLastTransaction = {
  number: "2026-03-000001",
  description: "Venta de mercancia",
  date: new Date("2026-03-10"),
};

beforeEach(() => vi.clearAllMocks());

describe("getDashboardMetricsAction", () => {
  it("retorna métricas correctamente con data", async () => {
    vi.mocked(prisma.account.count).mockResolvedValue(6);
    vi.mocked(prisma.transaction.count)
      .mockResolvedValueOnce(1) // totalTransactions
      .mockResolvedValueOnce(1); // monthTransactions
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(mockActivePeriod as never);
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(mockLastTransaction as never);
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      {
        type: "ASSET",
        journalEntries: [{ amount: 1000 }],
      },
      {
        type: "REVENUE",
        journalEntries: [{ amount: -1000 }],
      },
    ] as never);

    const result = await getDashboardMetricsAction("company-1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalAccounts).toBe(6);
      expect(result.data.totalTransactions).toBe(1);
      expect(result.data.totalAssets).toBe("1000.00");
      expect(result.data.totalRevenue).toBe("1000.00");
      expect(result.data.netIncome).toBe("1000.00");
      expect(result.data.activePeriod?.month).toBe(3);
    }
  });

  it("retorna métricas vacías si no hay data", async () => {
    vi.mocked(prisma.account.count).mockResolvedValue(0);
    vi.mocked(prisma.transaction.count).mockResolvedValue(0);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.account.findMany).mockResolvedValue([]);

    const result = await getDashboardMetricsAction("company-1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalAccounts).toBe(0);
      expect(result.data.activePeriod).toBeNull();
      expect(result.data.netIncome).toBe("0.00");
    }
  });

  it("retorna error si falla la query", async () => {
    vi.mocked(prisma.account.count).mockRejectedValue(new Error("DB error"));

    const result = await getDashboardMetricsAction("company-1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("DB error");
    }
  });
});
