// src/modules/analytics/__tests__/KpiDashboardService.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import prisma from "@/lib/prisma";
import { KpiDashboardService } from "../services/KpiDashboardService";

vi.mock("@/lib/prisma", () => ({
  default: {
    invoice: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));

const COMPANY_ID = "company-abc";
const now = new Date("2026-04-14T12:00:00Z");

describe("KpiDashboardService.getKpiSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    // defaults vacíos
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.invoice.aggregate).mockResolvedValue({
      _sum: { totalAmountVes: null },
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retorna ceros cuando no hay facturas", async () => {
    const r = await KpiDashboardService.getKpiSummary(COMPANY_ID);
    expect(r.cxcTotal).toBe("0.00");
    expect(r.cxpTotal).toBe("0.00");
    expect(r.workingCapital).toBe("0.00");
    expect(r.dso).toBeNull();
  });

  it("separa CxC (SALE) y CxP (PURCHASE) correctamente", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { type: "SALE",     pendingAmount: "1000.00" },
      { type: "PURCHASE", pendingAmount: "400.00" },
    ] as never);

    const r = await KpiDashboardService.getKpiSummary(COMPANY_ID);
    expect(r.cxcTotal).toBe("1000.00");
    expect(r.cxpTotal).toBe("400.00");
    expect(r.workingCapital).toBe("600.00");
  });

  it("capital de trabajo negativo cuando CxP > CxC", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { type: "SALE",     pendingAmount: "200.00" },
      { type: "PURCHASE", pendingAmount: "500.00" },
    ] as never);

    const r = await KpiDashboardService.getKpiSummary(COMPANY_ID);
    expect(r.workingCapital).toBe("-300.00");
  });

  it("calcula DSO = (CxC / ventas_30d) × 30 redondeado", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { type: "SALE", pendingAmount: "600.00" },
    ] as never);
    vi.mocked(prisma.invoice.aggregate).mockResolvedValue({
      _sum: { totalAmountVes: "1000.00" },
    } as never);

    const r = await KpiDashboardService.getKpiSummary(COMPANY_ID);
    // DSO = (600 / 1000) × 30 = 18
    expect(r.dso).toBe(18);
  });

  it("DSO es null si no hay ventas en últimos 30 días", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { type: "SALE", pendingAmount: "500.00" },
    ] as never);
    vi.mocked(prisma.invoice.aggregate).mockResolvedValue({
      _sum: { totalAmountVes: null },
    } as never);

    const r = await KpiDashboardService.getKpiSummary(COMPANY_ID);
    expect(r.dso).toBeNull();
  });

  it("ignora facturas con pendingAmount null", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { type: "SALE", pendingAmount: null },
      { type: "PURCHASE", pendingAmount: null },
    ] as never);

    const r = await KpiDashboardService.getKpiSummary(COMPANY_ID);
    expect(r.cxcTotal).toBe("0.00");
    expect(r.cxpTotal).toBe("0.00");
  });
});

describe("KpiDashboardService.getCashFlowProjection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.invoice.aggregate).mockResolvedValue({
      _sum: { totalAmountVes: null },
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retorna 3 buckets con ceros cuando no hay facturas", async () => {
    const r = await KpiDashboardService.getCashFlowProjection(COMPANY_ID);
    expect(r).toHaveLength(3);
    expect(r[0]!.label).toBe("0-30d");
    expect(r[1]!.label).toBe("31-60d");
    expect(r[2]!.label).toBe("61-90d");
    r.forEach((b) => {
      expect(b.collections).toBe("0.00");
      expect(b.payments).toBe("0.00");
      expect(b.net).toBe("0.00");
    });
  });

  it("clasifica cobros en el bucket correcto (vence en 15 días → 0-30d)", async () => {
    const due15 = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { type: "SALE", dueDate: due15, pendingAmount: "800.00" },
    ] as never);

    const r = await KpiDashboardService.getCashFlowProjection(COMPANY_ID);
    expect(r[0]!.collections).toBe("800.00");
    expect(r[0]!.net).toBe("800.00");
  });

  it("clasifica pagos en bucket 31-60d correctamente", async () => {
    const due45 = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { type: "PURCHASE", dueDate: due45, pendingAmount: "300.00" },
    ] as never);

    const r = await KpiDashboardService.getCashFlowProjection(COMPANY_ID);
    expect(r[1]!.payments).toBe("300.00");
    expect(r[1]!.net).toBe("-300.00");
  });

  it("net negativo cuando pagos > cobros en misma ventana", async () => {
    const due10 = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { type: "SALE",     dueDate: due10, pendingAmount: "100.00" },
      { type: "PURCHASE", dueDate: due10, pendingAmount: "250.00" },
    ] as never);

    const r = await KpiDashboardService.getCashFlowProjection(COMPANY_ID);
    expect(r[0]!.net).toBe("-150.00");
  });

  it("ignora facturas con dueDate o pendingAmount null", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { type: "SALE", dueDate: null, pendingAmount: "500.00" },
      { type: "SALE", dueDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000), pendingAmount: null },
    ] as never);

    const r = await KpiDashboardService.getCashFlowProjection(COMPANY_ID);
    expect(r[0]!.collections).toBe("0.00");
  });
});
