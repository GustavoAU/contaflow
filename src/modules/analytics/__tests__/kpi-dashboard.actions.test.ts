// src/modules/analytics/__tests__/kpi-dashboard.actions.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { KpiDashboardService } from "../services/KpiDashboardService";
import { checkRateLimit } from "@/lib/ratelimit";

const { emptyKpi } = vi.hoisted(() => ({
  emptyKpi: {
    summary: { cxcTotal: "0.00", cxpTotal: "0.00", workingCapital: "0.00", dso: null },
    cashFlow: [
      { label: "0-30d"  as const, collections: "0.00", payments: "0.00", net: "0.00" },
      { label: "31-60d" as const, collections: "0.00", payments: "0.00", net: "0.00" },
      { label: "61-90d" as const, collections: "0.00", payments: "0.00", net: "0.00" },
    ],
  },
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {}, ocr: {}, read: {} },  fiscalKey: (c: string, u: string) => `${c}:${u}`,
}));

vi.mock("../services/KpiDashboardService", () => ({
  KpiDashboardService: {
    getKpiSummary: vi.fn().mockResolvedValue(emptyKpi.summary),
    getCashFlowProjection: vi.fn().mockResolvedValue(emptyKpi.cashFlow),
  },
}));

const COMPANY_ID = "company-abc";

import { getKpiDashboardAction } from "../actions/kpi-dashboard.actions";
import { auth } from "@clerk/nextjs/server";

describe("getKpiDashboardAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(KpiDashboardService.getKpiSummary).mockResolvedValue(emptyKpi.summary);
    vi.mocked(KpiDashboardService.getCashFlowProjection).mockResolvedValue(emptyKpi.cashFlow);
  });

  it("ACCOUNTANT recibe datos KPI", async () => {
    const r = await getKpiDashboardAction(COMPANY_ID);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.summary).toBeDefined();
      expect(r.data.cashFlow).toHaveLength(3);
    }
  });

  it("OWNER recibe datos KPI", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "OWNER" } as never);
    const r = await getKpiDashboardAction(COMPANY_ID);
    expect(r.success).toBe(true);
  });

  it("ADMINISTRATIVE es rechazado (no es ACCOUNTING)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ADMINISTRATIVE" } as never);
    const r = await getKpiDashboardAction(COMPANY_ID);
    expect(r.success).toBe(false);
  });

  it("VIEWER es rechazado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const r = await getKpiDashboardAction(COMPANY_ID);
    expect(r.success).toBe(false);
  });

  it("sin userId retorna error no autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await getKpiDashboardAction(COMPANY_ID);
    expect(r).toEqual({ success: false, error: "No autorizado" });
  });

  it("sin membresía retorna acceso denegado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const r = await getKpiDashboardAction(COMPANY_ID);
    expect(r).toEqual({ success: false, error: "Empresa no encontrada o acceso denegado" });
  });

  it("propaga errores del servicio", async () => {
    vi.mocked(KpiDashboardService.getKpiSummary).mockRejectedValueOnce(new Error("DB error"));
    const r = await getKpiDashboardAction(COMPANY_ID);
    expect(r).toEqual({ success: false, error: "DB error" });
  });

  it("rate limit excedido retorna error", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false } as never);
    const r = await getKpiDashboardAction(COMPANY_ID);
    expect(r.success).toBe(false);
  });
});
