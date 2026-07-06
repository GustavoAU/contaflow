// src/modules/iva-declaration/__tests__/DeclaracionIVAService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockPrisma = vi.hoisted(() => ({
  company: { findUnique: vi.fn() },
  accountingPeriod: { findUnique: vi.fn() },
  invoice: { findMany: vi.fn(), count: vi.fn() }, // count: guard de volumen (MEDIUM-01)
  retencion: { findMany: vi.fn() },
  iGTFTransaction: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: mockPrisma }));

import { DeclaracionIVAService } from "../services/DeclaracionIVAService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const COMPANY_ID = "company-test";
const YEAR = 2026;
const MONTH = 3;

function dec(v: string | number) {
  return { toString: () => String(v) };
}

const BASE_COMPANY = { isSpecialContributor: false };
const BASE_PERIOD = { id: "period-1" };

function makeTaxLine(taxType: string, base: string, amount: string) {
  return { taxType, base: dec(base), amount: dec(amount) };
}

function makeSaleInvoice(overrides: Partial<{
  docType: string;
  taxCategory: string;
  ivaRetentionAmount: ReturnType<typeof dec>;
  taxLines: ReturnType<typeof makeTaxLine>[];
}> = {}) {
  return {
    docType: "FACTURA",
    taxCategory: "GRAVADA",
    ivaRetentionAmount: dec("0"),
    taxLines: [],
    ...overrides,
  };
}

