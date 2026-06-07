// src/modules/accounting/__tests__/dashboard.actions.test.ts
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
    account: { count: vi.fn(), findMany: vi.fn() },
    transaction: { count: vi.fn(), findFirst: vi.fn() },
    accountingPeriod: { findFirst: vi.fn() },
  },
}));

import prisma from "@/lib/prisma";
import { getDashboardMetricsAction } from "../actions/dashboard.actions";

const COMPANY_ID = "company-1";
const USER_ID = "user-1";

const mockActivePeriod = { id: "period-1", year: 2026, month: 3, status: "OPEN" };
const mockLastTransaction = {
  number: "2026-03-000001",
  description: "Venta de mercancia",
  date: new Date("2026-03-10"),
};

function setupAuthOk() {
  mockAuth.mockResolvedValue({ userId: USER_ID });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
  vi.mocked(prisma.account.count).mockResolvedValue(0);
  vi.mocked(prisma.transaction.count).mockResolvedValue(0);
  vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.account.findMany).mockResolvedValue([]);
}

// ─── Security guards ──────────────────────────────────────────────────────────

describe("getDashboardMetricsAction — security guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthOk();
  });

  it("rechaza solicitud sin sesión autenticada", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await getDashboardMetricsAction(COMPANY_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
  });

  it("rechaza cuando rate limit está agotado", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      error: "Demasiadas solicitudes. Intenta de nuevo en 30 segundos.",
    });

    const result = await getDashboardMetricsAction(COMPANY_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas solicitudes");
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
  });

  it("rechaza usuario que no es miembro de la empresa (IDOR)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    const result = await getDashboardMetricsAction(COMPANY_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Acceso denegado");
  });

  it("permite acceso a VIEWER (métricas son de solo lectura)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);

    const result = await getDashboardMetricsAction(COMPANY_ID);

    expect(result.success).toBe(true);
  });
});

// ─── Lógica de métricas ───────────────────────────────────────────────────────

describe("getDashboardMetricsAction — lógica", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthOk();
  });

  it("retorna métricas correctamente con data", async () => {
    vi.mocked(prisma.account.count).mockResolvedValue(6);
    vi.mocked(prisma.transaction.count)
      .mockResolvedValueOnce(1) // totalTransactions
      .mockResolvedValueOnce(1); // monthTransactions
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(mockActivePeriod as never);
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(mockLastTransaction as never);
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { type: "ASSET",   journalEntries: [{ amount: 1000 }] },
      { type: "REVENUE", journalEntries: [{ amount: -1000 }] },
    ] as never);

    const result = await getDashboardMetricsAction(COMPANY_ID);

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
    const result = await getDashboardMetricsAction(COMPANY_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalAccounts).toBe(0);
      expect(result.data.activePeriod).toBeNull();
      expect(result.data.netIncome).toBe("0.00");
    }
  });

  it("verifica que la query incluye el companyId correcto", async () => {
    const result = await getDashboardMetricsAction(COMPANY_ID);

    expect(result.success).toBe(true);
    expect(prisma.companyMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: COMPANY_ID, userId: USER_ID }),
      }),
    );
  });

  it("retorna error si falla la query de base de datos", async () => {
    vi.mocked(prisma.account.count).mockRejectedValue(new Error("DB error"));

    const result = await getDashboardMetricsAction(COMPANY_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("DB error");
  });
});
