// src/modules/iva-declaration/__tests__/Forma30PDFService.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import type { Forma30PDFParams } from "../services/Forma30PDFService";

// ─── Mock @react-pdf/renderer ─────────────────────────────────────────────────
type WithChildren = { children?: unknown };
vi.mock("@react-pdf/renderer", () => ({
  Document: ({ children }: WithChildren) => children,
  Page: ({ children }: WithChildren) => children,
  Text: ({ children }: WithChildren) => children,
  View: ({ children }: WithChildren) => children,
  StyleSheet: { create: <T extends Record<string, unknown>>(s: T) => s },
  renderToBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
}));

// Importar DESPUÉS del mock
import { generateForma30PDF } from "../services/Forma30PDFService";

// ─── Fixture ──────────────────────────────────────────────────────────────────
const ZERO = new Decimal(0);

function makeZeroRow() {
  return { base: ZERO, tax: ZERO };
}

const validParams: Forma30PDFParams = {
  companyName: "Empresa Test C.A.",
  companyRif: "J-12345678-9",
  year: 2026,
  month: 3,
  isSpecialContributor: false,
  seccionA: {
    general: { base: new Decimal("5000.00"), tax: new Decimal("800.00") },
    reducida: makeZeroRow(),
    adicionalLujo: makeZeroRow(),
    exentasExoneradas: { base: ZERO },
    exportaciones: { base: ZERO },
    totalDebitosFiscales: new Decimal("800.00"),
  },
  seccionB: {
    general: { base: new Decimal("3000.00"), tax: new Decimal("480.00") },
    reducida: makeZeroRow(),
    adicionalLujo: makeZeroRow(),
    exentasExoneradas: { base: ZERO },
    importaciones: makeZeroRow(),
    totalCreditosFiscales: new Decimal("480.00"),
  },
  seccionC: {
    retencionesIvaSufridas: ZERO,
    retencionesIvaPracticadas: ZERO,
    totalRetenciones: ZERO,
  },
  seccionD: {
    igtfBase: ZERO,
    igtfTotal: ZERO,
  },
  seccionE: {
    creditoFiscalPeriodoAnterior: ZERO,
    cuotaPeriodo: new Decimal("320.00"),
    esSaldoAFavor: false,
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("generateForma30PDF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna Buffer no vacío con datos válidos", async () => {
    const result = await generateForma30PDF(validParams);
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  it("llama renderToBuffer exactamente una vez", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    await generateForma30PDF(validParams);
    expect(vi.mocked(renderToBuffer)).toHaveBeenCalledTimes(1);
  });

  it("funciona cuando todas las secciones son cero (período sin movimientos)", async () => {
    const zeroParams: Forma30PDFParams = {
      companyName: "Test S.A.",
      companyRif: null,
      year: 2026,
      month: 1,
      isSpecialContributor: false,
      seccionA: {
        general: makeZeroRow(),
        reducida: makeZeroRow(),
        adicionalLujo: makeZeroRow(),
        exentasExoneradas: { base: ZERO },
        exportaciones: { base: ZERO },
        totalDebitosFiscales: ZERO,
      },
      seccionB: {
        general: makeZeroRow(),
        reducida: makeZeroRow(),
        adicionalLujo: makeZeroRow(),
        exentasExoneradas: { base: ZERO },
        importaciones: makeZeroRow(),
        totalCreditosFiscales: ZERO,
      },
      seccionC: {
        retencionesIvaSufridas: ZERO,
        retencionesIvaPracticadas: ZERO,
        totalRetenciones: ZERO,
      },
      seccionD: { igtfBase: ZERO, igtfTotal: ZERO },
      seccionE: { creditoFiscalPeriodoAnterior: ZERO, cuotaPeriodo: ZERO, esSaldoAFavor: false },
    };
    await expect(generateForma30PDF(zeroParams)).resolves.toBeInstanceOf(Buffer);
  });

  it("funciona con saldo a favor (cuotaPeriodo negativa)", async () => {
    const params: Forma30PDFParams = {
      ...validParams,
      seccionE: {
        creditoFiscalPeriodoAnterior: ZERO,
        cuotaPeriodo: new Decimal("-160.00"),
        esSaldoAFavor: true,
      },
    };
    await expect(generateForma30PDF(params)).resolves.toBeInstanceOf(Buffer);
  });

  it("funciona con contribuyente especial y retenciones", async () => {
    const params: Forma30PDFParams = {
      ...validParams,
      isSpecialContributor: true,
      seccionC: {
        retencionesIvaSufridas: new Decimal("120.00"),
        retencionesIvaPracticadas: new Decimal("240.00"),
        totalRetenciones: new Decimal("360.00"),
      },
      seccionE: {
        creditoFiscalPeriodoAnterior: ZERO,
        cuotaPeriodo: new Decimal("440.00"),
        esSaldoAFavor: false,
      },
    };
    await expect(generateForma30PDF(params)).resolves.toBeInstanceOf(Buffer);
  });

  it("funciona con companyRif null (empresa sin RIF registrado)", async () => {
    const params: Forma30PDFParams = { ...validParams, companyRif: null };
    await expect(generateForma30PDF(params)).resolves.toBeInstanceOf(Buffer);
  });

  it("funciona con mes 12 (diciembre)", async () => {
    const params: Forma30PDFParams = { ...validParams, month: 12 };
    await expect(generateForma30PDF(params)).resolves.toBeInstanceOf(Buffer);
  });
});
