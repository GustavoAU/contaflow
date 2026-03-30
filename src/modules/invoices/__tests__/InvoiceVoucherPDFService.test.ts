// src/modules/invoices/__tests__/InvoiceVoucherPDFService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { InvoiceVoucherPDFParams } from "../services/InvoiceVoucherPDFService"

// ─── Mock de @react-pdf/renderer ───────────────────────────────────────────────
vi.mock("@react-pdf/renderer", () => ({
  Document: ({ children }: { children: unknown }) => children,
  Page: ({ children }: { children: unknown }) => children,
  Text: ({ children }: { children: unknown }) => children,
  View: ({ children }: { children: unknown }) => children,
  StyleSheet: { create: <T extends Record<string, unknown>>(s: T) => s },
  renderToBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
}))

import { generateInvoiceVoucherPDF } from "../services/InvoiceVoucherPDFService"
import { renderToBuffer } from "@react-pdf/renderer"

// ─── Fixtures ──────────────────────────────────────────────────────────────────
const baseParams: InvoiceVoucherPDFParams = {
  companyName: "Empresa de Prueba C.A.",
  companyRif: "J-12345678-9",
  companyAddress: "Caracas, Venezuela",
  invoiceNumber: "B00000001",
  controlNumber: "00-00000001",
  invoiceType: "PURCHASE",
  docType: "FACTURA",
  date: new Date("2026-03-15"),
  counterpartName: "Proveedor ABC C.A.",
  counterpartRif: "J-98765432-1",
  taxLines: [
    { taxType: "IVA_GENERAL", base: "1000.00", rate: "16", amount: "160.00" },
  ],
}

describe("generateInvoiceVoucherPDF", () => {
  beforeEach(() => vi.clearAllMocks())

  it("retorna Buffer no vacío con datos mínimos", async () => {
    const result = await generateInvoiceVoucherPDF(baseParams)

    expect(result).toBeInstanceOf(Buffer)
    expect(result.length).toBeGreaterThan(0)
    expect(renderToBuffer).toHaveBeenCalledOnce()
  })

  it("funciona sin retenciones ni IGTF (campos opcionales omitidos)", async () => {
    const params: InvoiceVoucherPDFParams = {
      companyName: "Empresa C.A.",
      companyRif: "J-12345678-9",
      invoiceNumber: "A00000005",
      invoiceType: "SALE",
      docType: "FACTURA",
      date: new Date("2026-01-10"),
      counterpartName: "Cliente XYZ",
      counterpartRif: "V-12345678",
      taxLines: [
        { taxType: "IVA_GENERAL", base: "500.00", rate: "16", amount: "80.00" },
        { taxType: "EXENTO", base: "200.00", rate: "0", amount: "0.00" },
      ],
    }

    await expect(generateInvoiceVoucherPDF(params)).resolves.toBeInstanceOf(Buffer)
  })

  it("incluye retenciones IVA e ISLR cuando se proveen", async () => {
    const params: InvoiceVoucherPDFParams = {
      ...baseParams,
      ivaRetentionAmount: "120.00",
      ivaRetentionVoucher: "CR-00000001",
      islrRetentionAmount: "20.00",
    }

    await expect(generateInvoiceVoucherPDF(params)).resolves.toBeInstanceOf(Buffer)
    expect(renderToBuffer).toHaveBeenCalledOnce()
  })

  it("incluye IGTF cuando se provee", async () => {
    const params: InvoiceVoucherPDFParams = {
      ...baseParams,
      invoiceType: "SALE",
      igtfBase: "1000.00",
      igtfAmount: "30.00",
    }

    await expect(generateInvoiceVoucherPDF(params)).resolves.toBeInstanceOf(Buffer)
  })

  it("funciona con múltiples líneas de IVA (GENERAL + REDUCIDO + ADICIONAL)", async () => {
    const params: InvoiceVoucherPDFParams = {
      ...baseParams,
      taxLines: [
        { taxType: "IVA_GENERAL", base: "1000.00", rate: "16", amount: "160.00" },
        { taxType: "IVA_REDUCIDO", base: "500.00", rate: "8", amount: "40.00" },
        { taxType: "IVA_ADICIONAL", base: "200.00", rate: "15", amount: "30.00" },
      ],
    }

    await expect(generateInvoiceVoucherPDF(params)).resolves.toBeInstanceOf(Buffer)
  })

  it("funciona con taxLines vacío (factura sin detalle fiscal)", async () => {
    const params: InvoiceVoucherPDFParams = { ...baseParams, taxLines: [] }

    await expect(generateInvoiceVoucherPDF(params)).resolves.toBeInstanceOf(Buffer)
  })
})
