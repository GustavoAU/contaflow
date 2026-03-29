// src/modules/invoices/services/InvoiceService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import { InvoiceService } from "./InvoiceService";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

// ÔöÇÔöÇÔöÇ Helpers ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
const makeTaxLine = (taxType: string, base: string, rate: string, amount: string) => ({
  id: `line-${taxType}`,
  taxType,
  base: new Decimal(base),
  rate: new Decimal(rate),
  amount: new Decimal(amount),
});

const makeInvoiceRow = (overrides = {}) => ({
  id: "inv-1",
  date: new Date("2026-03-01"),
  invoiceNumber: "0000001",
  controlNumber: "00-0000001",
  relatedDocNumber: null,
  importFormNumber: null,
  reportZStart: null,
  reportZEnd: null,
  docType: "FACTURA",
  taxCategory: "GRAVADA",
  counterpartName: "Cliente Demo C.A.",
  counterpartRif: "J-12345678-9",
  ivaRetentionAmount: new Decimal("0"),
  ivaRetentionVoucher: null,
  ivaRetentionDate: null,
  islrRetentionAmount: new Decimal("0"),
  igtfBase: new Decimal("0"),
  igtfAmount: new Decimal("0"),
  taxLines: [makeTaxLine("IVA_GENERAL", "1000.00", "16", "160.00")],
  ...overrides,
});

const BASE_INPUT = {
  companyId: "company-1",
  type: "SALE" as const,
  docType: "FACTURA" as const,
  taxCategory: "GRAVADA" as const,
  invoiceNumber: "0000001",
  controlNumber: "00-0000001",
  date: new Date("2026-03-01"),
  counterpartName: "Cliente Demo C.A.",
  counterpartRif: "J-12345678-9",
  taxLines: [{ taxType: "IVA_GENERAL" as const, base: "1000.00", rate: "16", amount: "160.00" }],
  ivaRetentionAmount: "0",
  ivaRetentionVoucher: undefined,
  ivaRetentionDate: undefined,
  islrRetentionAmount: "0",
  igtfBase: "0",
  igtfAmount: "0",
  transactionId: undefined,
  periodId: undefined,
  createdBy: "user-1",
};

describe("InvoiceService.create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("llama a prisma.invoice.create con los datos correctos", async () => {
    vi.mocked(prisma.invoice.create).mockResolvedValue(makeInvoiceRow() as never);

    await InvoiceService.create(BASE_INPUT);

    expect(prisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: "company-1",
          type: "SALE",
          invoiceNumber: "0000001",
          counterpartRif: "J-12345678-9",
          createdBy: "user-1",
        }),
      })
    );
  });

  it("crea taxLines din├ímicamente", async () => {
    vi.mocked(prisma.invoice.create).mockResolvedValue(makeInvoiceRow() as never);

    await InvoiceService.create(BASE_INPUT);

    expect(prisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taxLines: {
            create: expect.arrayContaining([expect.objectContaining({ taxType: "IVA_GENERAL" })]),
          },
        }),
      })
    );
  });

  it("lanza error si prisma falla", async () => {
    vi.mocked(prisma.invoice.create).mockRejectedValue(new Error("DB error") as never);

    await expect(InvoiceService.create(BASE_INPUT)).rejects.toThrow("DB error");
  });
});

describe("InvoiceService.getBook", () => {
  beforeEach(() => vi.clearAllMocks());

  const FILTER = {
    companyId: "company-1",
    type: "SALE" as const,
    year: 2026,
    month: 3,
  };

  it("retorna rows y summary vac├¡os cuando no hay facturas", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    const result = await InvoiceService.getBook(FILTER);

    expect(result.rows).toHaveLength(0);
    expect(result.summary.totalBaseGeneral).toBe("0.00");
    expect(result.summary.totalIvaGeneral).toBe("0.00");
    expect(result.summary.totalIgtf).toBe("0.00");
  });

  it("serializa taxLines correctamente", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([makeInvoiceRow()] as never);

    const result = await InvoiceService.getBook(FILTER);

    expect(result.rows[0].taxLines).toHaveLength(1);
    expect(result.rows[0].taxLines[0].taxType).toBe("IVA_GENERAL");
    expect(result.rows[0].taxLines[0].base).toBe("1000.00");
    expect(result.rows[0].taxLines[0].amount).toBe("160.00");
  });

  it("calcula summary con totales correctos", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      makeInvoiceRow(),
      makeInvoiceRow({ id: "inv-2", invoiceNumber: "0000002" }),
    ] as never);

    const result = await InvoiceService.getBook(FILTER);

    expect(result.summary.totalBaseGeneral).toBe("2000.00");
    expect(result.summary.totalIvaGeneral).toBe("320.00");
  });

  it("calcula IGTF en summary", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      makeInvoiceRow({
        igtfBase: new Decimal("1000.00"),
        igtfAmount: new Decimal("30.00"),
      }),
    ] as never);

    const result = await InvoiceService.getBook(FILTER);

    expect(result.summary.totalIgtf).toBe("30.00");
  });

  it("filtra por tipo PURCHASE correctamente", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await InvoiceService.getBook({ ...FILTER, type: "PURCHASE" });

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "PURCHASE" }),
      })
    );
  });

  it("filtra por rango de fechas del mes correcto", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await InvoiceService.getBook(FILTER);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: new Date(2026, 2, 1),
            lt: new Date(2026, 3, 1),
          },
        }),
      })
    );
  });
});