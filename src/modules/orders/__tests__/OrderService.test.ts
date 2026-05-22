// src/modules/orders/__tests__/OrderService.test.ts
// Tests: CRITICAL-1 (companyId guard) + CRITICAL-2 (status machine) + happy path

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    orderNumberSequence: { upsert: vi.fn() },
    quotation: { findFirst: vi.fn(), update: vi.fn() },
    order: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    invoice: { create: vi.fn() },
    invoiceTaxLine: { create: vi.fn() },
    invoiceLine: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    inventoryItem: { findMany: vi.fn() }, // OM-08
  },
}));

// Fase 37C: mock InvoiceLineService para aislar OrderService de sus dependencias
vi.mock("@/modules/invoices/services/InvoiceLineService", () => ({
  computeLineTotals: vi.fn().mockReturnValue([]),
  deriveInvoiceTaxLines: vi.fn().mockReturnValue([]),
  createInvoiceLinesInTx: vi.fn().mockResolvedValue(undefined),
}));

import { OrderService } from "../services/OrderService";
import { computeLineTotals, createInvoiceLinesInTx } from "@/modules/invoices/services/InvoiceLineService";

const COMPANY_ID = "company-test";
const USER_ID = "user-test";

const ITEM_INPUT = {
  description: "Acetaminofén",
  unit: "caja",
  quantity: "50",
  unitPrice: "5.50",
  taxRate: "16",
};

function makeOrderDb(overrides = {}) {
  return {
    id: "order-1",
    type: "PURCHASE" as const,
    status: "DRAFT" as const,
    number: "OC-0001",
    quotationId: null,
    counterpartName: "Proveedor S.A.",
    counterpartRif: null,
    expectedDate: null,
    notes: null,
    subtotal: { toString: () => "275" },
    taxAmount: { toString: () => "44" },
    total: { toString: () => "319" },
    currency: "VES",
    createdBy: USER_ID,
    createdAt: new Date("2026-04-14"),
    items: [
      {
        id: "oi-1",
        description: "Acetaminofén",
        unit: "caja",
        quantity: { toString: () => "50" },
        unitPrice: { toString: () => "5.50" },
        taxRate: { toString: () => "16" },
        totalPrice: { toString: () => "319" },
      },
    ],
    ...overrides,
  };
}

describe("OrderService.createOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn({ orderNumberSequence: prisma.orderNumberSequence })) as never
    );
    vi.mocked(prisma.orderNumberSequence.upsert).mockResolvedValue({ lastNumber: 1 } as never);
    vi.mocked(prisma.order.create).mockResolvedValue(makeOrderDb() as never);
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue(null);
  });

  it("crea una OC sin cotización origen", async () => {
    const result = await OrderService.createOrder(COMPANY_ID, USER_ID, {
      type: "PURCHASE",
      counterpartName: "Proveedor S.A.",
      items: [ITEM_INPUT],
    });
    expect(result.number).toBe("OC-0001");
    expect(result.type).toBe("PURCHASE");
    expect(result.status).toBe("DRAFT");
  });

  it("crea una OV con number OV-XXXX", async () => {
    vi.mocked(prisma.order.create).mockResolvedValue(
      makeOrderDb({ type: "SALE", number: "OV-0001" }) as never
    );
    const result = await OrderService.createOrder(COMPANY_ID, USER_ID, {
      type: "SALE",
      counterpartName: "Cliente C.A.",
      items: [ITEM_INPUT],
    });
    expect(result.number).toBe("OV-0001");
  });

  it("CRITICAL-1 (quotation IDOR): lanza error si quotationId no pertenece a companyId", async () => {
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue(null); // No encontrada → IDOR rejected

    await expect(
      OrderService.createOrder(COMPANY_ID, USER_ID, {
        type: "PURCHASE",
        quotationId: "foreign-quot-id",
        counterpartName: "Proveedor",
        items: [ITEM_INPUT],
      })
    ).rejects.toThrow("Cotización no encontrada");
  });

  it("lanza error si cotización origen no está APPROVED", async () => {
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue({
      id: "quot-1",
      status: "DRAFT",
    } as never);

    await expect(
      OrderService.createOrder(COMPANY_ID, USER_ID, {
        type: "PURCHASE",
        quotationId: "quot-1",
        counterpartName: "Proveedor",
        items: [ITEM_INPUT],
      })
    ).rejects.toThrow("cotización aprobada");
  });
});

