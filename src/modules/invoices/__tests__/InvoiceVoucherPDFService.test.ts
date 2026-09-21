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

// ─── fix/factura-lujo-total — TDD SPEC (RED) ──────────────────────────────────
// Sección TOTALES del comprobante. Una factura de lujo (ADICIONAL_31) llega como DOS filas con
// la MISMA base (IVA_GENERAL 16% + IVA_ADICIONAL 15%). TotalsSection sumaba `base` de TODAS las
// filas: "Base Imponible Total" 2000.00 y "TOTAL FACTURA" 2310.00 en vez de 1000.00 y 1310.00.
//
// El mock de @react-pdf/renderer no renderiza nada (renderToBuffer es un vi.fn). Para leer los
// importes que el PDF mostraría se recorre el árbol que recibe renderToBuffer, ejecutando los
// componentes de función (los mocks de Document/Page/View/Text devuelven `children`).

type TreeNode = { type?: unknown; props?: { children?: unknown } }

function collectTexts(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return []
  if (typeof node === "string" || typeof node === "number") return [String(node)]
  if (Array.isArray(node)) return node.flatMap(collectTexts)
  const el = node as TreeNode
  if (typeof el.type === "function") {
    return collectTexts((el.type as (props: unknown) => unknown)(el.props ?? {}))
  }
  return collectTexts(el.props?.children)
}

async function renderedTotals(params: InvoiceVoucherPDFParams) {
  vi.mocked(renderToBuffer).mockClear()
  await generateInvoiceVoucherPDF(params)
  const element = vi.mocked(renderToBuffer).mock.calls[0]?.[0]
  const texts = collectTexts(element)
  // El valor de cada fila de totales es el texto inmediatamente posterior a su etiqueta
  const valueAfter = (label: string): string | undefined => {
    const idx = texts.indexOf(label)
    return idx === -1 ? undefined : texts[idx + 1]
  }
  return {
    texts,
    base: valueAfter("Base Imponible Total:"),
    iva: valueAfter("Total IVA:"),
    total: valueAfter("TOTAL FACTURA:"),
  }
}

const luxuryParams = (base: string, general: string, additional: string): InvoiceVoucherPDFParams => ({
  ...baseParams,
  invoiceType: "SALE",
  taxLines: [
    { taxType: "IVA_GENERAL", base, rate: "16", amount: general },
    { taxType: "IVA_ADICIONAL", base, rate: "15", amount: additional },
  ],
})

describe("generateInvoiceVoucherPDF — TotalsSection de factura de lujo (base contada UNA vez)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("base 1000 (G 1000/160.00 + A 1000/150.00): Base Imponible Total 1000.00 (hoy 2000.00)", async () => {
    const totals = await renderedTotals(luxuryParams("1000.00", "160.00", "150.00"))
    expect(totals.base).toBe("1000.00")
  })

  it("base 1000: TOTAL FACTURA 1310.00 (hoy 2310.00)", async () => {
    const totals = await renderedTotals(luxuryParams("1000.00", "160.00", "150.00"))
    expect(totals.total).toBe("1310.00")
  })

  it("GUARDA: base 1000: Total IVA 310.00 (el IVA nunca estuvo mal)", async () => {
    const totals = await renderedTotals(luxuryParams("1000.00", "160.00", "150.00"))
    expect(totals.iva).toBe("310.00")
  })

  it("lujo con centavos (1333.33 → IVA 213.33 + 200.00): 1333.33 / 413.33 / 1746.66", async () => {
    const totals = await renderedTotals(luxuryParams("1333.33", "213.33", "200.00"))
    expect(totals.base).toBe("1333.33")
    expect(totals.iva).toBe("413.33")
    expect(totals.total).toBe("1746.66")
  })

  it("factura mixta (general 600 + lujo 400 = tres filas): 1000.00 / 220.00 / 1220.00", async () => {
    const totals = await renderedTotals({
      ...baseParams,
      taxLines: [
        { taxType: "IVA_GENERAL", base: "600.00", rate: "16", amount: "96.00" },
        { taxType: "IVA_GENERAL", base: "400.00", rate: "16", amount: "64.00" },
        { taxType: "IVA_ADICIONAL", base: "400.00", rate: "15", amount: "60.00" },
      ],
    })
    expect(totals.base).toBe("1000.00")
    expect(totals.iva).toBe("220.00")
    expect(totals.total).toBe("1220.00")
  })

  it("GUARDA: la tabla DETALLE FISCAL conserva las DOS filas (General 16% y Adicional 15%)", async () => {
    const { texts } = await renderedTotals(luxuryParams("1000.00", "160.00", "150.00"))
    expect(texts.filter((t) => t === "IVA General (16%)")).toHaveLength(1)
    expect(texts.filter((t) => t === "IVA Adicional (15%)")).toHaveLength(1)
  })

  // ── Guardas de sobrecorrección (pasan hoy y deben seguir pasando) ─────────
  it("GUARDA: solo general 1000/160 → 1000.00 / 160.00 / 1160.00", async () => {
    const totals = await renderedTotals(baseParams)
    expect(totals).toMatchObject({ base: "1000.00", iva: "160.00", total: "1160.00" })
  })

  it("GUARDA: general + reducido + exento → base de cada alícuota entra una vez (1700 / 200 / 1900)", async () => {
    const totals = await renderedTotals({
      ...baseParams,
      taxLines: [
        { taxType: "IVA_GENERAL", base: "1000.00", rate: "16", amount: "160.00" },
        { taxType: "IVA_REDUCIDO", base: "500.00", rate: "8", amount: "40.00" },
        { taxType: "EXENTO", base: "200.00", rate: "0", amount: "0.00" },
      ],
    })
    expect(totals).toMatchObject({ base: "1700.00", iva: "200.00", total: "1900.00" })
  })

  it("GUARDA: taxLines vacío → 0.00 / 0.00 / 0.00", async () => {
    const totals = await renderedTotals({ ...baseParams, taxLines: [] })
    expect(totals).toMatchObject({ base: "0.00", iva: "0.00", total: "0.00" })
  })
})
