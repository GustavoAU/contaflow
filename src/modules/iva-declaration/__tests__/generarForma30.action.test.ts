// src/modules/iva-declaration/__tests__/generarForma30.action.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

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
  },
}));
vi.mock("@/modules/fiscal-close/services/FiscalYearCloseService", () => ({
  FiscalYearCloseService: { isFiscalYearClosed: vi.fn() },
}));
vi.mock("../services/DeclaracionIVAService", () => ({
  DeclaracionIVAService: { calculate: vi.fn() },
}));

import prisma from "@/lib/prisma";
import { FiscalYearCloseService } from "@/modules/fiscal-close/services/FiscalYearCloseService";
import { DeclaracionIVAService } from "../services/DeclaracionIVAService";
import { generarForma30Action } from "../actions/generarForma30.action";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const YEAR = 2026;
const MONTH = 3;

const ZERO = new Decimal(0);

const MOCK_FORMA30 = {
  companyId: COMPANY_ID,
  year: YEAR,
  month: MONTH,
  periodExists: true,
  isSpecialContributor: false,
  seccionA: {
    general: { base: ZERO, tax: ZERO },
    reducida: { base: ZERO, tax: ZERO },
    adicionalLujo: { base: ZERO, tax: ZERO },
    exentasExoneradas: { base: ZERO },
    exportaciones: { base: ZERO },
    totalDebitosFiscales: ZERO,
  },
  seccionB: {
    general: { base: ZERO, tax: ZERO },
    reducida: { base: ZERO, tax: ZERO },
    adicionalLujo: { base: ZERO, tax: ZERO },
    exentasExoneradas: { base: ZERO },
    importaciones: { base: ZERO, tax: ZERO },
    totalCreditosFiscales: ZERO,
  },
  seccionC: {
    retencionesIvaSufridas: ZERO,
    retencionesIvaPracticadas: ZERO,
    totalRetenciones: ZERO,
  },
  seccionD: { igtfBase: ZERO, igtfTotal: ZERO },
  seccionE: { cuotaPeriodo: ZERO, esSaldoAFavor: false },
  calculatedAt: new Date(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("generarForma30Action — security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(
      { role: "ACCOUNTANT" } as never
    );
    vi.mocked(FiscalYearCloseService.isFiscalYearClosed).mockResolvedValue(false);
    vi.mocked(DeclaracionIVAService.calculate).mockResolvedValue(MOCK_FORMA30);
  });

  it("retorna { success: false } si no hay sesión autenticada", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await generarForma30Action(COMPANY_ID, YEAR, MONTH);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
  });

  it("retorna { success: false } si rate limit agotado", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      error: "Demasiadas solicitudes. Intenta de nuevo en 30 segundos.",
    });

    const result = await generarForma30Action(COMPANY_ID, YEAR, MONTH);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas solicitudes");
  });

  it("retorna { success: false } si el usuario no es miembro", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    const result = await generarForma30Action(COMPANY_ID, YEAR, MONTH);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("acceso denegado");
  });

  it("VIEWER puede generar la Forma 30 (lectura)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(
      { role: "VIEWER" } as never
    );

    const result = await generarForma30Action(COMPANY_ID, YEAR, MONTH);

    expect(result.success).toBe(true);
  });

  it("valida año mínimo 2020", async () => {
    const result = await generarForma30Action(COMPANY_ID, 2019, MONTH);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("2020");
  });

  it("valida mes máximo 12", async () => {
    const result = await generarForma30Action(COMPANY_ID, YEAR, 13);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("12");
  });

  it("happy path: retorna Forma30Result + fiscalYearClosed", async () => {
    vi.mocked(FiscalYearCloseService.isFiscalYearClosed).mockResolvedValue(true);

    const result = await generarForma30Action(COMPANY_ID, YEAR, MONTH);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.companyId).toBe(COMPANY_ID);
      expect(result.data.fiscalYearClosed).toBe(true);
    }
  });

  it("fiscalYearClosed = false NO bloquea la declaración mensual", async () => {
    vi.mocked(FiscalYearCloseService.isFiscalYearClosed).mockResolvedValue(false);

    const result = await generarForma30Action(COMPANY_ID, YEAR, MONTH);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.fiscalYearClosed).toBe(false);
    expect(DeclaracionIVAService.calculate).toHaveBeenCalled();
  });

  it("auth() se llama ANTES de cualquier consulta DB (ADR-006 D-1)", async () => {
    const callOrder: string[] = [];
    mockAuth.mockImplementation(async () => {
      callOrder.push("auth");
      return { userId: USER_ID };
    });
    vi.mocked(prisma.companyMember.findFirst).mockImplementation(
      (async () => {
        callOrder.push("companyMember");
        return { role: "ACCOUNTANT" } as never;
      }) as never
    );

    await generarForma30Action(COMPANY_ID, YEAR, MONTH);

    expect(callOrder[0]).toBe("auth");
    expect(callOrder[1]).toBe("companyMember");
  });
});