describe("OrderService.approveOrder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("DRAFT → APPROVED", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(makeOrderDb() as never);
    vi.mocked(prisma.order.update).mockResolvedValue({} as never);

    await OrderService.approveOrder(COMPANY_ID, "order-1", "user-1");

    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { status: "APPROVED", approvedBy: "user-1", approvedAt: expect.any(Date) },
    });
  });

  it("CRITICAL-1: lanza error si orden no pertenece a companyId", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(null);

    await expect(OrderService.approveOrder(COMPANY_ID, "foreign-order", "user-1")).rejects.toThrow(
      "Orden no encontrada"
    );
  });

  it("lanza error si orden no está en DRAFT", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(
      makeOrderDb({ status: "CONVERTED" }) as never
    );

    await expect(OrderService.approveOrder(COMPANY_ID, "order-1", "user-1")).rejects.toThrow(
      "Solo se puede aprobar"
    );
  });
});

describe("OrderService.convertOrderToInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Full $transaction mock with tx helpers
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn({
        order: prisma.order,
        invoice: prisma.invoice,
        invoiceTaxLine: prisma.invoiceTaxLine,
        invoiceLine: prisma.invoiceLine,
        auditLog: prisma.auditLog,
      })) as never
    );
  });

  const INVOICE_DATA = {
    invoiceNumber: "F-0001",
    date: new Date("2026-04-14"),
  };

  it("CRITICAL-1: lanza error si orderId no pertenece a companyId", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(null);

    await expect(
      OrderService.convertOrderToInvoice(COMPANY_ID, "foreign-order", USER_ID, INVOICE_DATA)
    ).rejects.toThrow("Orden no encontrada");
  });

  it("CRITICAL-2: lanza error si orden no está APPROVED", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(
      makeOrderDb({ status: "DRAFT" }) as never
    );

    await expect(
      OrderService.convertOrderToInvoice(COMPANY_ID, "order-1", USER_ID, INVOICE_DATA)
    ).rejects.toThrow("Solo se puede convertir a factura una orden Aprobada");
  });

  it("convierte orden APPROVED → factura + AuditLog en misma $transaction", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(
      makeOrderDb({ status: "APPROVED" }) as never
    );
    vi.mocked(prisma.invoice.create).mockResolvedValue({ id: "inv-1" } as never);
    vi.mocked(prisma.order.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await OrderService.convertOrderToInvoice(
      COMPANY_ID,
      "order-1",
      USER_ID,
      INVOICE_DATA
    );

    expect(result.invoiceId).toBe("inv-1");
    // MEDIUM-1: AuditLog inside $transaction
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityName: "Order",
          action: "CONVERTED_TO_INVOICE",
          userId: USER_ID,
        }),
      })
    );
    // Order status updated to CONVERTED
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CONVERTED" } })
    );
  });

  it("factura hereda tipo PURCHASE de la orden", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(
      makeOrderDb({ status: "APPROVED", type: "PURCHASE" }) as never
    );
    vi.mocked(prisma.invoice.create).mockResolvedValue({ id: "inv-2" } as never);
    vi.mocked(prisma.order.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await OrderService.convertOrderToInvoice(COMPANY_ID, "order-1", USER_ID, INVOICE_DATA);

    expect(prisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "PURCHASE" }),
      })
    );
  });

  it("Fase 37C: llama createInvoiceLinesInTx con los parámetros correctos", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(
      makeOrderDb({ status: "APPROVED" }) as never
    );
    vi.mocked(prisma.invoice.create).mockResolvedValue({ id: "inv-1" } as never);
    vi.mocked(prisma.order.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await OrderService.convertOrderToInvoice(COMPANY_ID, "order-1", USER_ID, INVOICE_DATA);

    expect(createInvoiceLinesInTx).toHaveBeenCalledWith(
      "inv-1",
      COMPANY_ID,
      expect.any(Array),
      INVOICE_DATA.date,
      USER_ID,
      "WARN",
      expect.any(Object),
      expect.stringMatching(/PURCHASE|SALE/)  // OM-01: invoiceType
    );
  });

  it("Fase 37C: mapea taxRate de OrderItem a IvaLineRate correctamente", async () => {
    const orderWithItems = makeOrderDb({
      status: "APPROVED",
      items: [
        {
          id: "oi-1",
          description: "Producto GENERAL",
          unit: "und",
          quantity: { toString: () => "10" },
          unitPrice: { toString: () => "100" },
          taxRate: { toString: () => "16" },
          totalPrice: { toString: () => "1160" },
        },
        {
          id: "oi-2",
          description: "Producto EXENTO",
          unit: "und",
          quantity: { toString: () => "5" },
          unitPrice: { toString: () => "50" },
          taxRate: { toString: () => "0" },
          totalPrice: { toString: () => "250" },
        },
        {
          id: "oi-3",
          description: "Producto REDUCIDO",
          unit: "kg",
          quantity: { toString: () => "2" },
          unitPrice: { toString: () => "200" },
          taxRate: { toString: () => "8" },
          totalPrice: { toString: () => "432" },
        },
      ],
    });
    vi.mocked(prisma.order.findFirst).mockResolvedValue(orderWithItems as never);
    vi.mocked(prisma.invoice.create).mockResolvedValue({ id: "inv-2" } as never);
    vi.mocked(prisma.order.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await OrderService.convertOrderToInvoice(COMPANY_ID, "order-1", USER_ID, INVOICE_DATA);

    expect(computeLineTotals).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ ivaRate: "GENERAL_16", nameSnapshot: "Producto GENERAL", lineNumber: 1 }),
        expect.objectContaining({ ivaRate: "EXENTO",     nameSnapshot: "Producto EXENTO",  lineNumber: 2 }),
        expect.objectContaining({ ivaRate: "REDUCIDO_8", nameSnapshot: "Producto REDUCIDO", lineNumber: 3 }),
      ])
    );
  });

  it("getOrders retorna lista vacía si no hay órdenes", async () => {
    vi.mocked(prisma.order.findMany).mockResolvedValue([] as never);
    const result = await OrderService.getOrders(COMPANY_ID);
    expect(result).toHaveLength(0);
  });
});

