// src/modules/orders/__tests__/QuotationService.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    orderNumberSequence: { upsert: vi.fn() },
    quotation: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    quotationItem: { deleteMany: vi.fn() },
  },
}));

import { QuotationService } from "../services/QuotationService";

const COMPANY_ID = "company-test";
const USER_ID = "user-test";

const ITEM_INPUT = {
  description: "Acetaminofén 500mg",
  unit: "caja",
  quantity: "100",
  unitPrice: "5.50",
  taxRate: "16",
};

function makeQuotationDb(overrides = {}) {
  return {
    id: "quot-1",
    type: "PURCHASE" as const,
    status: "DRAFT" as const,
    number: "COT-0001",
    counterpartName: "Proveedor S.A.",
    counterpartRif: "J-12345678-9",
    validUntil: new Date("2026-05-31"),
    notes: null,
    subtotal: { toString: () => "550" },
    taxAmount: { toString: () => "88" },
    total: { toString: () => "638" },
    currency: "VES",
    createdBy: USER_ID,
    createdAt: new Date("2026-04-14"),
    items: [
      {
        id: "item-1",
        description: "Acetaminofén 500mg",
        unit: "caja",
        quantity: { toString: () => "100" },
        unitPrice: { toString: () => "5.50" },
        taxRate: { toString: () => "16" },
        totalPrice: { toString: () => "638" },
      },
    ],
    ...overrides,
  };
}

describe("QuotationService.createQuotation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock $transaction to execute the callback with a fake tx
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn({
        orderNumberSequence: prisma.orderNumberSequence,
      })) as never
    );
    vi.mocked(prisma.orderNumberSequence.upsert).mockResolvedValue({
      lastNumber: 1,
    } as never);
    vi.mocked(prisma.quotation.create).mockResolvedValue(makeQuotationDb() as never);
  });

  it("crea una cotización PURCHASE y devuelve number COT-XXXX", async () => {
    const result = await QuotationService.createQuotation(COMPANY_ID, USER_ID, {
      type: "PURCHASE",
      counterpartName: "Proveedor S.A.",
      counterpartRif: "J-12345678-9",
      validUntil: new Date("2026-05-31"),
      items: [ITEM_INPUT],
    });

    expect(result.number).toBe("COT-0001");
    expect(result.type).toBe("PURCHASE");
    expect(result.status).toBe("DRAFT");
  });

  it("crea una cotización SALE con number PRE-XXXX", async () => {
    vi.mocked(prisma.quotation.create).mockResolvedValue(
      makeQuotationDb({ type: "SALE", number: "PRE-0001" }) as never
    );
    const result = await QuotationService.createQuotation(COMPANY_ID, USER_ID, {
      type: "SALE",
      counterpartName: "Cliente C.A.",
      validUntil: new Date("2026-05-31"),
      items: [ITEM_INPUT],
    });

    expect(result.number).toBe("PRE-0001");
    expect(result.type).toBe("SALE");
  });

  it("calcula totals correctamente — subtotal 550, iva 88, total 638", async () => {
    const result = await QuotationService.createQuotation(COMPANY_ID, USER_ID, {
      type: "PURCHASE",
      counterpartName: "Proveedor",
      validUntil: new Date("2026-05-31"),
      items: [ITEM_INPUT], // 100 × 5.50 = 550, IVA 16% = 88
    });

    expect(result.subtotal).toBe("550.00");
    expect(result.taxAmount).toBe("88.00");
    expect(result.total).toBe("638.00");
  });
});

describe("QuotationService — status transitions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submitForApproval: DRAFT → PENDING_APPROVAL", async () => {
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue(makeQuotationDb() as never);
    vi.mocked(prisma.quotation.update).mockResolvedValue({} as never);

    await QuotationService.submitForApproval(COMPANY_ID, "quot-1");

    expect(prisma.quotation.update).toHaveBeenCalledWith({
      where: { id: "quot-1" },
      data: { status: "PENDING_APPROVAL" },
    });
  });

  it("submitForApproval: lanza error si no está en DRAFT", async () => {
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue(
      makeQuotationDb({ status: "APPROVED" }) as never
    );

    await expect(
      QuotationService.submitForApproval(COMPANY_ID, "quot-1")
    ).rejects.toThrow("Solo se puede enviar a aprobación");
  });

  it("approveQuotation: PENDING_APPROVAL → APPROVED", async () => {
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue(
      makeQuotationDb({ status: "PENDING_APPROVAL" }) as never
    );
    vi.mocked(prisma.quotation.update).mockResolvedValue({} as never);

    await QuotationService.approveQuotation(COMPANY_ID, "quot-1");

    expect(prisma.quotation.update).toHaveBeenCalledWith({
      where: { id: "quot-1" },
      data: { status: "APPROVED" },
    });
  });

  it("approveQuotation: lanza error si no está PENDING_APPROVAL", async () => {
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue(
      makeQuotationDb({ status: "DRAFT" }) as never
    );

    await expect(
      QuotationService.approveQuotation(COMPANY_ID, "quot-1")
    ).rejects.toThrow("Solo se puede aprobar");
  });

  it("rejectQuotation: PENDING_APPROVAL → REJECTED", async () => {
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue(
      makeQuotationDb({ status: "PENDING_APPROVAL" }) as never
    );
    vi.mocked(prisma.quotation.update).mockResolvedValue({} as never);

    await QuotationService.rejectQuotation(COMPANY_ID, "quot-1");

    expect(prisma.quotation.update).toHaveBeenCalledWith({
      where: { id: "quot-1" },
      data: { status: "REJECTED" },
    });
  });

  it("getQuotation: devuelve null si no existe", async () => {
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue(null);
    const result = await QuotationService.getQuotation(COMPANY_ID, "nonexistent");
    expect(result).toBeNull();
  });

  it("getQuotations: devuelve lista serializada", async () => {
    vi.mocked(prisma.quotation.findMany).mockResolvedValue([makeQuotationDb()] as never);
    const results = await QuotationService.getQuotations(COMPANY_ID);
    expect(results).toHaveLength(1);
    expect(results[0]!.number).toBe("COT-0001");
    expect(results[0]!.total).toBe("638.00");
  });
});
