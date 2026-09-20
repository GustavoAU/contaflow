// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InvoiceBookSummaryPanel } from "./InvoiceBookSummaryPanel";
import type { InvoiceBookResult, InvoiceBookSummary } from "@/modules/invoices/services/InvoiceService";

const zero: InvoiceBookSummary = {
  totalBaseGeneral: "0.00",
  totalIvaGeneral: "0.00",
  totalBaseReduced: "0.00",
  totalIvaReduced: "0.00",
  totalBaseAdditional: "0.00",
  totalIvaAdditional: "0.00",
  totalExempt: "0.00",
  totalIvaRetention: "0.00",
  totalIslrRetention: "0.00",
  totalIgtf: "0.00",
  totalBase: "0.00",
  totalIva: "0.00",
  totalAmount: "0.00",
};

const wrap = (summary: Partial<InvoiceBookSummary>): InvoiceBookResult => ({
  rows: [],
  summary: { ...zero, ...summary },
});

describe("InvoiceBookSummaryPanel — filas por alícuota", () => {
  it("oculta las filas opcionales cuando el neto es cero", () => {
    render(<InvoiceBookSummaryPanel result={wrap({})} type="PURCHASE" />);

    expect(screen.queryByText(/Reducido/)).toBeNull();
    expect(screen.queryByText(/Lujo/)).toBeNull();
    expect(screen.queryByText(/exentas/)).toBeNull();
    expect(screen.queryByText(/IVA Retenido/)).toBeNull();
    expect(screen.queryByText(/ISLR Retenido/)).toBeNull();
  });

  it("muestra la fila cuando el neto es NEGATIVO (NC del período superan a las facturas)", () => {
    render(
      <InvoiceBookSummaryPanel
        result={wrap({
          totalBaseReduced: "-100.00",
          totalIvaReduced: "-8.00",
          totalExempt: "-50.00",
          totalIvaRetention: "-6.00",
          totalIslrRetention: "-1.00",
        })}
        type="PURCHASE"
      />
    );

    expect(screen.getByText(/Reducido/)).toBeTruthy();
    expect(screen.getByText(/exentas/)).toBeTruthy();
    expect(screen.getByText(/IVA Retenido/)).toBeTruthy();
    expect(screen.getByText(/ISLR Retenido/)).toBeTruthy();
  });

  it("ventas: el IGTF neto negativo también se muestra", () => {
    render(<InvoiceBookSummaryPanel result={wrap({ totalIgtf: "-3.48" })} type="SALE" />);

    expect(screen.getByText(/IGTF/)).toBeTruthy();
  });
});
