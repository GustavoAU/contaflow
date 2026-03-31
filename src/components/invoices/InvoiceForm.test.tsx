// @vitest-environment jsdom
// src/components/invoices/InvoiceForm.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InvoiceForm } from "./InvoiceForm";

vi.mock("@/modules/invoices/actions/invoice.actions", () => ({
  createInvoiceAction: vi.fn(),
}));

vi.mock("@/modules/exchange-rates/actions/exchange-rate.actions", () => ({
  getLatestRateAction: vi.fn().mockResolvedValue({ success: false, error: "Sin tasa BCV registrada" }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

vi.mock("@/components/ui/sonner", () => ({
  Toaster: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
  buttonVariants: () => "",
}));

import { createInvoiceAction } from "@/modules/invoices/actions/invoice.actions";

const BASE_PROPS = {
  companyId: "company-1",
  userId: "user-1",
  isSpecialContributor: false,
};

describe("InvoiceForm — tipo Compra/Venta", () => {
  beforeEach(() => vi.clearAllMocks());

  it("muestra Compra por defecto", () => {
    render(<InvoiceForm {...BASE_PROPS} />);
    const compraBtn = screen.getByRole("button", { name: "Compra" });
    expect(compraBtn.className).toContain("bg-blue-600");
  });

  it("muestra Proveedor en Compra y Cliente en Venta", async () => {
    render(<InvoiceForm {...BASE_PROPS} />);
    expect(
      screen.getByPlaceholderText("Razón Social").closest("div")?.querySelector("label")
        ?.textContent
    ).toContain("Proveedor");

    fireEvent.click(screen.getByRole("button", { name: "Venta" }));
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Razón Social").closest("div")?.querySelector("label")
          ?.textContent
      ).toContain("Cliente");
    });
  });
});

describe("InvoiceForm — desglose de impuestos", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inicia con una línea IVA General (16%)", () => {
    render(<InvoiceForm {...BASE_PROPS} />);
    expect(screen.getByDisplayValue("IVA General (16%)")).toBeTruthy();
  });

  it("tasa siempre es readOnly", () => {
    render(<InvoiceForm {...BASE_PROPS} />);
    const tasaInput = screen.getByDisplayValue("16%");
    expect(tasaInput).toHaveProperty("readOnly", true);
  });

  it("agrega una línea al hacer click en + Agregar línea", async () => {
    render(<InvoiceForm {...BASE_PROPS} />);
    fireEvent.click(screen.getByText("+ Agregar línea"));
    await waitFor(() => {
      expect(screen.getAllByDisplayValue("IVA General (16%)")).toHaveLength(2);
    });
  });

  it("calcula monto IVA automáticamente al ingresar base", async () => {
    render(<InvoiceForm {...BASE_PROPS} />);
    const baseInput = screen.getByPlaceholderText("0.00");
    fireEvent.change(baseInput, { target: { value: "1000" } });
    await waitFor(() => {
      // El input ahora muestra el monto formateado con símbolo de moneda (VES por defecto)
      const amountInputs = screen.getAllByRole("textbox");
      const amountInput = amountInputs.find((el) => (el as HTMLInputElement).value.includes("160"));
      expect(amountInput).toBeTruthy();
    });
  });

  it("seleccionar IVA Lujo crea par automático con IVA General", async () => {
    render(<InvoiceForm {...BASE_PROPS} />);
    const taxSelect = screen.getByDisplayValue("IVA General (16%)");
    fireEvent.change(taxSelect, { target: { value: "IVA_ADICIONAL" } });
    await waitFor(() => {
      expect(screen.getByDisplayValue("IVA Lujo (15% Adicional)")).toBeTruthy();
      expect(screen.getByDisplayValue("IVA General (16%)")).toBeTruthy();
    });
  });
});

describe("InvoiceForm — validación pre-submit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("al cambiar a EXENTA muestra AlertDialog y al confirmar resetea taxLines a EXENTO", async () => {
    render(<InvoiceForm {...BASE_PROPS} />);

    // Cambiar categoría a Exenta — dispara AlertDialog
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[1], { target: { value: "EXENTA" } });

    // AlertDialog debe estar visible
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeTruthy();
    });

    // Confirmar el cambio
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cambio" }));

    // Después de confirmar, taxLines se resetea a Exento/Exonerado
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(screen.getByDisplayValue("Exento / Exonerado")).toBeTruthy();
    });
  });

  it("al cambiar a EXENTA y cancelar, taxCategory permanece sin cambiar", async () => {
    render(<InvoiceForm {...BASE_PROPS} />);

    // Cambiar categoría a Exenta — dispara AlertDialog
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[1], { target: { value: "EXENTA" } });

    // AlertDialog debe estar visible
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeTruthy();
    });

    // Cancelar
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    // Después de cancelar, taxCategory permanece como GRAVADA y línea IVA_GENERAL sigue
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(screen.getByDisplayValue("IVA General (16%)")).toBeTruthy();
    });
  });

  it("bloquea submit si categoría GRAVADA y no hay base imponible", async () => {
    const { toast } = await import("sonner");
    render(<InvoiceForm {...BASE_PROPS} />);

    fireEvent.change(screen.getByPlaceholderText("0000001"), { target: { value: "F002" } });
    fireEvent.change(screen.getByPlaceholderText("00-0000001"), {
      target: { value: "00-0000001" },
    });
    fireEvent.change(screen.getByPlaceholderText("Razón Social"), {
      target: { value: "Proveedor" },
    });
    fireEvent.change(screen.getByPlaceholderText("J-12345678-9"), {
      target: { value: "J-12345678-9" },
    });
    const dateInput = document.querySelector('input[name="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-03-01" } });

    fireEvent.submit(screen.getByRole("button", { name: "Registrar Factura" }).closest("form")!);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("base imponible mayor a cero")
      );
    });
  });
});

describe("InvoiceForm — submit exitoso", () => {
  beforeEach(() => vi.clearAllMocks());

  it("llama createInvoiceAction con los datos correctos", async () => {
    vi.mocked(createInvoiceAction).mockResolvedValue({ success: true } as never);
    render(<InvoiceForm {...BASE_PROPS} />);

    fireEvent.change(screen.getByPlaceholderText("0000001"), { target: { value: "F003" } });
    fireEvent.change(screen.getByPlaceholderText("00-0000001"), {
      target: { value: "00-0000001" },
    });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1000" } });
    fireEvent.change(screen.getByPlaceholderText("Razón Social"), {
      target: { value: "Proveedor Test" },
    });
    fireEvent.change(screen.getByPlaceholderText("J-12345678-9"), {
      target: { value: "J-12345678-9" },
    });
    const dateInput = document.querySelector('input[name="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-03-01" } });

    fireEvent.submit(screen.getByRole("button", { name: "Registrar Factura" }).closest("form")!);

    await waitFor(() => {
      expect(createInvoiceAction).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "company-1",
          type: "PURCHASE",
          createdBy: "user-1",
        })
      );
    });
  });
});