import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { computeLineTotals, deriveInvoiceTaxLines, validateStockForLines } from "../services/InvoiceLineService";
import type { InvoiceLineInput } from "../schemas/invoice.schema";

// ─── computeLineTotals ────────────────────────────────────────────────────────

describe("computeLineTotals", () => {
  const base: InvoiceLineInput = {
    lineNumber: 1,
    nameSnapshot: "Producto A",
    quantity: "2",
    unitPriceVes: "100.00",
    ivaRate: "GENERAL_16",
  };

  it("calcula subtotal, IVA y total para GENERAL_16", () => {
    const [c] = computeLineTotals([base]);
    expect(c.subtotal.toFixed(2)).toBe("200.00");
    expect(c.ivaAmount.toFixed(2)).toBe("32.00");
    expect(c.total.toFixed(2)).toBe("232.00");
  });

  it("calcula EXENTO con ivaAmount = 0", () => {
    const [c] = computeLineTotals([{ ...base, ivaRate: "EXENTO" }]);
    expect(c.ivaAmount.toFixed(2)).toBe("0.00");
    expect(c.total.toFixed(2)).toBe("200.00");
  });

  it("calcula REDUCIDO_8 correctamente", () => {
    const [c] = computeLineTotals([{ ...base, ivaRate: "REDUCIDO_8" }]);
    expect(c.ivaAmount.toFixed(2)).toBe("16.00");
  });

  it("asigna luxuryGroupId a líneas ADICIONAL_31", () => {
    const [c] = computeLineTotals([{ ...base, ivaRate: "ADICIONAL_31" }]);
    expect(c.luxuryGroupId).toMatch(/^luxury-0-/);
  });

  it("no asigna luxuryGroupId a líneas no-lujo", () => {
    const [c] = computeLineTotals([base]);
    expect(c.luxuryGroupId).toBeUndefined();
  });
});

// ─── deriveInvoiceTaxLines ────────────────────────────────────────────────────

describe("deriveInvoiceTaxLines", () => {
  it("agrupa dos líneas GENERAL_16 en un solo IVA_GENERAL", () => {
    const computed = computeLineTotals([
      { lineNumber: 1, nameSnapshot: "A", quantity: "1", unitPriceVes: "100", ivaRate: "GENERAL_16" },
      { lineNumber: 2, nameSnapshot: "B", quantity: "1", unitPriceVes: "200", ivaRate: "GENERAL_16" },
    ]);
    const taxLines = deriveInvoiceTaxLines(computed);
    expect(taxLines).toHaveLength(1);
    expect(taxLines[0].taxType).toBe("IVA_GENERAL");
    expect(taxLines[0].base.toFixed(2)).toBe("300.00");
  });

  it("línea ADICIONAL_31 produce IVA_GENERAL (16%) + IVA_ADICIONAL (15%)", () => {
    const computed = computeLineTotals([
      { lineNumber: 1, nameSnapshot: "Lujo", quantity: "1", unitPriceVes: "1000", ivaRate: "ADICIONAL_31" },
    ]);
    const taxLines = deriveInvoiceTaxLines(computed);
    expect(taxLines).toHaveLength(2);
    const general = taxLines.find((t) => t.taxType === "IVA_GENERAL");
    const adicional = taxLines.find((t) => t.taxType === "IVA_ADICIONAL");
    expect(general?.rate.toFixed(0)).toBe("16");
    expect(adicional?.rate.toFixed(0)).toBe("15");
  });

  it("línea EXENTO produce taxLine tipo EXENTO con amount = 0", () => {
    const computed = computeLineTotals([
      { lineNumber: 1, nameSnapshot: "Servicio", quantity: "1", unitPriceVes: "500", ivaRate: "EXENTO" },
    ]);
    const taxLines = deriveInvoiceTaxLines(computed);
    expect(taxLines[0].taxType).toBe("EXENTO");
    expect(taxLines[0].amount.toFixed(2)).toBe("0.00");
  });
});

// ─── validateStockForLines — WARN mode (ALERTA 10) ───────────────────────────

