// src/modules/retentions/__tests__/RetentionVoucherPDFService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { RetentionVoucherParams } from "../services/RetentionVoucherPDFService"

// ─── Mock de @react-pdf/renderer ───────────────────────────────────────────────
vi.mock("@react-pdf/renderer", () => ({
  Document: ({ children }: any) => children,
  Page: ({ children }: any) => children,
  Text: ({ children }: any) => children,
  View: ({ children }: any) => children,
  StyleSheet: { create: (s: any) => s },
  renderToBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
}))

// Importar DESPUÉS del mock
import { generateRetentionVoucherPDF } from "../services/RetentionVoucherPDFService"

// ─── Fixture ───────────────────────────────────────────────────────────────────
const validParams: RetentionVoucherParams = {
  companyName: "Empresa Test C.A.",
  companyRif: "J-12345678-9",
  voucherNumber: "00-00000001",
  issueDate: new Date("2026-01-15"),
  providerName: "Proveedor S.A.",
  providerRif: "V-87654321",
  periodLabel: "Enero 2026",
  retentionType: "IVA",
  retentionRate: 75,
  invoiceNumber: "00-00000042",
  invoiceDate: new Date("2026-01-10"),
  invoiceAmount: "1500.00",
  taxableBase: "1500.00",
  retainedAmount: "180.00", // 1500 * 16% * 75% = 180
}

// ─── Tests ─────────────────────────────────────────────────────────────────────
describe("generateRetentionVoucherPDF", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("cuando se llama con datos válidos, retorna Buffer no vacío", async () => {
    const result = await generateRetentionVoucherPDF(validParams)
    expect(result).toBeInstanceOf(Buffer)
    expect(result.length).toBeGreaterThan(0)
  })

  it("cuando retentionType es IVA, llama renderToBuffer una vez", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer")
    await generateRetentionVoucherPDF({ ...validParams, retentionType: "IVA", retentionRate: 75 })
    expect(vi.mocked(renderToBuffer)).toHaveBeenCalledTimes(1)
  })

  it("cuando retentionType es ISLR, llama renderToBuffer una vez", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer")
    await generateRetentionVoucherPDF({ ...validParams, retentionType: "ISLR", retentionRate: 2 })
    expect(vi.mocked(renderToBuffer)).toHaveBeenCalledTimes(1)
  })

  it("cuando los montos son strings (Decimal serializado), no lanza error", async () => {
    const params = {
      ...validParams,
      invoiceAmount: "1500.00",
      taxableBase: "1500.00",
      retainedAmount: "22.50",
    }
    await expect(generateRetentionVoucherPDF(params)).resolves.toBeInstanceOf(Buffer)
  })
})
