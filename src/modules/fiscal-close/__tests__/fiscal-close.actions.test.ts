// src/modules/fiscal-close/__tests__/fiscal-close.actions.test.ts
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
    account: { findMany: vi.fn() },
    company: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../services/FiscalYearCloseService", () => ({
  FiscalYearCloseService: {
    closeFiscalYear: vi.fn(),
    appropriateFiscalYearResult: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import {
  closeFiscalYearAction,
  appropriateFiscalYearResultAction,
  updateFiscalConfigAction,
} from "../actions/fiscal-close.actions";

const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const ADMIN_MEMBER = { role: "ADMIN" };

const CLOSE_INPUT = { companyId: COMPANY_ID, year: 2025 };
const APPROPRIATE_INPUT = { companyId: COMPANY_ID, year: 2025 };
const CONFIG_INPUT = {
  companyId: COMPANY_ID,
  resultAccountId: "acc-result",
  retainedEarningsAccountId: "acc-retained",
};

// ─── Rate limiting — HIGH finding regression ──────────────────────────────────
describe("fiscal-close actions — rate limiting (HIGH)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
  });

  it("closeFiscalYearAction: bloquea si rate limit agotado", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      error: "Demasiadas solicitudes. Intenta de nuevo en 30 segundos.",
    });

    const result = await closeFiscalYearAction(CLOSE_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas solicitudes");
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
  });

  it("appropriateFiscalYearResultAction: bloquea si rate limit agotado", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      error: "Demasiadas solicitudes. Intenta de nuevo en 30 segundos.",
    });

    const result = await appropriateFiscalYearResultAction(APPROPRIATE_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas solicitudes");
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
  });

  it("updateFiscalConfigAction: bloquea si rate limit agotado", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      error: "Demasiadas solicitudes. Intenta de nuevo en 30 segundos.",
    });

    const result = await updateFiscalConfigAction(CONFIG_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas solicitudes");
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
  });

  it("closeFiscalYearAction: retorna error si no autenticado", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await closeFiscalYearAction(CLOSE_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("closeFiscalYearAction: bloquea si rol no es ADMIN", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);

    const result = await closeFiscalYearAction(CLOSE_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Administrador");
  });
});
