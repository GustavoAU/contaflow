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

describe("getDashboardMetricsAction — security guards (CRITICAL)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.account.count).mockResolvedValue(0);
    vi.mocked(prisma.transaction.count).mockResolvedValue(0);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.account.findMany).mockResolvedValue([]);
  });

  it("retorna error si no hay sesión autenticada", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await getDashboardMetricsAction(COMPANY_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
  });

  it("retorna error si rate limit agotado", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      error: "Demasiadas solicitudes. Intenta de nuevo en 30 segundos.",
    });

    const result = await getDashboardMetricsAction(COMPANY_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas solicitudes");
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
  });

  it("retorna error si usuario no es miembro de la empresa (IDOR)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    const result = await getDashboardMetricsAction(COMPANY_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Acceso denegado");
  });

  it("permite acceso a VIEWER (métricas de solo lectura)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);

    const result = await getDashboardMetricsAction(COMPANY_ID);

    expect(result.success).toBe(true);
  });

  it("happy path: retorna métricas para miembro válido", async () => {
    const result = await getDashboardMetricsAction(COMPANY_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalAccounts).toBe(0);
      expect(result.data.netIncome).toBe("0.00");
    }
    expect(prisma.companyMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: COMPANY_ID, userId: USER_ID }),
      }),
    );
  });
});
