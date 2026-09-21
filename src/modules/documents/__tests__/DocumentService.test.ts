// src/modules/documents/__tests__/DocumentService.test.ts
//
// TDD SPEC (RED) — fix/factura-lujo-total
// DocumentService no tenía test propio (document.actions.test.ts lo mockea entero), así que
// este archivo cubre SOLO el cálculo del montoTotal del QR de generateInvoicePDFBuffer.
//
// Una factura de lujo (ADICIONAL_31) se guarda como DOS InvoiceTaxLine con la MISMA base
// (IVA_GENERAL 16% + IVA_ADICIONAL 15%). generateInvoicePDFBuffer sumaba `base + amount` de TODAS
// las filas: el QR del comprobante compartido por enlace llevaba TOTAL=2310.00 en vez de 1310.00.
//
// SeniatXMLService.qrContent se deja REAL (es puro, solo decimal.js): así se verifica el texto
// final que se codifica en el QR, no un argumento intermedio.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockToDataURL = vi.hoisted(() => vi.fn());
const mockGenerateInvoiceVoucherPDF = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  default: {
    invoice: { findFirst: vi.fn(), findMany: vi.fn() },
    retencion: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/modules/invoices/services/InvoiceVoucherPDFService", () => ({
  generateInvoiceVoucherPDF: mockGenerateInvoiceVoucherPDF,
}));

vi.mock("qrcode", () => ({
  default: { toDataURL: mockToDataURL },
}));

import prisma from "@/lib/prisma";
import { DocumentService } from "../services/DocumentService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
type TaxLineFixture = { taxType: string; base: string; rate: string; amount: string };

const invoiceWith = (taxLines: TaxLineFixture[]) => ({
  id: "inv-1",
  invoiceNumber: "0000001",
  controlNumber: "00-00000001",
  date: new Date("2026-03-01"),
  currency: "VES",
  type: "SALE",
  docType: "FACTURA",
  counterpartName: "Cliente Demo C.A.",
  counterpartRif: "J-12345678-9",
  company: { name: "Empresa Test C.A.", rif: "J-12345678-9", address: null },
  taxLines: taxLines.map((l) => ({
    taxType: l.taxType,
    base: new Decimal(l.base),
    rate: new Decimal(l.rate),
    amount: new Decimal(l.amount),
  })),
  ivaRetentionAmount: new Decimal("0"),
  ivaRetentionVoucher: null,
  islrRetentionAmount: new Decimal("0"),
  igtfBase: new Decimal("0"),
  igtfAmount: new Decimal("0"),
});

const luxuryLines = (base: string, general: string, additional: string): TaxLineFixture[] => [
  { taxType: "IVA_GENERAL", base, rate: "16", amount: general },
  { taxType: "IVA_ADICIONAL", base, rate: "15", amount: additional },
];

const qrText = (total: string) =>
  `CONTAFLOW:RIF=J-12345678-9;FACTURA=0000001;CONTROL=00-00000001;TOTAL=${total};FECHA=2026-03-01;MONEDA=VES`;

async function encodedQrText(taxLines: TaxLineFixture[]): Promise<string> {
  vi.mocked(prisma.invoice.findFirst).mockResolvedValue(invoiceWith(taxLines) as never);
  await DocumentService.generateInvoicePDFBuffer("inv-1", "company-1");
  expect(mockToDataURL).toHaveBeenCalledTimes(1);
  return mockToDataURL.mock.calls[0]![0] as string;
}

// ─── generateInvoicePDFBuffer — QR de factura de lujo ─────────────────────────
describe("DocumentService.generateInvoicePDFBuffer — montoTotal del QR (base contada UNA vez)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToDataURL.mockResolvedValue("data:image/png;base64,fakeQR==");
    mockGenerateInvoiceVoucherPDF.mockResolvedValue(Buffer.from("fake-pdf"));
  });

  it("base 1000 (G 1000/160.00 + A 1000/150.00): el QR codifica TOTAL=1310.00 (hoy 2310.00)", async () => {
    const text = await encodedQrText(luxuryLines("1000.00", "160.00", "150.00"));

    expect(text).toBe(qrText("1310.00"));
  });

  it("lujo con centavos (1333.33 → IVA 213.33 + 200.00): TOTAL=1746.66", async () => {
    const text = await encodedQrText(luxuryLines("1333.33", "213.33", "200.00"));

    expect(text).toBe(qrText("1746.66"));
  });

  it("factura mixta (general 600 + lujo 400 = tres filas): TOTAL=1220.00", async () => {
    const text = await encodedQrText([
      { taxType: "IVA_GENERAL", base: "600.00", rate: "16", amount: "96.00" },
      { taxType: "IVA_GENERAL", base: "400.00", rate: "16", amount: "64.00" },
      { taxType: "IVA_ADICIONAL", base: "400.00", rate: "15", amount: "60.00" },
    ]);

    expect(text).toBe(qrText("1220.00"));
  });

  it("GUARDA: el PDF sigue recibiendo las DOS filas de detalle (solo cambia el total del QR)", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(
      invoiceWith(luxuryLines("1000.00", "160.00", "150.00")) as never,
    );

    await DocumentService.generateInvoicePDFBuffer("inv-1", "company-1");

    expect(mockGenerateInvoiceVoucherPDF).toHaveBeenCalledTimes(1);
    const pdfParams = mockGenerateInvoiceVoucherPDF.mock.calls[0]![0] as { taxLines: unknown };
    expect(pdfParams.taxLines).toEqual([
      { taxType: "IVA_GENERAL", base: "1000.00", rate: "16.00", amount: "160.00" },
      { taxType: "IVA_ADICIONAL", base: "1000.00", rate: "15.00", amount: "150.00" },
    ]);
  });

  // ── Guardas de sobrecorrección (pasan hoy y deben seguir pasando) ─────────
  it("GUARDA: solo general 1000/160 → TOTAL=1160.00", async () => {
    const text = await encodedQrText([{ taxType: "IVA_GENERAL", base: "1000.00", rate: "16", amount: "160.00" }]);

    expect(text).toBe(qrText("1160.00"));
  });

  it("GUARDA: general + reducido + exento → base de cada alícuota entra una vez (TOTAL=1900.00)", async () => {
    const text = await encodedQrText([
      { taxType: "IVA_GENERAL", base: "1000.00", rate: "16", amount: "160.00" },
      { taxType: "IVA_REDUCIDO", base: "500.00", rate: "8", amount: "40.00" },
      { taxType: "EXENTO", base: "200.00", rate: "0", amount: "0.00" },
    ]);

    expect(text).toBe(qrText("1900.00"));
  });
});
