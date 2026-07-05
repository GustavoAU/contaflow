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
    auditLog: { create: vi.fn() },
    inventoryItem: { findMany: vi.fn() }, // OM-08
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
    // Mock $transaction to execute the callback with a fake tx (secuencia + create+audit)
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn({
        orderNumberSequence: prisma.orderNumberSequence,
        quotation: prisma.quotation,
        auditLog: prisma.auditLog,
      })) as never
    );
    vi.mocked(prisma.orderNumberSequence.upsert).mockResolvedValue({
      lastNumber: 1,
    } as never);
    vi.mocked(prisma.quotation.create).mockResolvedValue(makeQuotationDb() as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("AUD-01: escribe AuditLog Quotation/CREATE en la misma $transaction", async () => {
    await QuotationService.createQuotation(
      COMPANY_ID,
      USER_ID,
      {
        type: "PURCHASE",
        counterpartName: "Proveedor S.A.",
        validUntil: new Date("2026-05-31"),
        items: [ITEM_INPUT],
      },
      "10.0.0.1",
      "vitest-ua"
    );

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityName: "Quotation",
          action: "CREATE",
          userId: USER_ID,
          ipAddress: "10.0.0.1",
          userAgent: "vitest-ua",
        }),
      })
    );
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
  beforeEach(() => {
    vi.clearAllMocks();
    // AUD-01: submit/approve/reject ahora envuelven update + auditLog en $transaction
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn({
        quotation: prisma.quotation,
        auditLog: prisma.auditLog,
      })) as never
    );
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("submitForApproval: DRAFT → PENDING_APPROVAL", async () => {
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue(makeQuotationDb() as never);
    vi.mocked(prisma.quotation.update).mockResolvedValue({} as never);

    await QuotationService.submitForApproval(COMPANY_ID, "quot-1", USER_ID);

    expect(prisma.quotation.update).toHaveBeenCalledWith({
      where: { id: "quot-1" },
      data: { status: "PENDING_APPROVAL" },
    });
    // AUD-01: rastro de auditoría
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entityName: "Quotation", action: "SUBMIT" }),
      })
    );
  });

  it("submitForApproval: lanza error si no está en DRAFT", async () => {
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue(
      makeQuotationDb({ status: "APPROVED" }) as never
    );

    await expect(
      QuotationService.submitForApproval(COMPANY_ID, "quot-1", USER_ID)
    ).rejects.toThrow("Solo se puede enviar a aprobación");
  });

  it("approveQuotation: PENDING_APPROVAL → APPROVED", async () => {
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue(
      makeQuotationDb({ status: "PENDING_APPROVAL" }) as never
    );
    vi.mocked(prisma.quotation.update).mockResolvedValue({} as never);

    await QuotationService.approveQuotation(COMPANY_ID, "quot-1", "user-1");

    expect(prisma.quotation.update).toHaveBeenCalledWith({
      where: { id: "quot-1" },
      data: { status: "APPROVED", approvedBy: "user-1", approvedAt: expect.any(Date) },
    });
  });

  it("approveQuotation: lanza error si no está PENDING_APPROVAL", async () => {
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue(
      makeQuotationDb({ status: "DRAFT" }) as never
    );

    await expect(
      QuotationService.approveQuotation(COMPANY_ID, "quot-1", "user-1")
    ).rejects.toThrow("Solo se puede aprobar");
  });

  it("rejectQuotation: PENDING_APPROVAL → REJECTED", async () => {
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue(
      makeQuotationDb({ status: "PENDING_APPROVAL" }) as never
    );
    vi.mocked(prisma.quotation.update).mockResolvedValue({} as never);

    await QuotationService.rejectQuotation(COMPANY_ID, "quot-1", USER_ID);

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

describe("QuotationService.updateQuotation — $transaction + AuditLog (MEDIUM)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue(makeQuotationDb() as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          quotationItem: prisma.quotationItem,
          quotation: prisma.quotation,
          auditLog: prisma.auditLog,
        })) as never,
    );
    vi.mocked(prisma.quotation.update).mockResolvedValue(makeQuotationDb() as never);
    vi.mocked(prisma.quotationItem.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("lanza error si la cotización no existe", async () => {
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue(null as never);

    await expect(
      QuotationService.updateQuotation(COMPANY_ID, "nonexistent", USER_ID, {}),
    ).rejects.toThrow("Cotización no encontrada");
  });

  it("lanza error si la cotización no está en DRAFT", async () => {
    vi.mocked(prisma.quotation.findFirst).mockResolvedValue(
      makeQuotationDb({ status: "APPROVED" }) as never,
    );

    await expect(
      QuotationService.updateQuotation(COMPANY_ID, "quot-1", USER_ID, { counterpartName: "Nuevo" }),
    ).rejects.toThrow("Solo se puede editar");
  });

  it("ejecuta deleteMany + update + auditLog dentro de $transaction", async () => {
    await QuotationService.updateQuotation(COMPANY_ID, "quot-1", USER_ID, {
      items: [ITEM_INPUT],
      counterpartName: "Proveedor Nuevo",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.quotationItem.deleteMany).toHaveBeenCalledWith({
      where: { quotationId: "quot-1" },
    });
    expect(prisma.quotation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "quot-1" } }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: COMPANY_ID,
          entityId: "quot-1",
          entityName: "Quotation",
          action: "UPDATE",
          userId: USER_ID,
        }),
      }),
    );
  });

  it("NO llama deleteMany si no hay items en el input", async () => {
    await QuotationService.updateQuotation(COMPANY_ID, "quot-1", USER_ID, {
      counterpartName: "Solo nombre",
    });

    expect(prisma.quotationItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

describe("QuotationService — OM-08: inventoryItemId validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn({
        orderNumberSequence: prisma.orderNumberSequence,
        quotation: prisma.quotation,
        auditLog: prisma.auditLog,
      })) as never
    );
    vi.mocked(prisma.orderNumberSequence.upsert).mockResolvedValue({ lastNumber: 1 } as never);
    vi.mocked(prisma.quotation.create).mockResolvedValue(makeQuotationDb() as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("omite validación si no hay inventoryItemId en los ítems", async () => {
    // ITEM_INPUT no tiene inventoryItemId → no se llama inventoryItem.findMany
    await QuotationService.createQuotation(COMPANY_ID, USER_ID, {
      type: "PURCHASE",
      counterpartName: "Proveedor",
      validUntil: new Date("2026-05-31"),
      items: [ITEM_INPUT],
    });

    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
  });

  it("lanza error si inventoryItemId no pertenece a la empresa (OM-08 cross-tenant guard)", async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as never); // 0 found ≠ 1 requested

    await expect(
      QuotationService.createQuotation(COMPANY_ID, USER_ID, {
        type: "PURCHASE",
        counterpartName: "Proveedor",
        validUntil: new Date("2026-05-31"),
        items: [{ ...ITEM_INPUT, inventoryItemId: "item-otro-empresa" }],
      })
    ).rejects.toThrow("no pertenecen a esta empresa");
  });

  it("permite crear cotización con inventoryItemId válido de la empresa", async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue(
      [{ id: "item-valid" }] as never
    );

    const result = await QuotationService.createQuotation(COMPANY_ID, USER_ID, {
      type: "PURCHASE",
      counterpartName: "Proveedor",
      validUntil: new Date("2026-05-31"),
      items: [{ ...ITEM_INPUT, inventoryItemId: "item-valid" }],
    });

    expect(result.number).toBe("COT-0001");
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
