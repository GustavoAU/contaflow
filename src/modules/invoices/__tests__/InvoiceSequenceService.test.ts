// Tests para getNextControlNumber — Fase 12B item 18.1
import { describe, it, expect, vi, beforeEach } from "vitest"
import { InvoiceType } from "@prisma/client"
import { Prisma } from "@prisma/client"
import { getNextControlNumber } from "../services/InvoiceSequenceService"

// mockTx: objeto directo — getNextControlNumber recibe tx como parámetro,
// no llama a prisma.$transaction internamente.
const mockTx = {
  controlNumberSequence: {
    upsert: vi.fn(),
  },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getNextControlNumber", () => {
  // Test 1 — Happy path SALE
  it("retorna '00-00000001' para la primera factura SALE", async () => {
    // Arrange
    vi.mocked(mockTx.controlNumberSequence.upsert).mockResolvedValue({
      id: "seq-1",
      companyId: "co-1",
      invoiceType: InvoiceType.SALE,
      lastNumber: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    // Act
    const result = await getNextControlNumber(mockTx as never, "co-1", InvoiceType.SALE)

    // Assert
    expect(result).toBe("00-00000001")
    expect(mockTx.controlNumberSequence.upsert).toHaveBeenCalledWith({
      where: { companyId_invoiceType: { companyId: "co-1", invoiceType: InvoiceType.SALE } },
      create: { companyId: "co-1", invoiceType: InvoiceType.SALE, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    })
  })

  // Test 2 — Happy path PURCHASE (secuencia independiente)
  it("retorna '00-00000001' para PURCHASE y llama upsert con invoiceType PURCHASE", async () => {
    // Arrange
    vi.mocked(mockTx.controlNumberSequence.upsert).mockResolvedValue({
      id: "seq-2",
      companyId: "co-1",
      invoiceType: InvoiceType.PURCHASE,
      lastNumber: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    // Act
    const result = await getNextControlNumber(mockTx as never, "co-1", InvoiceType.PURCHASE)

    // Assert
    expect(result).toBe("00-00000001")
    expect(mockTx.controlNumberSequence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId_invoiceType: { companyId: "co-1", invoiceType: InvoiceType.PURCHASE },
        },
      })
    )
    // Verificar explícitamente que se usó PURCHASE, no SALE
    const callArg = vi.mocked(mockTx.controlNumberSequence.upsert).mock.calls[0][0]
    expect(callArg.create.invoiceType).toBe(InvoiceType.PURCHASE)
  })

  // Test 3 — Concurrencia: 2 llamadas simultáneas retornan números distintos
  it("cuando se llaman 2 veces en paralelo, retorna números distintos", async () => {
    // Arrange
    let callCount = 0
    vi.mocked(mockTx.controlNumberSequence.upsert).mockImplementation(async () => {
      callCount++
      return {
        id: "seq-1",
        companyId: "co-1",
        invoiceType: InvoiceType.SALE,
        lastNumber: callCount,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    })

    // Act
    const [n1, n2] = await Promise.all([
      getNextControlNumber(mockTx as never, "co-1", InvoiceType.SALE),
      getNextControlNumber(mockTx as never, "co-1", InvoiceType.SALE),
    ])

    // Assert
    expect(n1).not.toBe(n2)
    expect(new Set([n1, n2]).size).toBe(2)
  })

  // Test 4 — Empresa inexistente: la función propaga el error P2003
  it("propaga PrismaClientKnownRequestError P2003 cuando la empresa no existe", async () => {
    // Arrange
    const p2003 = new Prisma.PrismaClientKnownRequestError(
      "Foreign key constraint failed on the field: `companyId`",
      { code: "P2003", clientVersion: "5.0.0" }
    )
    vi.mocked(mockTx.controlNumberSequence.upsert).mockRejectedValue(p2003)

    // Act & Assert
    await expect(
      getNextControlNumber(mockTx as never, "co-inexistente", InvoiceType.SALE)
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError)

    const thrownError = await getNextControlNumber(
      mockTx as never,
      "co-inexistente",
      InvoiceType.SALE
    ).catch((e) => e)
    expect(thrownError.code).toBe("P2003")
  })
})
