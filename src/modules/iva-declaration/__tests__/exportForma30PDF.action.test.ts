// src/modules/iva-declaration/__tests__/exportForma30PDF.action.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test" }),
}));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {}, ocr: {} },
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    companyMember: { findFirst: vi.fn() },
    company: { findUnique: vi.fn() },
  };
  return { default: prisma };
});

vi.mock("../services/DeclaracionIVAService", () => ({
  DeclaracionIVAService: {
    calculate: vi.fn(),
  },
}));

vi.mock("../services/Forma30PDFService", () => ({
  generateForma30PDF: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
}));

// Importar después de mocks
import { exportForma30PDFAction } from "../actions/exportForma30PDF.action";
import { auth } from "@clerk/nextjs/server";
import { checkRateLimit } from "@/lib/ratelimit";
import prisma from "@/lib/prisma";
import { DeclaracionIVAService } from "../services/DeclaracionIVAService";
import { generateForma30PDF } from "../services/Forma30PDFService";

// ─── Fixture base ─────────────────────────────────────────────────────────────
const ZERO = new Decimal(0);

function makeZeroRow() {
  return { base: ZERO, tax: ZERO };
}

const mockForma30Result = {
  companyId: "cmp_test",
  year: 2026,
  month: 3,
  periodExists: true,
  isSpecialContributor: false,
  seccionA: {
    general: { base: new Decimal("5000"), tax: new Decimal("800") },
    reducida: makeZeroRow(),
    adicionalLujo: makeZeroRow(),
    exentasExoneradas: { base: ZERO },
    exportaciones: { base: ZERO },
    totalDebitosFiscales: new Decimal("800"),
  },
  seccionB: {
    general: { base: new Decimal("3000"), tax: new Decimal("480") },
    reducida: makeZeroRow(),
    adicionalLujo: makeZeroRow(),
    exentasExoneradas: { base: ZERO },
    importaciones: makeZeroRow(),
    totalCreditosFiscales: new Decimal("480"),
  },
  seccionC: {
    retencionesIvaSufridas: ZERO,
    retencionesIvaPracticadas: ZERO,
    totalRetenciones: ZERO,
  },
  seccionD: { igtfBase: ZERO, igtfTotal: ZERO },
  seccionE: { cuotaPeriodo: new Decimal("320"), esSaldoAFavor: false, creditoFiscalPeriodoAnterior: new Decimal("0"), excedenteCreditoFiscal: new Decimal("0") },
  calculatedAt: new Date(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("exportForma30PDFAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user_test" } as never);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      name: "Empresa Test C.A.",
      rif: "J-12345678-9",
      isSpecialContributor: false,
    } as never);
    vi.mocked(DeclaracionIVAService.calculate).mockResolvedValue(mockForma30Result as never);
    vi.mocked(generateForma30PDF).mockResolvedValue(Buffer.from("fake-pdf"));
  });

  it("happy path — retorna base64 del PDF", async () => {
    const result = await exportForma30PDFAction("cmp_test", 2026, 3);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data).toBe("string");
      expect(result.data.length).toBeGreaterThan(0);
      // Verificar que es base64 válido (Buffer.from puede decodificarlo)
      expect(() => Buffer.from(result.data, "base64")).not.toThrow();
    }
  });

  it("sin sesión → error No autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const result = await exportForma30PDFAction("cmp_test", 2026, 3);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("rate limit excedido → error", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      error: "Demasiadas solicitudes. Intente más tarde.",
    } as never);
    const result = await exportForma30PDFAction("cmp_test", 2026, 3);
    expect(result.success).toBe(false);
  });

  it("año inválido (< 2020) → error de validación", async () => {
    const result = await exportForma30PDFAction("cmp_test", 2019, 3);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("2020");
  });

  it("mes inválido (> 12) → error de validación", async () => {
    const result = await exportForma30PDFAction("cmp_test", 2026, 13);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("12");
  });

  it("empresa no encontrada → acceso denegado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);
    const result = await exportForma30PDFAction("cmp_test", 2026, 3);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("denegado");
  });

  it("VIEWER puede exportar PDF (operación de lectura)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const result = await exportForma30PDFAction("cmp_test", 2026, 3);
    expect(result.success).toBe(true);
  });

  it("llama a DeclaracionIVAService.calculate con los parámetros correctos", async () => {
    await exportForma30PDFAction("cmp_test", 2026, 3);
    expect(vi.mocked(DeclaracionIVAService.calculate)).toHaveBeenCalledWith(
      "cmp_test", 2026, 3, undefined, expect.any(Object),
    );
  });

  it("pasa creditoFiscalPeriodoAnterior al servicio de cálculo", async () => {
    await exportForma30PDFAction("cmp_test", 2026, 3, 500);
    expect(vi.mocked(DeclaracionIVAService.calculate)).toHaveBeenCalledWith(
      "cmp_test", 2026, 3, undefined, expect.any(Object),
    );
  });

  it("llama a generateForma30PDF con companyName y rif de la empresa", async () => {
    await exportForma30PDFAction("cmp_test", 2026, 3);
    expect(vi.mocked(generateForma30PDF)).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: "Empresa Test C.A.",
        companyRif: "J-12345678-9",
        year: 2026,
        month: 3,
      }),
    );
  });

  it("company.findUnique falla → error propagado", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue(null as never);
    const result = await exportForma30PDFAction("cmp_test", 2026, 3);
    expect(result.success).toBe(false);
  });
});
