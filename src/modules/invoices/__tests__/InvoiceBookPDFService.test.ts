// src/modules/invoices/__tests__/InvoiceBookPDFService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { InvoiceBookPDFParams } from "../services/InvoiceBookPDFService"

// ─── Mock de @react-pdf/renderer ───────────────────────────────────────────────
vi.mock("@react-pdf/renderer", () => ({
  Document: ({ children }: { children: unknown }) => children,
  Page: ({ children }: { children: unknown }) => children,
  Text: ({ children }: { children: unknown }) => children,
  View: ({ children }: { children: unknown }) => children,
  StyleSheet: { create: (s: Record<string, unknown>) => s },
  renderToBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
}))

// Importar DESPUÉS del mock
import { generateInvoiceBookPDF } from "../services/InvoiceBookPDFService"
import { renderToBuffer } from "@react-pdf/renderer"

// ─── Fixtures ──────────────────────────────────────────────────────────────────
const baseParams: InvoiceBookPDFParams = {
  companyId: "company-1",
  companyName: "Empresa de Prueba, C.A.",
  companyRif: "J-12345678-9",
  periodId: "period-1",
  periodLabel: "Enero 2026",
  invoiceType: "SALE",
  invoices: [],
  summary: {
    totalBaseGeneral: "1000.00",
    totalIvaGeneral: "160.00",
    totalBaseReduced: "0.00",
    totalIvaReduced: "0.00",
    totalBaseAdditional: "0.00",
    totalIvaAdditional: "0.00",
    totalExempt: "0.00",
    totalIvaRetention: "0.00",
    totalIslrRetention: "0.00",
    totalIgtf: "30.00",
  },
}

const sampleInvoice = {
  id: "inv-1",
  date: new Date("2026-01-15"),
  invoiceNumber: "0000001",
  controlNumber: "00-00000001",
  relatedDocNumber: null,
  importFormNumber: null,
  reportZStart: null,
  reportZEnd: null,
  docType: "FACTURA",
  taxCategory: "GRAVADO",
  counterpartName: "Cliente Test, S.A.",
  counterpartRif: "J-98765432-1",
  ivaRetentionAmount: "0.00",
  ivaRetentionVoucher: null,
  ivaRetentionDate: null,
  islrRetentionAmount: "0.00",
  igtfBase: "1000.00",
  igtfAmount: "30.00",
  taxLines: [
    {
      id: "line-1",
      taxType: "IVA_GENERAL",
      base: "1000.00",
      rate: "16.00",
      amount: "160.00",
    },
  ],
}

// ─── Tests ─────────────────────────────────────────────────────────────────────
describe("generateInvoiceBookPDF", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(renderToBuffer).mockResolvedValue(Buffer.from("fake-pdf"))
  })

  it("cuando se llama con datos válidos, retorna un Buffer no vacío", async () => {
    // Arrange
    const params = { ...baseParams }

    // Act
    const result = await generateInvoiceBookPDF(params)

    // Assert
    expect(result).toBeInstanceOf(Buffer)
    expect(result.length).toBeGreaterThan(0)
    expect(renderToBuffer).toHaveBeenCalledTimes(1)
  })

  it("cuando invoiceType es SALE, llama a renderToBuffer sin lanzar error", async () => {
    // Arrange
    const params: InvoiceBookPDFParams = {
      ...baseParams,
      invoiceType: "SALE",
      invoices: [sampleInvoice],
    }

    // Act
    const result = await generateInvoiceBookPDF(params)

    // Assert
    expect(result).toBeInstanceOf(Buffer)
    expect(renderToBuffer).toHaveBeenCalledTimes(1)

    // Verificar que el elemento pasado a renderToBuffer corresponde al documento
    const callArg = (vi.mocked(renderToBuffer).mock.calls[0][0] as unknown) as {
      type: unknown
      props: { params: InvoiceBookPDFParams }
    }
    expect(callArg.props.params.invoiceType).toBe("SALE")
    expect(callArg.props.params.periodLabel).toBe("Enero 2026")
  })

  it("cuando invoiceType es PURCHASE, llama a renderToBuffer con invoiceType PURCHASE", async () => {
    // Arrange
    const params: InvoiceBookPDFParams = {
      ...baseParams,
      invoiceType: "PURCHASE",
      invoices: [{ ...sampleInvoice, igtfBase: "0.00", igtfAmount: "0.00" }],
      summary: {
        ...baseParams.summary,
        totalIgtf: "0.00",
        totalIslrRetention: "50.00",
      },
    }

    // Act
    const result = await generateInvoiceBookPDF(params)

    // Assert
    expect(result).toBeInstanceOf(Buffer)
    expect(renderToBuffer).toHaveBeenCalledTimes(1)

    const callArg = (vi.mocked(renderToBuffer).mock.calls[0][0] as unknown) as {
      type: unknown
      props: { params: InvoiceBookPDFParams }
    }
    expect(callArg.props.params.invoiceType).toBe("PURCHASE")
  })

  it("cuando no hay facturas, genera PDF sin lanzar error", async () => {
    // Arrange
    const params: InvoiceBookPDFParams = {
      ...baseParams,
      invoices: [],
      summary: {
        totalBaseGeneral: "0.00",
        totalIvaGeneral: "0.00",
        totalBaseReduced: "0.00",
        totalIvaReduced: "0.00",
        totalBaseAdditional: "0.00",
        totalIvaAdditional: "0.00",
        totalExempt: "0.00",
        totalIvaRetention: "0.00",
        totalIslrRetention: "0.00",
        totalIgtf: "0.00",
      },
    }

    // Act
    const result = await generateInvoiceBookPDF(params)

    // Assert
    expect(result).toBeInstanceOf(Buffer)
    expect(renderToBuffer).toHaveBeenCalledTimes(1)
  })

  it("cuando hay facturas sin taxLines, genera PDF sin lanzar error", async () => {
    // Arrange
    const invoiceWithoutTaxLines = { ...sampleInvoice, taxLines: [] }
    const params: InvoiceBookPDFParams = {
      ...baseParams,
      invoices: [invoiceWithoutTaxLines],
    }

    // Act
    const result = await generateInvoiceBookPDF(params)

    // Assert
    expect(result).toBeInstanceOf(Buffer)
    expect(renderToBuffer).toHaveBeenCalledTimes(1)
  })
})