describe("OrderService — OM-08: inventoryItemId validation en createOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn({ orderNumberSequence: prisma.orderNumberSequence })) as never
    );
    vi.mocked(prisma.orderNumberSequence.upsert).mockResolvedValue({ lastNumber: 1 } as never);
    vi.mocked(prisma.order.create).mockResolvedValue(makeOrderDb() as never);
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue(null);
  });

  it("omite validación si no hay inventoryItemId en los ítems", async () => {
    await OrderService.createOrder(COMPANY_ID, USER_ID, {
      type: "PURCHASE",
      counterpartName: "Proveedor",
      items: [ITEM_INPUT],
    });

    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
  });

  it("lanza error si inventoryItemId no pertenece a la empresa (cross-tenant guard)", async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as never); // 0 found ≠ 1 requested

    await expect(
      OrderService.createOrder(COMPANY_ID, USER_ID, {
        type: "PURCHASE",
        counterpartName: "Proveedor",
        items: [{ ...ITEM_INPUT, inventoryItemId: "item-otro-empresa" }],
      })
    ).rejects.toThrow("no pertenecen a esta empresa");
  });

  it("permite crear orden con inventoryItemId válido de la empresa", async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue(
      [{ id: "item-valid" }] as never
    );

    const result = await OrderService.createOrder(COMPANY_ID, USER_ID, {
      type: "PURCHASE",
      counterpartName: "Proveedor",
      items: [{ ...ITEM_INPUT, inventoryItemId: "item-valid" }],
    });

    expect(result.number).toBe("OC-0001");
    expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["item-valid"] },
          companyId: COMPANY_ID,
          deletedAt: null,
        }),
      })
    );
  });
});
