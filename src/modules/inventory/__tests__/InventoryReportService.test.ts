// src/modules/inventory/__tests__/InventoryReportService.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    inventoryItem: { findMany: vi.fn() },
    inventoryMovement: { findMany: vi.fn() },
  },
}));

import { InventoryReportService } from "../services/InventoryReportService";

const COMPANY_ID = "company-test";

// ─── getStockSummary ──────────────────────────────────────────────────────────

describe("InventoryReportService.getStockSummary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calcula totalValue y totalInventoryValue correctamente", async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      {
        id: "item-1",
        sku: "MED-001",
        name: "Acetaminofén",
        unit: "caja",
        stockQuantity: { toString: () => "100" },
        averageCost: { toString: () => "5.50" },
        minimumStock: null,
      },
      {
        id: "item-2",
        sku: "MED-002",
        name: "Ibuprofeno",
        unit: "caja",
        stockQuantity: { toString: () => "50" },
        averageCost: { toString: () => "8.00" },
        minimumStock: null,
      },
    ] as never);

    const result = await InventoryReportService.getStockSummary(COMPANY_ID);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.totalValue).toBe("550.00");   // 100 × 5.50
    expect(result.items[1]!.totalValue).toBe("400.00");   // 50 × 8.00
    expect(result.totalInventoryValue).toBe("950.00");
    expect(result.lowStockCount).toBe(0);
  });

  it("detecta bajo stock cuando stockQuantity <= minimumStock", async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      {
        id: "item-1",
        sku: "MED-001",
        name: "Acetaminofén",
        unit: "caja",
        stockQuantity: { toString: () => "5" },
        averageCost: { toString: () => "5.50" },
        minimumStock: { toString: () => "10" },
      },
    ] as never);

    const result = await InventoryReportService.getStockSummary(COMPANY_ID);

    expect(result.items[0]!.isLowStock).toBe(true);
    expect(result.lowStockCount).toBe(1);
  });

  it("no marca bajo stock cuando stockQuantity > minimumStock", async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      {
        id: "item-1",
        sku: "MED-001",
        name: "Acetaminofén",
        unit: "caja",
        stockQuantity: { toString: () => "20" },
        averageCost: { toString: () => "5.50" },
        minimumStock: { toString: () => "10" },
      },
    ] as never);

    const result = await InventoryReportService.getStockSummary(COMPANY_ID);

    expect(result.items[0]!.isLowStock).toBe(false);
    expect(result.lowStockCount).toBe(0);
  });

  it("no marca bajo stock cuando minimumStock es null", async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      {
        id: "item-1",
        sku: "MED-001",
        name: "Acetaminofén",
        unit: "caja",
        stockQuantity: { toString: () => "0" },
        averageCost: { toString: () => "5.50" },
        minimumStock: null,
      },
    ] as never);

    const result = await InventoryReportService.getStockSummary(COMPANY_ID);

    expect(result.items[0]!.isLowStock).toBe(false);
    expect(result.items[0]!.minimumStock).toBeNull();
    expect(result.lowStockCount).toBe(0);
  });

  it("retorna lista vacía si no hay ítems", async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as never);

    const result = await InventoryReportService.getStockSummary(COMPANY_ID);

    expect(result.items).toHaveLength(0);
    expect(result.totalInventoryValue).toBe("0.00");
    expect(result.lowStockCount).toBe(0);
  });

  it("marca bajo stock cuando stockQuantity === minimumStock (igual)", async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      {
        id: "item-1",
        sku: "MED-001",
        name: "Acetaminofén",
        unit: "caja",
        stockQuantity: { toString: () => "10" },
        averageCost: { toString: () => "5.00" },
        minimumStock: { toString: () => "10" },
      },
    ] as never);

    const result = await InventoryReportService.getStockSummary(COMPANY_ID);

    expect(result.items[0]!.isLowStock).toBe(true);
  });
});

// ─── getMovementReport ────────────────────────────────────────────────────────

describe("InventoryReportService.getMovementReport", () => {
  beforeEach(() => vi.clearAllMocks());

  const mockMovement = {
    id: "mov-1",
    date: new Date("2026-04-01T10:00:00Z"),
    type: "ENTRADA",
    status: "POSTED",
    quantity: { toString: () => "100" },
    unitCost: { toString: () => "5.50" },
    totalCost: { toString: () => "550" },
    reference: "OC-001",
    notes: null,
    invoiceId: null,
    item: { id: "item-1", sku: "MED-001", name: "Acetaminofén", unit: "caja" },
  };

  it("serializa movimientos correctamente", async () => {
    vi.mocked(prisma.inventoryMovement.findMany).mockResolvedValue([mockMovement] as never);

    const result = await InventoryReportService.getMovementReport(COMPANY_ID, {
      from: new Date("2026-04-01"),
      to: new Date("2026-04-30"),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe("2026-04-01");
    expect(result[0]!.type).toBe("ENTRADA");
    expect(result[0]!.totalCost).toBe("550.00");
    expect(result[0]!.itemSku).toBe("MED-001");
  });

  it("retorna array vacío si no hay movimientos", async () => {
    vi.mocked(prisma.inventoryMovement.findMany).mockResolvedValue([] as never);

    const result = await InventoryReportService.getMovementReport(COMPANY_ID, {
      from: new Date("2026-04-01"),
      to: new Date("2026-04-30"),
    });

    expect(result).toHaveLength(0);
  });

  it("pasa filtros opcionales a Prisma correctamente", async () => {
    vi.mocked(prisma.inventoryMovement.findMany).mockResolvedValue([] as never);

    await InventoryReportService.getMovementReport(COMPANY_ID, {
      from: new Date("2026-04-01"),
      to: new Date("2026-04-30"),
      type: "SALIDA",
      itemId: "item-1",
      status: "POSTED",
    });

    const call = vi.mocked(prisma.inventoryMovement.findMany).mock.calls[0]![0]!;
    expect(call.where).toMatchObject({ type: "SALIDA", itemId: "item-1", status: "POSTED" });
  });
});
