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
    invoice: { findMany: vi.fn() },
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
import { generarForma30Action, getRetencionesSufridas } from "../actions/generarForma30.action";

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
  seccionE: { creditoFiscalPeriodoAnterior: ZERO, cuotaPeriodo: ZERO, esSaldoAFavor: false, excedenteCreditoFiscal: ZERO },
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

  it("creditoFiscalPeriodoAnterior válido llega al servicio (5 argumentos)", async () => {
    const result = await generarForma30Action(COMPANY_ID, YEAR, MONTH, 500);

    expect(result.success).toBe(true);
    // El servicio debe ser llamado con el 5to argumento (Decimal de 500)
    const calls = vi.mocked(DeclaracionIVAService.calculate).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    expect(lastCall[4]?.toString()).toBe("500");
  });

  it("falla con crédito negativo (schema guard)", async () => {
    const result = await generarForma30Action(COMPANY_ID, YEAR, MONTH, -100);

    expect(result.success).toBe(false);
  });

  it("creditoFiscalPeriodoAnterior omitido equivale a 0", async () => {
    const result = await generarForma30Action(COMPANY_ID, YEAR, MONTH);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.seccionE.creditoFiscalPeriodoAnterior).toBe("0.00");
    }
  });
});

// ─── getRetencionesSufridas ────────────────────────────────────────────────────

const MOCK_INVOICE = {
  id: "inv-1",
  invoiceNumber: "0000001",
  controlNumber: "00-00000001",
  counterpartName: "Cliente Demo C.A.",
  counterpartRif: "J-12345678-9",
  date: new Date("2026-03-15T00:00:00.000Z"),
  ivaRetentionAmount: { toString: () => "75.00" },
  currency: "VES",
};

describe("getRetencionesSufridas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([MOCK_INVOICE] as never);
  });

  it("retorna { success: false } si no hay sesión autenticada", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await getRetencionesSufridas(COMPANY_ID, YEAR, MONTH);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna { success: false } si el usuario no es miembro de la empresa", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    const result = await getRetencionesSufridas(COMPANY_ID, YEAR, MONTH);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("acceso denegado");
  });

  it("happy path: retorna filas serializadas correctamente", async () => {
    const result = await getRetencionesSufridas(COMPANY_ID, YEAR, MONTH);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      expect(row.id).toBe("inv-1");
      expect(row.invoiceNumber).toBe("0000001");
      expect(row.ivaRetentionAmount).toBe("75.00");
      expect(row.currency).toBe("VES");
      expect(typeof row.date).toBe("string");
    }
  });

  it("filtra correctamente por companyId y tipo SALE en el query", async () => {
    await getRetencionesSufridas(COMPANY_ID, YEAR, MONTH);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: COMPANY_ID,
          type: "SALE",
        }),
      }),
    );
  });

  it("devuelve lista vacía si no hay facturas con retención en el período", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    const result = await getRetencionesSufridas(COMPANY_ID, YEAR, MONTH);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(0);
  });

  it("propaga el error si la consulta DB falla", async () => {
    vi.mocked(prisma.invoice.findMany).mockRejectedValue(new Error("query failed") as never);

    const result = await getRetencionesSufridas(COMPANY_ID, YEAR, MONTH);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("query failed");
  });
});
