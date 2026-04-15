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
    auditLog: { create: vi.fn() },
  },
}));

import { OrderService } from "../services/OrderService";

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

    await OrderService.approveOrder(COMPANY_ID, "order-1");

    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { status: "APPROVED" },
    });
  });

  it("CRITICAL-1: lanza error si orden no pertenece a companyId", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(null);

    await expect(OrderService.approveOrder(COMPANY_ID, "foreign-order")).rejects.toThrow(
      "Orden no encontrada"
    );
  });

  it("lanza error si orden no está en DRAFT", async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(
      makeOrderDb({ status: "CONVERTED" }) as never
    );

    await expect(OrderService.approveOrder(COMPANY_ID, "order-1")).rejects.toThrow(
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

  it("getOrders retorna lista vacía si no hay órdenes", async () => {
    vi.mocked(prisma.order.findMany).mockResolvedValue([] as never);
    const result = await OrderService.getOrders(COMPANY_ID);
    expect(result).toHaveLength(0);
  });
});
