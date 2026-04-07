import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import { DashboardAnalyticsService } from "../services/DashboardAnalyticsService";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    invoiceTaxLine: { groupBy: vi.fn() },
    invoice: { findMany: vi.fn() },
    bankTransaction: { count: vi.fn() },
    exchangeRate: { findMany: vi.fn() },
  },
}));

beforeEach(() => vi.clearAllMocks());

// ─── getRevenueExpenseTrend ───────────────────────────────────────────────────

describe("DashboardAnalyticsService.getRevenueExpenseTrend", () => {
  it("mapea filas raw a MonthlyRevExpPoint con tipos correctos", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { year: BigInt(2026), month: BigInt(1), revenue: "5000.0000", expenses: "3200.0000" },
      { year: BigInt(2026), month: BigInt(2), revenue: "6500.0000", expenses: "4100.0000" },
    ] as never);

    const result = await DashboardAnalyticsService.getRevenueExpenseTrend("co-1", 2026);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ year: 2026, month: 1, revenue: "5000.0000", expenses: "3200.0000" });
    expect(result[1]).toEqual({ year: 2026, month: 2, revenue: "6500.0000", expenses: "4100.0000" });
  });

  it("convierte bigint a number", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { year: BigInt(2026), month: BigInt(12), revenue: "0", expenses: "0" },
    ] as never);

    const [point] = await DashboardAnalyticsService.getRevenueExpenseTrend("co-1", 2026);
    expect(typeof point.year).toBe("number");
    expect(typeof point.month).toBe("number");
  });

  it("retorna array vacío cuando no hay asientos", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);

    const result = await DashboardAnalyticsService.getRevenueExpenseTrend("co-1", 2025);
    expect(result).toEqual([]);
  });
});

// ─── getIvaComposition ────────────────────────────────────────────────────────

describe("DashboardAnalyticsService.getIvaComposition", () => {
  it("retorna items agrupados por taxType", async () => {
    vi.mocked(prisma.invoiceTaxLine.groupBy).mockResolvedValue([
      { taxType: "IVA_GENERAL", _sum: { amount: new Decimal("16000.00") } },
      { taxType: "EXENTO", _sum: { amount: new Decimal("0.00") } },
    ] as never);

    const result = await DashboardAnalyticsService.getIvaComposition("co-1");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ taxType: "IVA_GENERAL", totalAmount: "16000" });
  });

  it("filtra filas con _sum.amount null", async () => {
    vi.mocked(prisma.invoiceTaxLine.groupBy).mockResolvedValue([
      { taxType: "IVA_REDUCIDO", _sum: { amount: null } },
    ] as never);

    const result = await DashboardAnalyticsService.getIvaComposition("co-1");
    expect(result).toHaveLength(0);
  });

  it("pasa filtro de año cuando se especifica", async () => {
    vi.mocked(prisma.invoiceTaxLine.groupBy).mockResolvedValue([] as never);

    await DashboardAnalyticsService.getIvaComposition("co-1", 2026);

    expect(prisma.invoiceTaxLine.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          invoice: expect.objectContaining({
            date: {
              gte: new Date("2026-01-01T00:00:00.000Z"),
              lt: new Date("2027-01-01T00:00:00.000Z"),
            },
          }),
        }),
      }),
    );
  });
});

// ─── getAgingBuckets ──────────────────────────────────────────────────────────

