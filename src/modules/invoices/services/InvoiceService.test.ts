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
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    company: {
      findUnique: vi.fn(),
    },
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
  currency: "VES",
  exchangeRateId: null,
  taxLines: [makeTaxLine("IVA_GENERAL", "1000.00", "16", "160.00")],
  createdAt: new Date("2026-03-01"),
  ...overrides,
});

// Fila reducida para paginación (sin taxLines, con campos de cartera)
const makePaginatedRow = (overrides: Record<string, unknown> = {}) => ({
  id: "inv-1",
  date: new Date("2026-03-01"),
  invoiceNumber: "0000001",
  controlNumber: "00-0000001",
  docType: "FACTURA",
  taxCategory: "GRAVADA",
  type: "SALE",
  counterpartName: "Cliente Demo C.A.",
  counterpartRif: "J-12345678-9",
  currency: "VES",
  totalAmountVes: new Decimal("1160.00"),
  pendingAmount: new Decimal("1160.00"),
  paymentStatus: "UNPAID",
  ivaRetentionAmount: new Decimal("0"),
  islrRetentionAmount: new Decimal("0"),
  igtfAmount: new Decimal("0"),
  dueDate: new Date("2026-03-31"),
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
  currency: "VES" as const,
  transactionId: undefined,
  periodId: undefined,
  createdBy: "user-1",
};

describe("InvoiceService.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fase 16: mock para paymentTermDays
    vi.mocked(prisma.company.findUnique).mockResolvedValue({ paymentTermDays: 30 } as never);
  });

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

  it("crea taxLines dinámicamente", async () => {
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
    vi.mocked(prisma.company.findUnique).mockResolvedValue({ paymentTermDays: 30 } as never);

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

  it("retorna rows y summary vacíos cuando no hay facturas", async () => {
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

describe("InvoiceService.getInvoicesPaginated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("primera página retorna hasta 50 facturas", async () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      makePaginatedRow({ id: `inv-${i + 1}`, invoiceNumber: `000000${i + 1}` })
    );
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(rows as never);

    const result = await InvoiceService.getInvoicesPaginated("company-1");

    expect(result.data).toHaveLength(3);
    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("aplica filtros de tipo y fecha", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    const filters = {
      type: "SALE" as const,
      dateFrom: new Date("2026-01-01"),
      dateTo: new Date("2026-03-31"),
    };
    await InvoiceService.getInvoicesPaginated("company-1", filters);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "company-1",
          type: "SALE",
          date: { gte: new Date("2026-01-01"), lte: new Date("2026-03-31") },
        }),
      })
    );
  });

  it("retorna hasNextPage=true cuando hay más", async () => {
    // limit=2, se piden take=3, mock devuelve 3 => hay más
    const rows = Array.from({ length: 3 }, (_, i) =>
      makePaginatedRow({ id: `inv-${i + 1}` })
    );
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(rows as never);

    const result = await InvoiceService.getInvoicesPaginated("company-1", {}, undefined, 2);

    expect(result.hasNextPage).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.nextCursor).toBe("inv-2");
  });

  it("segunda página con cursor retorna items siguientes", async () => {
    const rows = [makePaginatedRow({ id: "inv-3" })];
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(rows as never);

    const result = await InvoiceService.getInvoicesPaginated("company-1", {}, "inv-2", 2);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "inv-2" },
        skip: 1,
      })
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("inv-3");
  });

  it("última página retorna hasNextPage=false y nextCursor=null", async () => {
    // limit=5, mock devuelve 2 (< limit+1) => última página
    const rows = [
      makePaginatedRow({ id: "inv-1" }),
      makePaginatedRow({ id: "inv-2", invoiceNumber: "0000002" }),
    ];
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(rows as never);

    const result = await InvoiceService.getInvoicesPaginated("company-1", {}, undefined, 5);

    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.data).toHaveLength(2);
  });

  it("aplica filtro de search en OR de invoiceNumber, counterpartName, counterpartRif", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await InvoiceService.getInvoicesPaginated("company-1", { search: "Demo" });

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { invoiceNumber: { contains: "Demo" } },
            { counterpartName: { contains: "Demo" } },
            { counterpartRif: { contains: "Demo" } },
          ],
        }),
      })
    );
  });

  it("serializa campos Decimal como string con 2 decimales", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([makePaginatedRow()] as never);

    const result = await InvoiceService.getInvoicesPaginated("company-1");

    const row = result.data[0];
    expect(row.totalAmountVes).toBe("1160.00");
    expect(row.pendingAmount).toBe("1160.00");
    expect(row.ivaRetentionAmount).toBe("0.00");
  });
});

