import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { MockDigitalInvoiceProvider } from "../providers/mock.provider";
import { NullDigitalInvoiceProvider } from "../providers/null.provider";
import { createDigitalInvoiceProvider, createMockProvider } from "../DigitalInvoiceFactory";
import { DigitalInvoiceProviderError } from "../provider.types";
import type { DigitalInvoiceSubmission } from "../provider.types";

const BASE_INVOICE: DigitalInvoiceSubmission = {
  companyRif:     "J-12345678-9",
  companyName:    "Empresa Demo C.A.",
  companyAddress: "Av. Principal, Caracas",
  customerRif:    "V-12345678",
  customerName:   "Cliente Demo",
  invoiceDate:    new Date("2026-05-27"),
  docType:        "FACTURA",
  lines: [
    {
      description: "Servicio de consultoría",
      quantity:    new Decimal("1"),
      unitPrice:   new Decimal("100.00"),
      taxRate:     16,
      total:       new Decimal("100.00"),
    },
  ],
  subtotal:  new Decimal("100.00"),
  ivaAmount: new Decimal("16.00"),
  total:     new Decimal("116.00"),
  currency:  "VES",
};

describe("MockDigitalInvoiceProvider", () => {
  it("devuelve número de control y QR al emitir factura", async () => {
    const provider = new MockDigitalInvoiceProvider();
    const result = await provider.submitInvoice(BASE_INVOICE);

    expect(result.controlNumber).toMatch(/^00-\d{8}$/);
    expect(result.qrCodeData).toContain("efactura.seniat.gob.ve");
    expect(result.providerReferenceId).toContain("MOCK-");
    expect(result.isContingency).toBe(false);
  });

  it("genera números de control incrementales", async () => {
    const provider = new MockDigitalInvoiceProvider();
    const r1 = await provider.submitInvoice(BASE_INVOICE);
    const r2 = await provider.submitInvoice(BASE_INVOICE);

    const n1 = parseInt(r1.controlNumber.split("-")[1]);
    const n2 = parseInt(r2.controlNumber.split("-")[1]);
    expect(n2).toBe(n1 + 1);
  });

  it("simula contingencia cuando simulateContingency=true", async () => {
    const provider = new MockDigitalInvoiceProvider({ simulateContingency: true });
    const result = await provider.submitInvoice(BASE_INVOICE);
    expect(result.isContingency).toBe(true);
  });

  it("lanza DigitalInvoiceProviderError cuando simulateTimeout=true", async () => {
    const provider = new MockDigitalInvoiceProvider({ simulateTimeout: true });
    await expect(provider.submitInvoice(BASE_INVOICE)).rejects.toBeInstanceOf(
      DigitalInvoiceProviderError,
    );
  });

  it("healthCheck devuelve true en condiciones normales", async () => {
    const provider = new MockDigitalInvoiceProvider();
    expect(await provider.healthCheck()).toBe(true);
  });

  it("healthCheck devuelve false cuando simulateTimeout=true", async () => {
    const provider = new MockDigitalInvoiceProvider({ simulateTimeout: true });
    expect(await provider.healthCheck()).toBe(false);
  });

  it("voidInvoice devuelve success:true", async () => {
    const provider = new MockDigitalInvoiceProvider();
    const result = await provider.voidInvoice("00-00001001", "Error de prueba");
    expect(result.success).toBe(true);
    expect(result.voidedAt).toBeInstanceOf(Date);
  });
});

describe("NullDigitalInvoiceProvider", () => {
  it("lanza error si se intenta emitir", async () => {
    const provider = new NullDigitalInvoiceProvider();
    await expect(provider.submitInvoice(BASE_INVOICE)).rejects.toThrow(
      "NullProvider",
    );
  });

  it("healthCheck devuelve false", async () => {
    const provider = new NullDigitalInvoiceProvider();
    expect(await provider.healthCheck()).toBe(false);
  });
});

describe("createDigitalInvoiceProvider (factory)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
  });

  it("en NODE_ENV=test siempre retorna MockProvider", () => {
    const provider = createDigitalInvoiceProvider({ provider: "NONE" });
    expect(provider?.name).toBe("MOCK");
  });

  it("createMockProvider crea un MockProvider directamente", () => {
    const provider = createMockProvider({ simulateContingency: true });
    expect(provider.name).toBe("MOCK");
  });
});
