// src/modules/fiscal-close/__tests__/fiscal-close.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

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
    getFiscalYearCloseHistory: vi.fn(),
  },
}));
vi.mock("@/lib/module-access", () => ({
  hasModuleAccess: vi.fn().mockResolvedValue(true),
  moduleAccessError: vi.fn().mockReturnValue("Sin acceso al módulo"),
}));

import prisma from "@/lib/prisma";
import { FiscalYearCloseService } from "../services/FiscalYearCloseService";
import {
  closeFiscalYearAction,
  appropriateFiscalYearResultAction,
  updateFiscalConfigAction,
  getFiscalYearCloseHistoryAction,
  getFiscalConfigAction,
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
    mockAuth.mockResolvedValue({ userId: USER_ID, has: () => true });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
  });

  it("closeFiscalYearAction: bloquea si rate limit agotado", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      error: "Demasiadas solicitudes. Intenta de nuevo en 30 segundos.",
    });

    const result = await closeFiscalYearAction(CLOSE_INPUT);

    if ('clerk_error' in result) throw new Error('unexpected step-up');
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

    if ('clerk_error' in result) throw new Error('unexpected step-up');
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

    if ('clerk_error' in result) throw new Error('unexpected step-up');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("closeFiscalYearAction: bloquea si rol no es ADMIN", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);

    const result = await closeFiscalYearAction(CLOSE_INPUT);

    if ('clerk_error' in result) throw new Error('unexpected step-up');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Administrador");
  });
});

// ─── getFiscalYearCloseHistoryAction ─────────────────────────────────────────
describe("getFiscalYearCloseHistoryAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    vi.mocked(FiscalYearCloseService.getFiscalYearCloseHistory).mockResolvedValue([] as never);
  });

  it("retorna error si no autenticado", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await getFiscalYearCloseHistoryAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna error si no es miembro de la empresa", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await getFiscalYearCloseHistoryAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna error si rol no tiene acceso a contabilidad", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const result = await getFiscalYearCloseHistoryAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("denegado");
  });

  it("retorna historial en camino feliz", async () => {
    const fakeHistory = [{ id: "close-1", year: 2025 }];
    vi.mocked(FiscalYearCloseService.getFiscalYearCloseHistory).mockResolvedValue(fakeHistory as never);
    const result = await getFiscalYearCloseHistoryAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(fakeHistory);
  });

  it("propaga error de base de datos estructurado", async () => {
    vi.mocked(FiscalYearCloseService.getFiscalYearCloseHistory).mockRejectedValue(new Error("DB fail"));
    const result = await getFiscalYearCloseHistoryAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });
});

// ─── getFiscalConfigAction ────────────────────────────────────────────────────
describe("getFiscalConfigAction", () => {
  const COMPANY_CONFIG = {
    resultAccountId: "acc-result",
    retainedEarningsAccountId: "acc-retained",
    resultAccount: { name: "Resultado del Ejercicio" },
    retainedEarningsAccount: { name: "Utilidades Retenidas" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValue(COMPANY_CONFIG as never);
  });

  it("retorna error si no autenticado", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await getFiscalConfigAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna error si no es miembro de la empresa", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await getFiscalConfigAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna error si rol no tiene acceso a contabilidad", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const result = await getFiscalConfigAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("denegado");
  });

  it("retorna error si empresa no encontrada", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue(null);
    const result = await getFiscalConfigAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Empresa no encontrada");
  });

  it("retorna configuración contable en camino feliz", async () => {
    const result = await getFiscalConfigAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resultAccountId).toBe("acc-result");
      expect(result.data.retainedEarningsAccountId).toBe("acc-retained");
      expect(result.data.resultAccountName).toBe("Resultado del Ejercicio");
      expect(result.data.retainedEarningsAccountName).toBe("Utilidades Retenidas");
    }
  });

  it("retorna nulls cuando la empresa no tiene cuentas configuradas", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      resultAccountId: null,
      retainedEarningsAccountId: null,
      resultAccount: null,
      retainedEarningsAccount: null,
    } as never);
    const result = await getFiscalConfigAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resultAccountId).toBeNull();
      expect(result.data.resultAccountName).toBeNull();
    }
  });

  it("propaga error de base de datos estructurado", async () => {
    vi.mocked(prisma.company.findUnique).mockRejectedValue(new Error("DB fail"));
    const result = await getFiscalConfigAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });
});