describe("validateStockForLines — WARN mode", () => {
  const mockTx = {
    inventoryItem: {
      findFirst: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna ok:true con warnings cuando hay stock insuficiente en modo WARN", async () => {
    mockTx.inventoryItem.findFirst.mockResolvedValue({
      id: "item-1",
      stockQuantity: new Decimal("1"),
      name: "Laptop",
      baseUnitId: "unit-1",
      sku: "LAP-001",
    });

    const lines: InvoiceLineInput[] = [
      { lineNumber: 1, nameSnapshot: "Laptop", inventoryItemId: "item-1", quantity: "5", unitPriceVes: "100", ivaRate: "GENERAL_16" },
    ];

    const result = await validateStockForLines(lines, "company-1", "WARN", false, mockTx as never);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0].itemId).toBe("item-1");
      expect(result.warnings![0].name).toBe("Laptop");
    }
  });

  it("retorna ok:true con warnings vacíos cuando hay stock suficiente en modo WARN", async () => {
    mockTx.inventoryItem.findFirst.mockResolvedValue({
      id: "item-1",
      stockQuantity: new Decimal("10"),
      name: "Mouse",
      baseUnitId: "unit-1",
      sku: "MOU-001",
    });

    const lines: InvoiceLineInput[] = [
      { lineNumber: 1, nameSnapshot: "Mouse", inventoryItemId: "item-1", quantity: "2", unitPriceVes: "50", ivaRate: "GENERAL_16" },
    ];

    const result = await validateStockForLines(lines, "company-1", "WARN", false, mockTx as never);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toBeUndefined();
    }
  });

  it("retorna ok:true sin warnings si no hay líneas con inventoryItemId", async () => {
    const lines: InvoiceLineInput[] = [
      { lineNumber: 1, nameSnapshot: "Servicio", quantity: "1", unitPriceVes: "100", ivaRate: "GENERAL_16" },
    ];

    const result = await validateStockForLines(lines, "company-1", "WARN", false, mockTx as never);

    expect(result.ok).toBe(true);
    expect(mockTx.inventoryItem.findFirst).not.toHaveBeenCalled();
  });

  it("lanza error en modo BLOCK con stock insuficiente", async () => {
    mockTx.inventoryItem.findFirst.mockResolvedValue({
      id: "item-2",
      stockQuantity: new Decimal("0"),
      name: "Teclado",
      baseUnitId: "unit-1",
      sku: "KEY-001",
    });

    const lines: InvoiceLineInput[] = [
      { lineNumber: 1, nameSnapshot: "Teclado", inventoryItemId: "item-2", quantity: "1", unitPriceVes: "80", ivaRate: "GENERAL_16" },
    ];

    await expect(
      validateStockForLines(lines, "company-1", "BLOCK", false, mockTx as never)
    ).rejects.toThrow("Stock insuficiente");
  });

  it("lanza STOCK_CONFIRM_REQUIRED en modo CONFIRM sin confirmación", async () => {
    mockTx.inventoryItem.findFirst.mockResolvedValue({
      id: "item-3",
      stockQuantity: new Decimal("0"),
      name: "Monitor",
      baseUnitId: "unit-1",
      sku: "MON-001",
    });

    const lines: InvoiceLineInput[] = [
      { lineNumber: 1, nameSnapshot: "Monitor", inventoryItemId: "item-3", quantity: "1", unitPriceVes: "200", ivaRate: "GENERAL_16" },
    ];

    await expect(
      validateStockForLines(lines, "company-1", "CONFIRM", false, mockTx as never)
    ).rejects.toThrow("STOCK_CONFIRM_REQUIRED");
  });

  it("retorna ok:true en modo CONFIRM con stockConfirmed=true aunque haya insuficiente", async () => {
    mockTx.inventoryItem.findFirst.mockResolvedValue({
      id: "item-4",
      stockQuantity: new Decimal("0"),
      name: "Impresora",
      baseUnitId: "unit-1",
      sku: "IMP-001",
    });

    const lines: InvoiceLineInput[] = [
      { lineNumber: 1, nameSnapshot: "Impresora", inventoryItemId: "item-4", quantity: "1", unitPriceVes: "300", ivaRate: "GENERAL_16" },
    ];

    const result = await validateStockForLines(lines, "company-1", "CONFIRM", true, mockTx as never);

    expect(result.ok).toBe(true);
  });

  it("lanza error si el ítem no pertenece a la empresa", async () => {
    mockTx.inventoryItem.findFirst.mockResolvedValue(null);

    const lines: InvoiceLineInput[] = [
      { lineNumber: 1, nameSnapshot: "X", inventoryItemId: "item-99", quantity: "1", unitPriceVes: "100", ivaRate: "GENERAL_16" },
    ];

    await expect(
      validateStockForLines(lines, "company-1", "WARN", false, mockTx as never)
    ).rejects.toThrow("no encontrado");
  });
});
