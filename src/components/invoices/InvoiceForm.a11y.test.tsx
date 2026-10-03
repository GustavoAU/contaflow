// @vitest-environment jsdom
// a11y automática (SPEC-002 RN-6/CA-5): InvoiceForm sin violaciones serious/critical.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expectKnownA11yDebt, expectNoSeriousA11yViolations } from "@/__tests__/a11y";
import { InvoiceForm } from "./InvoiceForm";

vi.mock("@/modules/invoices/actions/invoice.actions", () => ({ createInvoiceAction: vi.fn() }));
vi.mock("@/modules/exchange-rates/actions/exchange-rate.actions", () => ({
  getLatestRateAction: vi.fn().mockResolvedValue({ success: false, error: "Sin tasa BCV registrada" }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));

const PROPS = { companyId: "company-1", userId: "user-1", isSpecialContributor: false };

describe("InvoiceForm — a11y", () => {
  it("estado inicial: deuda de a11y conocida (label de 6 inputs + select-name de 4 selects; SPEC-003)", async () => {
    const { container } = render(<InvoiceForm {...PROPS} />);
    // Guarda anti falso verde: el formulario realmente se renderizó
    expect(container.querySelectorAll("input").length).toBeGreaterThanOrEqual(5);
    expect(container.querySelectorAll("label").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByRole("button", { name: "Compra" })).toBeTruthy();
    await expectKnownA11yDebt(container, ["label", "select-name"]);
  });

  it("diálogo de confirmación (categoría Exenta) abierto sin violaciones", async () => {
    render(<InvoiceForm {...PROPS} />);
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "EXENTA" } });
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
    await expectNoSeriousA11yViolations(document.body);
  });
});