describe("DashboardAnalyticsService.getAgingBuckets", () => {
  it("clasifica facturas en los 4 buckets correctamente", async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const daysAgo = (n: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - n);
      return d;
    };

    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      // CxC — SALE — 15 días vencida → bucket "0-30"
      {
        type: "SALE",
        dueDate: daysAgo(15),
        pendingAmount: new Decimal("1000.00"),
      },
      // CxP — PURCHASE — 45 días vencida → bucket "31-60"
      {
        type: "PURCHASE",
        dueDate: daysAgo(45),
        pendingAmount: new Decimal("2000.00"),
      },
      // CxC — SALE — 75 días vencida → bucket "61-90"
      {
        type: "SALE",
        dueDate: daysAgo(75),
        pendingAmount: new Decimal("500.00"),
      },
      // CxP — PURCHASE — 100 días vencida → bucket "90+"
      {
        type: "PURCHASE",
        dueDate: daysAgo(100),
        pendingAmount: new Decimal("3000.00"),
      },
    ] as never);

    const result = await DashboardAnalyticsService.getAgingBuckets("co-1");

    expect(result).toHaveLength(4);

    const b0_30 = result.find((r) => r.bucket === "0-30")!;
    expect(b0_30.cxcAmount).toBe("1000.00");
    expect(b0_30.cxpAmount).toBe("0.00");

    const b31_60 = result.find((r) => r.bucket === "31-60")!;
    expect(b31_60.cxcAmount).toBe("0.00");
    expect(b31_60.cxpAmount).toBe("2000.00");

    const b61_90 = result.find((r) => r.bucket === "61-90")!;
    expect(b61_90.cxcAmount).toBe("500.00");

    const b90plus = result.find((r) => r.bucket === "90+")!;
    expect(b90plus.cxpAmount).toBe("3000.00");
  });

  it("devuelve todos los buckets en cero cuando no hay facturas pendientes", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    const result = await DashboardAnalyticsService.getAgingBuckets("co-1");
    expect(result).toHaveLength(4);
    result.forEach((b) => {
      expect(b.cxcAmount).toBe("0.00");
      expect(b.cxpAmount).toBe("0.00");
    });
  });

  it("ignora facturas sin dueDate o sin pendingAmount", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { type: "SALE", dueDate: null, pendingAmount: new Decimal("500") },
      { type: "SALE", dueDate: new Date(), pendingAmount: null },
    ] as never);

    const result = await DashboardAnalyticsService.getAgingBuckets("co-1");
    result.forEach((b) => {
      expect(b.cxcAmount).toBe("0.00");
    });
  });
});

// ─── getBankReconciliationRatio ───────────────────────────────────────────────

describe("DashboardAnalyticsService.getBankReconciliationRatio", () => {
  it("calcula ratio correctamente", async () => {
    vi.mocked(prisma.bankTransaction.count)
      .mockResolvedValueOnce(100) // total
      .mockResolvedValueOnce(75); // reconciled

    const result = await DashboardAnalyticsService.getBankReconciliationRatio("co-1");

    expect(result.total).toBe(100);
    expect(result.reconciled).toBe(75);
    expect(result.unreconciled).toBe(25);
    expect(result.ratioPercent).toBe(75);
  });

  it("retorna ratio 0 cuando no hay transacciones", async () => {
    vi.mocked(prisma.bankTransaction.count)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const result = await DashboardAnalyticsService.getBankReconciliationRatio("co-1");
    expect(result.ratioPercent).toBe(0);
    expect(result.total).toBe(0);
  });

  it("redondea al entero más cercano", async () => {
    vi.mocked(prisma.bankTransaction.count)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);

    const result = await DashboardAnalyticsService.getBankReconciliationRatio("co-1");
    expect(result.ratioPercent).toBe(33); // round(1/3 * 100)
  });
});

// ─── getBcvRateTrend ──────────────────────────────────────────────────────────

describe("DashboardAnalyticsService.getBcvRateTrend", () => {
  it("retorna puntos con date en formato YYYY-MM-DD", async () => {
    vi.mocked(prisma.exchangeRate.findMany).mockResolvedValue([
      { date: new Date("2026-03-01T00:00:00.000Z"), rate: new Decimal("36.50") },
      { date: new Date("2026-03-15T00:00:00.000Z"), rate: new Decimal("37.20") },
    ] as never);

    const result = await DashboardAnalyticsService.getBcvRateTrend("co-1");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ date: "2026-03-01", rate: "36.5" });
    expect(result[1]).toEqual({ date: "2026-03-15", rate: "37.2" });
  });

  it("pasa currency y filtro de fecha al query", async () => {
    vi.mocked(prisma.exchangeRate.findMany).mockResolvedValue([] as never);

    await DashboardAnalyticsService.getBcvRateTrend("co-1", "USD" as never, 6);

    expect(prisma.exchangeRate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: "co-1", currency: "USD" }),
        orderBy: { date: "asc" },
      }),
    );
  });

  it("retorna array vacío cuando no hay tasas registradas", async () => {
    vi.mocked(prisma.exchangeRate.findMany).mockResolvedValue([] as never);

    const result = await DashboardAnalyticsService.getBcvRateTrend("co-1");
    expect(result).toEqual([]);
  });
});
