// src/modules/invoices/services/InvoiceLineService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import {
  computeLineTotals,
  deriveInvoiceTaxLines,
  validateStockForLines,
  createInvoiceLinesInTx,
} from "./InvoiceLineService";
import type { InvoiceLineInput } from "../schemas/invoice.schema";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("@/modules/inventory/services/InventoryUomService", () => ({
  resolveQuantity: vi.fn().mockResolvedValue({
    quantityInBase: new Decimal("5"),
    conversionFactor: new Decimal("1"),
  }),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    inventoryItem: { findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
    inventoryMovement: { create: vi.fn() },
    invoiceLine: { create: vi.fn() },
  },
  prisma: {
    companySettings: { findUnique: vi.fn() },
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────
const makeLine = (overrides: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({
  inventoryItemId: undefined,
  nameSnapshot: "Producto A",
  skuSnapshot: "SKU-001",
  quantity: "5",
  unitPriceVes: "100",
  ivaRate: "GENERAL_16",
  lineNumber: 1,
  ...overrides,
});

// ─── computeLineTotals ────────────────────────────────────────────────────────
describe("computeLineTotals", () => {
  it("calcula subtotal, ivaAmount, total para GENERAL_16", () => {
    const lines = [makeLine({ quantity: "5", unitPriceVes: "100", ivaRate: "GENERAL_16" })];
    const computed = computeLineTotals(lines);

    expect(computed).toHaveLength(1);
    const c = computed[0];
    // subtotal = 5 × 100 = 500
    expect(c.subtotal.equals(new Decimal("500"))).toBe(true);
    // ivaAmount = 500 × 0.16 = 80
    expect(c.ivaAmount.equals(new Decimal("80"))).toBe(true);
    // total = 500 + 80 = 580
    expect(c.total.equals(new Decimal("580"))).toBe(true);
  });

  it("calcula ivaAmount = 0 para EXENTO", () => {
    const lines = [makeLine({ quantity: "2", unitPriceVes: "200", ivaRate: "EXENTO" })];
    const computed = computeLineTotals(lines);
    expect(computed[0].ivaAmount.equals(new Decimal("0"))).toBe(true);
    expect(computed[0].total.equals(new Decimal("400"))).toBe(true);
  });

  it("calcula ivaAmount para REDUCIDO_8", () => {
    const lines = [makeLine({ quantity: "10", unitPriceVes: "50", ivaRate: "REDUCIDO_8" })];
    const computed = computeLineTotals(lines);
    // subtotal = 500, iva = 500 * 0.08 = 40
    expect(computed[0].ivaAmount.equals(new Decimal("40"))).toBe(true);
  });

  it("calcula total correcto para ADICIONAL_31 (usa tasa 0.31)", () => {
    const lines = [makeLine({ quantity: "1", unitPriceVes: "1000", ivaRate: "ADICIONAL_31" })];
    const computed = computeLineTotals(lines);
    // ivaAmount = 1000 × 0.31 = 310
    expect(computed[0].ivaAmount.equals(new Decimal("310"))).toBe(true);
    expect(computed[0].total.equals(new Decimal("1310"))).toBe(true);
    // luxuryGroupId debe existir para ADICIONAL_31
    expect(computed[0].luxuryGroupId).toBeTruthy();
  });
});

// ─── deriveInvoiceTaxLines ────────────────────────────────────────────────────
describe("deriveInvoiceTaxLines", () => {
  it("agrupa dos líneas GENERAL_16 en un solo InvoiceTaxLine", () => {
    const lines = [
      makeLine({ quantity: "5", unitPriceVes: "100", ivaRate: "GENERAL_16", lineNumber: 1 }),
      makeLine({ quantity: "2", unitPriceVes: "200", ivaRate: "GENERAL_16", lineNumber: 2 }),
    ];
    const computed = computeLineTotals(lines);
    const taxLines = deriveInvoiceTaxLines(computed);

    expect(taxLines).toHaveLength(1);
    expect(taxLines[0].taxType).toBe("IVA_GENERAL");
    // base = 500 + 400 = 900
    expect(taxLines[0].base.equals(new Decimal("900"))).toBe(true);
    // amount = 900 * 0.16 = 144
    expect(taxLines[0].amount.equals(new Decimal("144"))).toBe(true);
  });

  it("genera dos InvoiceTaxLine para ADICIONAL_31 (IVA_GENERAL + IVA_ADICIONAL)", () => {
    const lines = [makeLine({ quantity: "1", unitPriceVes: "1000", ivaRate: "ADICIONAL_31" })];
    const computed = computeLineTotals(lines);
    const taxLines = deriveInvoiceTaxLines(computed);

    expect(taxLines).toHaveLength(2);
    const general = taxLines.find((tl) => tl.taxType === "IVA_GENERAL");
    const additional = taxLines.find((tl) => tl.taxType === "IVA_ADICIONAL");

    expect(general).toBeDefined();
    expect(additional).toBeDefined();
    // base igual para ambos — misma base, no base+IVA general (CLAUDE.md Z-2)
    expect(general!.base.equals(new Decimal("1000"))).toBe(true);
    expect(additional!.base.equals(new Decimal("1000"))).toBe(true);
    // IVA_GENERAL = 1000 * 0.16 = 160
    expect(general!.amount.equals(new Decimal("160"))).toBe(true);
    // IVA_ADICIONAL = 1000 * 0.15 = 150
    expect(additional!.amount.equals(new Decimal("150"))).toBe(true);
    // Ambos comparten luxuryGroupId
    expect(general!.luxuryGroupId).toBe(additional!.luxuryGroupId);
  });

  it("genera taxLine EXENTO con base correcta y amount = 0", () => {
    const lines = [makeLine({ quantity: "3", unitPriceVes: "50", ivaRate: "EXENTO" })];
    const computed = computeLineTotals(lines);
    const taxLines = deriveInvoiceTaxLines(computed);

    expect(taxLines).toHaveLength(1);
    expect(taxLines[0].taxType).toBe("EXENTO");
    expect(taxLines[0].base.equals(new Decimal("150"))).toBe(true);
    expect(taxLines[0].amount.equals(new Decimal("0"))).toBe(true);
  });

  it("mezcla múltiples alícuotas correctamente", () => {
    const lines = [
      makeLine({ quantity: "1", unitPriceVes: "100", ivaRate: "GENERAL_16", lineNumber: 1 }),
      makeLine({ quantity: "1", unitPriceVes: "200", ivaRate: "REDUCIDO_8", lineNumber: 2 }),
      makeLine({ quantity: "1", unitPriceVes: "50", ivaRate: "EXENTO", lineNumber: 3 }),
    ];
    const computed = computeLineTotals(lines);
    const taxLines = deriveInvoiceTaxLines(computed);

    expect(taxLines).toHaveLength(3);
    expect(taxLines.map((tl) => tl.taxType).sort()).toEqual(
      ["EXENTO", "IVA_GENERAL", "IVA_REDUCIDO"].sort()
    );
  });
});

// ─── validateStockForLines ────────────────────────────────────────────────────
describe("validateStockForLines", () => {
  const makeTxMock = (stockQuantity: string) =>
    ({
      inventoryItem: {
        findMany: vi.fn().mockResolvedValue([{
          id: "item-1",
          stockQuantity: new Decimal(stockQuantity),
          name: "Producto A",
          baseUnitId: "unit-1",
          sku: "SKU-001",
        }]),
      },
    }) as unknown as Parameters<typeof validateStockForLines>[4];

  it("retorna ok cuando hay stock suficiente — WARN", async () => {
    const line = makeLine({ inventoryItemId: "item-1", quantity: "3" });
    const txMock = makeTxMock("10"); // 10 disponible, pide 3

    const result = await validateStockForLines([line], "company-1", "WARN", false, txMock);
    expect(result.ok).toBe(true);
  });

  it("WARN continúa con stock negativo (no lanza error)", async () => {
    const line = makeLine({ inventoryItemId: "item-1", quantity: "20" });
    const txMock = makeTxMock("5"); // solo 5 disponible, pide 20

    const result = await validateStockForLines([line], "company-1", "WARN", false, txMock);
    expect(result.ok).toBe(true);
  });

  it("BLOCK lanza error si stock insuficiente", async () => {
    const line = makeLine({ inventoryItemId: "item-1", quantity: "20" });
    const txMock = makeTxMock("5");

    await expect(
      validateStockForLines([line], "company-1", "BLOCK", false, txMock)
    ).rejects.toThrow("Stock insuficiente");
  });

  it("BLOCK no lanza error si stock suficiente", async () => {
    const line = makeLine({ inventoryItemId: "item-1", quantity: "3" });
    const txMock = makeTxMock("10");

    const result = await validateStockForLines([line], "company-1", "BLOCK", false, txMock);
    expect(result.ok).toBe(true);
  });

  it("CONFIRM lanza error STOCK_CONFIRM_REQUIRED si stock insuficiente y sin flag", async () => {
    const line = makeLine({ inventoryItemId: "item-1", quantity: "20" });
    const txMock = makeTxMock("5");

    await expect(
      validateStockForLines([line], "company-1", "CONFIRM", false, txMock)
    ).rejects.toThrow("STOCK_CONFIRM_REQUIRED");
  });

  it("CONFIRM permite con stock insuficiente si stockConfirmed = true", async () => {
    const line = makeLine({ inventoryItemId: "item-1", quantity: "20" });
    const txMock = makeTxMock("5");

    const result = await validateStockForLines([line], "company-1", "CONFIRM", true, txMock);
    expect(result.ok).toBe(true);
  });

  it("lanza error IDOR si el item no pertenece a la empresa", async () => {
    const line = makeLine({ inventoryItemId: "item-externo", quantity: "1" });
    const txMock = {
      inventoryItem: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as Parameters<typeof validateStockForLines>[4];

    await expect(
      validateStockForLines([line], "company-1", "WARN", false, txMock)
    ).rejects.toThrow("no pertenece a esta empresa");
  });

  it("retorna ok si no hay líneas con inventoryItemId (servicios puros)", async () => {
    const line = makeLine({ inventoryItemId: undefined });
    const txMock = makeTxMock("0");

    const result = await validateStockForLines([line], "company-1", "BLOCK", false, txMock);
    expect(result.ok).toBe(true);
  });
});

// ─── createInvoiceLinesInTx ───────────────────────────────────────────────────
describe("createInvoiceLinesInTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("crea InvoiceLine sin movimiento de inventario para servicio (sin inventoryItemId)", async () => {
    const computed = computeLineTotals([
      makeLine({ quantity: "1", unitPriceVes: "500", ivaRate: "GENERAL_16", lineNumber: 1 }),
    ]);

    const invoiceLineCreate = vi.fn().mockResolvedValue({ id: "line-1" });
    const inventoryMovementCreate = vi.fn();
    const txMock = {
      $executeRaw: vi.fn(),
      inventoryItem: { findFirstOrThrow: vi.fn() },
      inventoryMovement: { create: inventoryMovementCreate },
      invoiceLine: { create: invoiceLineCreate },
    } as never;

    await createInvoiceLinesInTx(
      "invoice-1",
      "company-1",
      computed,
      new Date("2026-05-06"),
      "user-1",
      "WARN",
      txMock
    );

    // InvoiceLine creada
    expect(invoiceLineCreate).toHaveBeenCalledTimes(1);
    // Sin movimiento de inventario (no hay inventoryItemId)
    expect(inventoryMovementCreate).not.toHaveBeenCalled();
  });

  it("crea InvoiceLine + InventoryMovement DRAFT para ítem con inventario", async () => {
    const computed = computeLineTotals([
      makeLine({
        inventoryItemId: "item-1",
        quantity: "5",
        unitPriceVes: "100",
        ivaRate: "GENERAL_16",
        lineNumber: 1,
      }),
    ]);

    const movCreate = vi.fn().mockResolvedValue({ id: "mov-1" });
    const lineCreate = vi.fn().mockResolvedValue({ id: "line-1" });
    const txMock = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      inventoryItem: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          averageCost: new Decimal("50"),
          sku: "SKU-001",
          name: "Producto A",
          baseUnitId: "unit-1",
        }),
      },
      inventoryMovement: { create: movCreate },
      invoiceLine: { create: lineCreate },
    } as never;

    await createInvoiceLinesInTx(
      "invoice-1",
      "company-1",
      computed,
      new Date("2026-05-06"),
      "user-1",
      "WARN",
      txMock
    );

    // Movimiento de inventario creado con tipo SALIDA
    expect(movCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "SALIDA",
          status: "DRAFT",
          invoiceId: "invoice-1",
        }),
      })
    );

    // InvoiceLine creada con inventoryMovementId
    expect(lineCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceId: "invoice-1",
          inventoryItemId: "item-1",
          inventoryMovementId: "mov-1",
        }),
      })
    );
  });

  it("llama SELECT FOR UPDATE en path CONFIRM", async () => {
    const computed = computeLineTotals([
      makeLine({
        inventoryItemId: "item-1",
        quantity: "2",
        unitPriceVes: "100",
        lineNumber: 1,
      }),
    ]);

    const executeRaw = vi.fn().mockResolvedValue(undefined);
    const txMock = {
      $executeRaw: executeRaw,
      inventoryItem: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          averageCost: new Decimal("20"),
          sku: "SKU",
          name: "Item",
          baseUnitId: null,
        }),
      },
      inventoryMovement: { create: vi.fn().mockResolvedValue({ id: "mov-1" }) },
      invoiceLine: { create: vi.fn().mockResolvedValue({ id: "line-1" }) },
    } as never;

    await createInvoiceLinesInTx(
      "invoice-1",
      "company-1",
      computed,
      new Date("2026-05-06"),
      "user-1",
      "CONFIRM", // debe llamar SELECT FOR UPDATE
      txMock
    );

    expect(executeRaw).toHaveBeenCalled();
  });

  // ── OM-01: PURCHASE → ENTRADA ────────────────────────────────────────────────

  it("OM-01: crea movimiento ENTRADA para factura de COMPRA", async () => {
    const computed = computeLineTotals([
      makeLine({
        inventoryItemId: "item-1",
        quantity: "10",
        unitPriceVes: "200",
        ivaRate: "GENERAL_16",
        lineNumber: 1,
      }),
    ]);

    const movCreate = vi.fn().mockResolvedValue({ id: "mov-1" });
    const lineCreate = vi.fn().mockResolvedValue({ id: "line-1" });
    const txMock = {
      $executeRaw: vi.fn(),
      inventoryItem: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          averageCost: new Decimal("150"),
          sku: "SKU-001",
          name: "Producto A",
          baseUnitId: null,
        }),
      },
      inventoryMovement: { create: movCreate },
      invoiceLine: { create: lineCreate },
    } as never;

    await createInvoiceLinesInTx(
      "invoice-1",
      "company-1",
      computed,
      new Date("2026-05-06"),
      "user-1",
      "WARN",
      txMock,
      "PURCHASE"  // OM-01
    );

    // Movimiento debe ser ENTRADA
    expect(movCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "ENTRADA",
          status: "DRAFT",
        }),
      })
    );

    // unitCost debe ser el precio de la factura (200), no el CPP (150)
    const callData = movCreate.mock.calls[0]?.[0]?.data;
    expect(callData?.unitCost.toString()).toBe("200");
  });

  it("OM-01: COMPRA no llama SELECT FOR UPDATE (agrega stock, no lo reduce)", async () => {
    const computed = computeLineTotals([
      makeLine({ inventoryItemId: "item-1", quantity: "5", unitPriceVes: "100", lineNumber: 1 }),
    ]);

    const executeRaw = vi.fn();
    const txMock = {
      $executeRaw: executeRaw,
      inventoryItem: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          averageCost: new Decimal("80"),
          sku: "SKU",
          name: "Item",
          baseUnitId: null,
        }),
      },
      inventoryMovement: { create: vi.fn().mockResolvedValue({ id: "mov-1" }) },
      invoiceLine: { create: vi.fn().mockResolvedValue({ id: "line-1" }) },
    } as never;

    await createInvoiceLinesInTx(
      "invoice-1", "company-1", computed, new Date("2026-05-06"), "user-1",
      "WARN", txMock, "PURCHASE"
    );

    // No debe llamar SELECT FOR UPDATE para ENTRADA
    expect(executeRaw).not.toHaveBeenCalled();
  });
});