// ─── getInvoiceBookPaginated ──────────────────────────────────────────────────

describe("InvoiceService.getInvoiceBookPaginated", () => {
  beforeEach(() => vi.clearAllMocks());

  const BASE_PARAMS = {
    companyId: "company-1",
    periodId: "period-1",
    invoiceType: "SALE" as const,
  };

  it("primera página sin cursor retorna hasta 50 items y nextCursor no nulo si hay más", async () => {
    // limit=2, take=3, mock devuelve 3 => hay siguiente página
    const items = Array.from({ length: 3 }, (_, i) =>
      makeInvoiceRow({ id: `inv-${i + 1}`, invoiceNumber: `000000${i + 1}` })
    );
    vi.mocked(prisma.invoice.count).mockResolvedValue(10 as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(items as never);

    const result = await InvoiceService.getInvoiceBookPaginated({ ...BASE_PARAMS, limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe("inv-2");
    expect(result.total).toBe(10);
  });

  it("segunda página con cursor retorna los items siguientes", async () => {
    const items = [makeInvoiceRow({ id: "inv-3" })];
    vi.mocked(prisma.invoice.count).mockResolvedValue(3 as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(items as never);

    const result = await InvoiceService.getInvoiceBookPaginated({
      ...BASE_PARAMS,
      cursor: "inv-2",
      limit: 2,
    });

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "inv-2" },
        skip: 1,
      })
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("inv-3");
    expect(result.nextCursor).toBeNull();
  });

  it("última página retorna nextCursor null", async () => {
    // limit=5, mock devuelve 2 (< limit+1) => última página
    const items = [
      makeInvoiceRow({ id: "inv-1" }),
      makeInvoiceRow({ id: "inv-2", invoiceNumber: "0000002" }),
    ];
    vi.mocked(prisma.invoice.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(items as never);

    const result = await InvoiceService.getInvoiceBookPaginated({ ...BASE_PARAMS, limit: 5 });

    expect(result.nextCursor).toBeNull();
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it("lista con 0 items retorna items=[], nextCursor=null, total=0", async () => {
    vi.mocked(prisma.invoice.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    const result = await InvoiceService.getInvoiceBookPaginated(BASE_PARAMS);

    expect(result.items).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
    expect(result.total).toBe(0);
  });

  it("filtra por companyId, periodId e invoiceType (ADR-004)", async () => {
    vi.mocked(prisma.invoice.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await InvoiceService.getInvoiceBookPaginated({
      companyId: "company-X",
      periodId: "period-Y",
      invoiceType: "PURCHASE",
    });

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "company-X",
          periodId: "period-Y",
          type: "PURCHASE",
          deletedAt: null,
        }),
      })
    );
    expect(prisma.invoice.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "company-X",
          periodId: "period-Y",
        }),
      })
    );
  });

  it("limita a 50 aunque se pida un limit mayor", async () => {
    vi.mocked(prisma.invoice.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await InvoiceService.getInvoiceBookPaginated({ ...BASE_PARAMS, limit: 200 });

    // take debe ser min(200, 50) + 1 = 51
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 51 })
    );
  });

  it("serializa taxLines a string con 2 decimales en items", async () => {
    vi.mocked(prisma.invoice.count).mockResolvedValue(1 as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([makeInvoiceRow()] as never);

    const result = await InvoiceService.getInvoiceBookPaginated(BASE_PARAMS);

    expect(result.items[0].taxLines[0].base).toBe("1000.00");
    expect(result.items[0].taxLines[0].amount).toBe("160.00");
    expect(result.items[0].ivaRetentionAmount).toBe("0.00");
  });
});
