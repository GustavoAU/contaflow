// src/modules/receivables/services/ReceivableService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import { ReceivableService } from "./ReceivableService";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/modules/fiscal-close/services/FiscalYearCloseService", () => ({
  FiscalYearCloseService: {
    isFiscalYearClosed: vi.fn().mockResolvedValue(false),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────
const makeInvoiceRecord = (overrides: Record<string, unknown> = {}) => ({
  id: "inv-1",
  invoiceNumber: "0000001",
  controlNumber: "00-0000001",
  docType: "FACTURA",
  counterpartName: "Cliente Demo C.A.",
  counterpartRif: "J-12345678-9",
  relatedDocNumber: null,
  date: new Date("2026-03-01"),
  dueDate: new Date("2026-03-31"),
  currency: "VES",
  totalAmountVes: new Decimal("1160.00"),
  pendingAmount: new Decimal("1160.00"),
  paymentStatus: "UNPAID",
  invoicePayments: [],
  ...overrides,
});

const AS_OF = new Date("2026-04-01");

// ─── getReceivablesPaginated ──────────────────────────────────────────────────

describe("ReceivableService.getReceivablesPaginated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna facturas de venta pendientes paginadas", async () => {
    const records = [makeInvoiceRecord()];
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(records as never);

    const result = await ReceivableService.getReceivablesPaginated("company-1", AS_OF);

    expect(result.data).toHaveLength(1);
    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.data[0].invoiceId).toBe("inv-1");
    expect(result.data[0].paymentStatus).toBe("UNPAID");
  });

  it("verifica que la query usa type=SALE", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await ReceivableService.getReceivablesPaginated("company-1", AS_OF);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "company-1",
          type: "SALE",
          deletedAt: null,
          paymentStatus: { not: "PAID" },
        }),
      })
    );
  });

  it("primera página sin cursor retorna nextCursor no nulo cuando hay más registros", async () => {
    // limit=2, take=3, mock devuelve 3 => hay más
    const records = Array.from({ length: 3 }, (_, i) =>
      makeInvoiceRecord({ id: `inv-${i + 1}`, invoiceNumber: `000000${i + 1}` })
    );
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(records as never);

    const result = await ReceivableService.getReceivablesPaginated("company-1", AS_OF, undefined, 2);

    expect(result.hasNextPage).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.nextCursor).toBe("inv-2");
  });

  it("segunda página con cursor retorna los items siguientes", async () => {
    const records = [makeInvoiceRecord({ id: "inv-3", invoiceNumber: "0000003" })];
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(records as never);

    const result = await ReceivableService.getReceivablesPaginated("company-1", AS_OF, "inv-2", 2);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "inv-2" },
        skip: 1,
      })
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0].invoiceId).toBe("inv-3");
    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("última página retorna hasNextPage=false y nextCursor=null", async () => {
    // limit=5, mock devuelve 2 (< limit+1) => última página
    const records = [
      makeInvoiceRecord({ id: "inv-1" }),
      makeInvoiceRecord({ id: "inv-2", invoiceNumber: "0000002" }),
    ];
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(records as never);

    const result = await ReceivableService.getReceivablesPaginated("company-1", AS_OF, undefined, 5);

    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.data).toHaveLength(2);
  });

  it("lista con 0 items retorna data=[], nextCursor=null, hasNextPage=false", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    const result = await ReceivableService.getReceivablesPaginated("company-1", AS_OF);

    expect(result.data).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
    expect(result.hasNextPage).toBe(false);
  });

  it("aplica cursor si se provee", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await ReceivableService.getReceivablesPaginated("company-1", AS_OF, "inv-5", 10);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "inv-5" },
        skip: 1,
      })
    );
  });

  it("serializa campos Decimal a string con 2 decimales", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([makeInvoiceRecord()] as never);

    const result = await ReceivableService.getReceivablesPaginated("company-1", AS_OF);

    const row = result.data[0];
    expect(row.totalAmountVes).toBe("1160.00");
    expect(row.pendingAmountVes).toBe("1160.00");
    expect(row.paidAmountVes).toBe("0.00");
  });

  it("ordena por dueDate asc (las más urgentes primero)", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await ReceivableService.getReceivablesPaginated("company-1", AS_OF);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      })
    );
  });
});

// ─── getPayablesPaginated ─────────────────────────────────────────────────────

describe("ReceivableService.getPayablesPaginated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna facturas de compra pendientes paginadas", async () => {
    const records = [makeInvoiceRecord({ id: "inv-p1" })];
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(records as never);

    const result = await ReceivableService.getPayablesPaginated("company-1", AS_OF);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].invoiceId).toBe("inv-p1");
  });

  it("verifica que la query usa type=PURCHASE", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await ReceivableService.getPayablesPaginated("company-1", AS_OF);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "company-1",
          type: "PURCHASE",
          deletedAt: null,
          paymentStatus: { not: "PAID" },
        }),
      })
    );
  });

  it("primera página sin cursor retorna nextCursor no nulo cuando hay más", async () => {
    // limit=2, take=3, mock devuelve 3 => hay más
    const records = Array.from({ length: 3 }, (_, i) =>
      makeInvoiceRecord({ id: `inv-p${i + 1}`, invoiceNumber: `P00000${i + 1}` })
    );
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(records as never);

    const result = await ReceivableService.getPayablesPaginated("company-1", AS_OF, undefined, 2);

    expect(result.hasNextPage).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.nextCursor).toBe("inv-p2");
  });

  it("segunda página con cursor retorna los items siguientes", async () => {
    const records = [makeInvoiceRecord({ id: "inv-p3", invoiceNumber: "P000003" })];
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(records as never);

    const result = await ReceivableService.getPayablesPaginated("company-1", AS_OF, "inv-p2", 2);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "inv-p2" },
        skip: 1,
      })
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0].invoiceId).toBe("inv-p3");
    expect(result.nextCursor).toBeNull();
  });

  it("última página retorna hasNextPage=false y nextCursor=null", async () => {
    const records = [makeInvoiceRecord({ id: "inv-1" }), makeInvoiceRecord({ id: "inv-2" })];
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(records as never);

    const result = await ReceivableService.getPayablesPaginated("company-1", AS_OF, undefined, 5);

    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.data).toHaveLength(2);
  });

  it("lista con 0 items retorna data=[], nextCursor=null, hasNextPage=false", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    const result = await ReceivableService.getPayablesPaginated("company-1", AS_OF);

    expect(result.data).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
    expect(result.hasNextPage).toBe(false);
  });

  it("aplica cursor si se provee", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await ReceivableService.getPayablesPaginated("company-1", AS_OF, "inv-10", 20);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "inv-10" },
        skip: 1,
      })
    );
  });
});
