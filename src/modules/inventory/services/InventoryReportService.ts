// src/modules/inventory/services/InventoryReportService.ts
// Reportes de inventario: existencias actuales y movimientos por rango de fechas.
// Solo lectura — no muta datos.

import prisma from "@/lib/prisma";
import Decimal from "decimal.js";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type StockSummaryItem = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  stockQuantity: string;
  averageCost: string;
  totalValue: string;       // stockQuantity × averageCost
  minimumStock: string | null;
  isLowStock: boolean;      // stockQuantity <= minimumStock (si minimumStock != null)
};

export type StockSummary = {
  items: StockSummaryItem[];
  totalInventoryValue: string;
  lowStockCount: number;
};

export type MovementReportItem = {
  id: string;
  date: string;             // ISO date "YYYY-MM-DD"
  type: string;             // "ENTRADA" | "SALIDA" | "AJUSTE"
  status: string;           // "DRAFT" | "POSTED"
  itemId: string;
  itemSku: string;
  itemName: string;
  unit: string;
  quantity: string;
  unitCost: string;
  totalCost: string;
  reference: string | null;
  notes: string | null;
  invoiceId: string | null;
};

export type MovementReportFilters = {
  from: Date;
  to: Date;
  type?: string;
  itemId?: string;
  status?: string;
};

// ─── Service ──────────────────────────────────────────────────────────────────

export class InventoryReportService {
  /**
   * Resumen de existencias actuales con valoración CPP.
   * Incluye flag isLowStock para items bajo el umbral configurado.
   */
  static async getStockSummary(companyId: string): Promise<StockSummary> {
    const items = await prisma.inventoryItem.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true,
        sku: true,
        name: true,
        baseUnitName: true,
        stockQuantity: true,
        averageCost: true,
        minimumStock: true,
      },
      orderBy: { sku: "asc" },
    });

    let totalValue = new Decimal(0);
    let lowStockCount = 0;

    const summaryItems: StockSummaryItem[] = items.map((item) => {
      const qty = new Decimal(item.stockQuantity.toString());
      const cost = new Decimal(item.averageCost.toString());
      const value = qty.times(cost);
      totalValue = totalValue.plus(value);

      const minStock = item.minimumStock
        ? new Decimal(item.minimumStock.toString())
        : null;
      const isLowStock = minStock !== null && qty.lte(minStock);
      if (isLowStock) lowStockCount++;

      return {
        id: item.id,
        sku: item.sku,
        name: item.name,
        unit: item.baseUnitName,
        stockQuantity: qty.toFixed(4),
        averageCost: cost.toFixed(4),
        totalValue: value.toFixed(2),
        minimumStock: minStock ? minStock.toFixed(4) : null,
        isLowStock,
      };
    });

    return {
      items: summaryItems,
      totalInventoryValue: totalValue.toFixed(2),
      lowStockCount,
    };
  }

  /**
   * Movimientos en un rango de fechas, opcionalmente filtrados por tipo, ítem y estado.
   */
  static async getMovementReport(
    companyId: string,
    filters: MovementReportFilters
  ): Promise<MovementReportItem[]> {
    const { from, to, type, itemId, status } = filters;

    // Extender `to` al final del día
    const toEndOfDay = new Date(to);
    toEndOfDay.setHours(23, 59, 59, 999);

    const movements = await prisma.inventoryMovement.findMany({
      where: {
        companyId,
        date: { gte: from, lte: toEndOfDay },
        ...(type ? { type: type as never } : {}),
        ...(itemId ? { itemId } : {}),
        ...(status ? { status: status as never } : {}),
      },
      select: {
        id: true,
        date: true,
        type: true,
        status: true,
        quantity: true,
        unitCost: true,
        totalCost: true,
        reference: true,
        notes: true,
        invoiceId: true,
        item: {
          select: { id: true, sku: true, name: true, baseUnitName: true },
        },
      },
      orderBy: { date: "desc" },
    });

    return movements.map((m) => ({
      id: m.id,
      date: m.date.toISOString().slice(0, 10),
      type: m.type,
      status: m.status,
      itemId: m.item.id,
      itemSku: m.item.sku,
      itemName: m.item.name,
      unit: m.item.baseUnitName,
      quantity: new Decimal(m.quantity.toString()).toFixed(4),
      unitCost: new Decimal(m.unitCost.toString()).toFixed(4),
      totalCost: new Decimal(m.totalCost.toString()).toFixed(2),
      reference: m.reference,
      notes: m.notes,
      invoiceId: m.invoiceId,
    }));
  }
}
