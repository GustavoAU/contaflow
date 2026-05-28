// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InventoryReportsView } from "../InventoryReportsView";
import type { StockSummary } from "../../services/InventoryReportService";

vi.mock("../../actions/inventory-reports.actions", () => ({
  getStockSummaryAction: vi.fn(),
  getMovementReportAction: vi.fn(),
  getRotationReportAction: vi.fn(),
}));

vi.mock("../TopProductsChart", () => ({
  TopProductsChart: () => null,
}));

const EMPTY_STOCK: StockSummary = {
  items: [],
  totalInventoryValue: "0",
  lowStockCount: 0,
};

describe("InventoryReportsView — StockTab CPP banner (ALERTA 11)", () => {
  it("muestra el banner de política contable CPP", () => {
    render(
      <InventoryReportsView
        companyId="company-1"
        initialStock={EMPTY_STOCK}
        itemOptions={[]}
      />
    );

    expect(screen.getByText(/Costo Promedio Ponderado/i)).toBeTruthy();
    expect(screen.getByText(/NIIF para PYMES/i)).toBeTruthy();
    expect(screen.queryByText(/Política contable/i)).toBeTruthy();
  });

  it("muestra el resumen de stock con total de inventario", () => {
    const stockWithItems: StockSummary = {
      items: [
        {
          id: "item-1",
          sku: "PROD-001",
          name: "Producto Test",
          unit: "unidad",
          stockQuantity: "10",
          minimumStock: "2",
          averageCost: "50.00",
          totalValue: "500.00",
          isLowStock: false,
        },
      ],
      totalInventoryValue: "500",
      lowStockCount: 0,
    };

    render(
      <InventoryReportsView
        companyId="company-1"
        initialStock={stockWithItems}
        itemOptions={[]}
      />
    );

    expect(screen.getByText("Producto Test")).toBeTruthy();
    expect(screen.getByText("PROD-001")).toBeTruthy();
  });

  it("muestra indicador de bajo stock cuando lowStockCount > 0", () => {
    const lowStockData: StockSummary = {
      items: [],
      totalInventoryValue: "0",
      lowStockCount: 3,
    };

    render(
      <InventoryReportsView
        companyId="company-1"
        initialStock={lowStockData}
        itemOptions={[]}
      />
    );

    expect(screen.getByText("3")).toBeTruthy();
  });

  it("muestra 'Sin productos registrados' cuando el inventario está vacío", () => {
    render(
      <InventoryReportsView
        companyId="company-1"
        initialStock={EMPTY_STOCK}
        itemOptions={[]}
      />
    );

    expect(screen.getByText(/Sin productos registrados/i)).toBeTruthy();
  });
});
