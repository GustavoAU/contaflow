// src/modules/export/__tests__/ExportService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => ({
  default: {
    invoice: { findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
    retencion: { findMany: vi.fn() },
    fixedAsset: { findMany: vi.fn() },
    employee: { findMany: vi.fn() },
    payrollRun: { findMany: vi.fn() },
    inventoryItem: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
  },
}));

vi.mock("@/modules/iva-declaration/services/DeclaracionIVAService", () => ({
  DeclaracionIVAService: {
    calculate: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { DeclaracionIVAService } from "@/modules/iva-declaration/services/DeclaracionIVAService";
import { generateExportZip } from "../services/ExportService";
import { Decimal } from "decimal.js";

const COMPANY_ID = "company-1";
const DATE_FROM = new Date("2026-01-01");
const DATE_TO = new Date("2026-01-31");

const PARAMS = { companyId: COMPANY_ID, dateFrom: DATE_FROM, dateTo: DATE_TO };

function makeInvoice(overrides = {}) {
  return {
    invoiceNumber: "0000001",
    controlNumber: "00-0000001",
    docType: "FACTURA",
    type: "SALE",
    date: new Date("2026-01-15"),
    counterpartName: "Cliente ABC",
    counterpartRif: "J-12345678-9",
    currency: "VES",
    taxCategory: "GRAVADA",
    ivaRetentionAmount: new Decimal(0),
    ivaRetentionVoucher: null,
    islrRetentionAmount: new Decimal(0),
    igtfAmount: new Decimal(0),
    paymentStatus: "UNPAID",
    relatedDocNumber: null,
    taxLines: [
      { taxType: "IVA_GENERAL", base: new Decimal("862.07"), amount: new Decimal("137.93") },
    ],
    ...overrides,
  };
}

function makeTransaction() {
  return {
    number: "AST-001",
    date: new Date("2026-01-10"),
    description: "Factura cliente",
    reference: null,
    type: "DIARIO",
    status: "POSTED",
    entries: [
      {
        accountId: "acc-1",
        account: { code: "1.1.1", name: "Caja" },
        amount: new Decimal("1000"),
      },
    ],
  };
}

function makeForma30Result() {
  const zero = new Decimal(0);
  return {
    companyId: COMPANY_ID,
    year: 2026,
    month: 1,
    periodExists: true,
    isSpecialContributor: false,
    seccionA: {
      general: { base: new Decimal("862.07"), tax: new Decimal("137.93") },
      reducida: { base: zero, tax: zero },
      adicionalLujo: { base: zero, tax: zero },
      exentasExoneradas: { base: zero },
      exportaciones: { base: zero },
      totalDebitosFiscales: new Decimal("137.93"),
    },
    seccionB: {
      general: { base: zero, tax: zero },
      reducida: { base: zero, tax: zero },
      adicionalLujo: { base: zero, tax: zero },
      exentasExoneradas: { base: zero },
      importaciones: { base: zero, tax: zero },
      totalCreditosFiscales: zero,
    },
    seccionC: {
      retencionesIvaSufridas: zero,
      retencionesIvaPracticadas: zero,
      totalRetenciones: zero,
    },
    seccionD: { igtfBase: zero, igtfTotal: zero },
    seccionE: {
      cuotaPeriodo: new Decimal("137.93"),
      esSaldoAFavor: false,
    },
    calculatedAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.transaction.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.retencion.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.fixedAsset.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.expense.findMany).mockResolvedValue([] as never);
  vi.mocked(DeclaracionIVAService.calculate).mockResolvedValue(makeForma30Result() as never);
});

describe("generateExportZip", () => {
  it("retorna un Buffer cuando todos los datos están vacíos", async () => {
    const result = await generateExportZip(PARAMS);
    expect(result.data).toBeInstanceOf(Buffer);
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it("incluye LEEME.txt en el ZIP con el companyId y rango de fechas", async () => {
    const JSZip = await import("jszip");
    const result = await generateExportZip(PARAMS);
    const zip = await JSZip.default.loadAsync(result.data);
    const readme = await zip.file("LEEME.txt")?.async("string");
    expect(readme).toContain(COMPANY_ID);
    expect(readme).toContain("2026-01-01");
    expect(readme).toContain("2026-01-31");
  });

  it("incluye libro-ventas.csv cuando hay facturas de SALE", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([makeInvoice()] as never);
    const JSZip = await import("jszip");
    const result = await generateExportZip(PARAMS);
    const zip = await JSZip.default.loadAsync(result.data);
    expect(zip.file("libros-iva/libro-ventas.csv")).not.toBeNull();
  });

  it("incluye libro-compras.csv cuando hay facturas de PURCHASE", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([makeInvoice({ type: "PURCHASE" })] as never);
    const JSZip = await import("jszip");
    const result = await generateExportZip(PARAMS);
    const zip = await JSZip.default.loadAsync(result.data);
    expect(zip.file("libros-iva/libro-compras.csv")).not.toBeNull();
  });

  it("incluye asientos.csv cuando hay transacciones", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([makeTransaction()] as never);
    const JSZip = await import("jszip");
    const result = await generateExportZip(PARAMS);
    const zip = await JSZip.default.loadAsync(result.data);
    expect(zip.file("asientos/asientos.csv")).not.toBeNull();
  });

  it("incluye retenciones.csv cuando hay retenciones", async () => {
    vi.mocked(prisma.retencion.findMany).mockResolvedValue([{
      voucherNumber: "RET-001",
      providerName: "Proveedor A",
      providerRif: "J-11111111-1",
      invoiceNumber: "0000001",
      invoiceDate: new Date("2026-01-10"),
      invoiceAmount: new Decimal("1000"),
      taxBase: new Decimal("862.07"),
      ivaAmount: new Decimal("137.93"),
      ivaRetention: new Decimal("103.45"),
      ivaRetentionPct: new Decimal("75"),
      islrAmount: null,
      islrRetentionPct: null,
      totalRetention: new Decimal("103.45"),
      type: "IVA",
      status: "ISSUED",
    }] as never);
    const JSZip = await import("jszip");
    const result = await generateExportZip(PARAMS);
    const zip = await JSZip.default.loadAsync(result.data);
    expect(zip.file("retenciones/retenciones.csv")).not.toBeNull();
  });

  it("incluye forma-30.csv con datos de Forma30 calculados por mes", async () => {
    const JSZip = await import("jszip");
    const result = await generateExportZip(PARAMS);
    const zip = await JSZip.default.loadAsync(result.data);
    const csv = await zip.file("forma-30/forma30.csv")?.async("string");
    expect(csv).toContain("2026");
    expect(csv).toContain("137.93");
  });

  it("incluye mes vacío en forma30 si DeclaracionIVAService.calculate lanza error", async () => {
    vi.mocked(DeclaracionIVAService.calculate).mockRejectedValue(
      new Error("Período no existe")
    );
    const JSZip = await import("jszip");
    const result = await generateExportZip(PARAMS);
    const zip = await JSZip.default.loadAsync(result.data);
    const csv = await zip.file("forma-30/forma30.csv")?.async("string");
    // still has the row but empty values
    expect(csv).toContain("2026");
  });

  it("NO incluye libro-ventas.csv si no hay facturas de SALE", async () => {
    const JSZip = await import("jszip");
    const result = await generateExportZip(PARAMS);
    const zip = await JSZip.default.loadAsync(result.data);
    expect(zip.file("libros-iva/libro-ventas.csv")).toBeNull();
  });

  it("sizeBytes coincide con la longitud real del buffer", async () => {
    const result = await generateExportZip(PARAMS);
    expect(result.sizeBytes).toBe(result.data.length);
  });
});