function makePurchaseInvoice(overrides: Partial<{
  docType: string;
  taxCategory: string;
  taxLines: ReturnType<typeof makeTaxLine>[];
}> = {}) {
  return {
    docType: "FACTURA",
    taxCategory: "GRAVADA",
    taxLines: [],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("DeclaracionIVAService.calculate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.company.findUnique.mockResolvedValue(BASE_COMPANY);
    mockPrisma.accountingPeriod.findUnique.mockResolvedValue(BASE_PERIOD);
    mockPrisma.invoice.count.mockResolvedValue(0); // bajo el guard de volumen
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.retencion.findMany.mockResolvedValue([]);
    mockPrisma.iGTFTransaction.findMany.mockResolvedValue([]);
  });

  it("guard de volumen: mes con más de 50.000 facturas → error de negocio, sin truncar", async () => {
    mockPrisma.invoice.count.mockResolvedValue(50_001);

    await expect(
      DeclaracionIVAService.calculate(COMPANY_ID, YEAR, MONTH),
    ).rejects.toThrow(/excede el máximo procesable/);
    // NUNCA se cargan facturas parciales — la Forma 30 no se calcula truncada
    expect(mockPrisma.invoice.findMany).not.toHaveBeenCalled();
  });

  it("retorna ceros cuando no hay datos en el período", async () => {
    const result = await DeclaracionIVAService.calculate(COMPANY_ID, YEAR, MONTH);

    expect(result.companyId).toBe(COMPANY_ID);
    expect(result.year).toBe(YEAR);
    expect(result.month).toBe(MONTH);
    expect(result.periodExists).toBe(true);
    expect(result.isSpecialContributor).toBe(false);
    expect(result.seccionA.totalDebitosFiscales.toString()).toBe("0");
    expect(result.seccionB.totalCreditosFiscales.toString()).toBe("0");
    expect(result.seccionC.totalRetenciones.toString()).toBe("0");
    expect(result.seccionD.igtfTotal.toString()).toBe("0");
    expect(result.seccionE.cuotaPeriodo.toString()).toBe("0");
    expect(result.seccionE.esSaldoAFavor).toBe(false);
  });

  it("periodExists = false cuando no hay AccountingPeriod", async () => {
    mockPrisma.accountingPeriod.findUnique.mockResolvedValue(null);

    const result = await DeclaracionIVAService.calculate(COMPANY_ID, YEAR, MONTH);

    expect(result.periodExists).toBe(false);
  });

  it("calcula débitos fiscales (Sección A) con IVA_GENERAL 16%", async () => {
    mockPrisma.invoice.findMany.mockImplementation(({ where }: { where: { type: string } }) => {
      if (where.type === "SALE") {
        return [
          makeSaleInvoice({
            taxLines: [makeTaxLine("IVA_GENERAL", "1000", "160")],
          }),
        ];
      }
      return [];
    });

    const result = await DeclaracionIVAService.calculate(COMPANY_ID, YEAR, MONTH);

    expect(result.seccionA.general.base.toString()).toBe("1000");
    expect(result.seccionA.general.tax.toString()).toBe("160");
    expect(result.seccionA.totalDebitosFiscales.toString()).toBe("160");
  });

  it("NOTA_CREDITO invierte signo en Sección A", async () => {
    mockPrisma.invoice.findMany.mockImplementation(({ where }: { where: { type: string } }) => {
      if (where.type === "SALE") {
        return [
          makeSaleInvoice({
            taxLines: [makeTaxLine("IVA_GENERAL", "1000", "160")],
          }),
          makeSaleInvoice({
            docType: "NOTA_CREDITO",
            taxLines: [makeTaxLine("IVA_GENERAL", "200", "32")],
          }),
        ];
      }
      return [];
    });

    const result = await DeclaracionIVAService.calculate(COMPANY_ID, YEAR, MONTH);

    // 1000 - 200 = 800 base; 160 - 32 = 128 tax
    expect(result.seccionA.general.base.toString()).toBe("800");
    expect(result.seccionA.general.tax.toString()).toBe("128");
    expect(result.seccionA.totalDebitosFiscales.toString()).toBe("128");
  });

  it("calcula créditos fiscales (Sección B) con IVA_REDUCIDO 8%", async () => {
    mockPrisma.invoice.findMany.mockImplementation(({ where }: { where: { type: string } }) => {
      if (where.type === "PURCHASE") {
        return [
          makePurchaseInvoice({
            taxLines: [makeTaxLine("IVA_REDUCIDO", "500", "40")],
          }),
        ];
      }
      return [];
    });

    const result = await DeclaracionIVAService.calculate(COMPANY_ID, YEAR, MONTH);

    expect(result.seccionB.reducida.base.toString()).toBe("500");
    expect(result.seccionB.reducida.tax.toString()).toBe("40");
    expect(result.seccionB.totalCreditosFiscales.toString()).toBe("40");
  });

  it("compras PLANILLA_IMPORTACION van a Sección B5 (importaciones)", async () => {
    mockPrisma.invoice.findMany.mockImplementation(({ where }: { where: { type: string } }) => {
      if (where.type === "PURCHASE") {
        return [
          makePurchaseInvoice({
            docType: "PLANILLA_IMPORTACION",
            taxLines: [makeTaxLine("IVA_GENERAL", "2000", "320")],
          }),
        ];
      }
      return [];
    });

    const result = await DeclaracionIVAService.calculate(COMPANY_ID, YEAR, MONTH);

    expect(result.seccionB.importaciones.base.toString()).toBe("2000");
    expect(result.seccionB.importaciones.tax.toString()).toBe("320");
    // NO van a B1 general
    expect(result.seccionB.general.base.toString()).toBe("0");
  });

  it("facturas NO_SUJETA se excluyen de todos los cálculos", async () => {
    mockPrisma.invoice.findMany.mockImplementation(({ where }: { where: { type: string } }) => {
      if (where.type === "SALE") {
        return [
          makeSaleInvoice({
            taxCategory: "NO_SUJETA",
            taxLines: [makeTaxLine("IVA_GENERAL", "999", "159.84")],
          }),
        ];
      }
      return [];
    });

    const result = await DeclaracionIVAService.calculate(COMPANY_ID, YEAR, MONTH);

    expect(result.seccionA.totalDebitosFiscales.toString()).toBe("0");
  });

  it("retenciones practicadas se incluyen en Sección C2 (contribuyente especial)", async () => {
    mockPrisma.company.findUnique.mockResolvedValue({ isSpecialContributor: true });
    mockPrisma.retencion.findMany.mockResolvedValue([
      { ivaRetention: dec("75") },
      { ivaRetention: dec("100") },
    ]);

    const result = await DeclaracionIVAService.calculate(COMPANY_ID, YEAR, MONTH);

    expect(result.isSpecialContributor).toBe(true);
    expect(result.seccionC.retencionesIvaPracticadas.toString()).toBe("175");
  });

  it("retenciones = 0 si NO es contribuyente especial", async () => {
    mockPrisma.company.findUnique.mockResolvedValue({ isSpecialContributor: false });
    // retencion.findMany no debe llamarse
    const result = await DeclaracionIVAService.calculate(COMPANY_ID, YEAR, MONTH);

    expect(result.seccionC.totalRetenciones.toString()).toBe("0");
    expect(mockPrisma.retencion.findMany).not.toHaveBeenCalled();
  });

  it("retenciones IVA sufridas (C1) se incluyen si isSpecialContributor", async () => {
    mockPrisma.company.findUnique.mockResolvedValue({ isSpecialContributor: true });
    mockPrisma.invoice.findMany.mockImplementation(({ where }: { where: { type: string } }) => {
      if (where.type === "SALE") {
        return [
          makeSaleInvoice({
            ivaRetentionAmount: dec("120"),
            taxLines: [makeTaxLine("IVA_GENERAL", "750", "120")],
          }),
        ];
      }
      return [];
    });

    const result = await DeclaracionIVAService.calculate(COMPANY_ID, YEAR, MONTH);

    expect(result.seccionC.retencionesIvaSufridas.toString()).toBe("120");
  });

  it("calcula IGTF en Sección D", async () => {
    mockPrisma.iGTFTransaction.findMany.mockResolvedValue([
      { amount: dec("500"), igtfAmount: dec("15") },
      { amount: dec("300"), igtfAmount: dec("9") },
    ]);

    const result = await DeclaracionIVAService.calculate(COMPANY_ID, YEAR, MONTH);

    expect(result.seccionD.igtfBase.toString()).toBe("800");
    expect(result.seccionD.igtfTotal.toString()).toBe("24");
  });

  it("Sección E: cuotaPeriodo = débitos - créditos - retenciones", async () => {
    mockPrisma.company.findUnique.mockResolvedValue({ isSpecialContributor: true });
    mockPrisma.invoice.findMany.mockImplementation(({ where }: { where: { type: string } }) => {
      if (where.type === "SALE") {
        return [makeSaleInvoice({ taxLines: [makeTaxLine("IVA_GENERAL", "1000", "160")] })];
      }
      if (where.type === "PURCHASE") {
        return [makePurchaseInvoice({ taxLines: [makeTaxLine("IVA_GENERAL", "500", "80")] })];
      }
      return [];
    });
    mockPrisma.retencion.findMany.mockResolvedValue([{ ivaRetention: dec("30") }]);

    const result = await DeclaracionIVAService.calculate(COMPANY_ID, YEAR, MONTH);

    // 160 - 80 - 30 = 50
    expect(result.seccionE.cuotaPeriodo.toString()).toBe("50");
    expect(result.seccionE.esSaldoAFavor).toBe(false);
  });

  it("Sección E: esSaldoAFavor = true cuando créditos > débitos", async () => {
    mockPrisma.invoice.findMany.mockImplementation(({ where }: { where: { type: string } }) => {
      if (where.type === "SALE") {
        return [makeSaleInvoice({ taxLines: [makeTaxLine("IVA_GENERAL", "100", "16")] })];
      }
      if (where.type === "PURCHASE") {
        return [makePurchaseInvoice({ taxLines: [makeTaxLine("IVA_GENERAL", "1000", "160")] })];
      }
      return [];
    });

    const result = await DeclaracionIVAService.calculate(COMPANY_ID, YEAR, MONTH);

    expect(result.seccionE.cuotaPeriodo.lt(new Decimal(0))).toBe(true);
    expect(result.seccionE.esSaldoAFavor).toBe(true);
  });

  it("queries incluyen companyId en todas las llamadas (ADR-004)", async () => {
    await DeclaracionIVAService.calculate(COMPANY_ID, YEAR, MONTH);

    expect(mockPrisma.company.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: COMPANY_ID } })
    );
    expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY_ID }) })
    );
    expect(mockPrisma.iGTFTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY_ID }) })
    );
  });

  it("creditoFiscalPeriodoAnterior = 0 por defecto", async () => {
    const result = await DeclaracionIVAService.calculate(COMPANY_ID, YEAR, MONTH);
    expect(result.seccionE.creditoFiscalPeriodoAnterior.toString()).toBe("0");
  });

  it("Sección E: crédito anterior reduce la cuota a pagar", async () => {
    mockPrisma.invoice.findMany.mockImplementation(({ where }: { where: { type: string } }) => {
      if (where.type === "SALE") {
        return [makeSaleInvoice({ taxLines: [makeTaxLine("IVA_GENERAL", "1000", "160")] })];
      }
      if (where.type === "PURCHASE") {
        return [makePurchaseInvoice({ taxLines: [makeTaxLine("IVA_GENERAL", "500", "80")] })];
      }
      return [];
    });

    // débitos 160, créditos 80, retenciones 0 → sin crédito anterior: 80
    // con crédito anterior 30 → 80 - 30 = 50
    const result = await DeclaracionIVAService.calculate(
      COMPANY_ID, YEAR, MONTH, undefined, new Decimal("30")
    );

    expect(result.seccionE.creditoFiscalPeriodoAnterior.toString()).toBe("30");
    expect(result.seccionE.cuotaPeriodo.toString()).toBe("50");
    expect(result.seccionE.esSaldoAFavor).toBe(false);
  });

  it("Sección E: crédito anterior puede generar saldo a favor (crédito > cuota bruta)", async () => {
    mockPrisma.invoice.findMany.mockImplementation(({ where }: { where: { type: string } }) => {
      if (where.type === "SALE") {
        return [makeSaleInvoice({ taxLines: [makeTaxLine("IVA_GENERAL", "1000", "160")] })];
      }
      if (where.type === "PURCHASE") {
        return [makePurchaseInvoice({ taxLines: [makeTaxLine("IVA_GENERAL", "500", "80")] })];
      }
      return [];
    });

    // cuota bruta = 80; crédito anterior 200 → saldo a favor −120
    const result = await DeclaracionIVAService.calculate(
      COMPANY_ID, YEAR, MONTH, undefined, new Decimal("200")
    );

    expect(result.seccionE.creditoFiscalPeriodoAnterior.toString()).toBe("200");
    expect(result.seccionE.cuotaPeriodo.lt(new Decimal(0))).toBe(true);
    expect(result.seccionE.esSaldoAFavor).toBe(true);
  });

  it("Sección E: crédito negativo se trata como cero (guard)", async () => {
    const result = await DeclaracionIVAService.calculate(
      COMPANY_ID, YEAR, MONTH, undefined, new Decimal("-100")
    );

    expect(result.seccionE.creditoFiscalPeriodoAnterior.toString()).toBe("0");
  });
});
