// @vitest-environment jsdom

// src/components/igtf/IGTFForm.test.tsx

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IGTFForm } from "./IGTFForm";

vi.mock("@/modules/igtf/actions/igtf.actions", () => ({
  createIGTFAction: vi.fn(),
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
}));

import { createIGTFAction } from "@/modules/igtf/actions/igtf.actions";

const BASE_PROPS = {
  companyId: "company-1",
  userId: "user-1",
};

describe("IGTFForm — preview condicional", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("muestra preview para USD sin CE", async () => {
    render(<IGTFForm {...BASE_PROPS} isSpecialContributor={false} />);

    fireEvent.change(screen.getByPlaceholderText("1000.00"), {
      target: { value: "1000" },
    });

    await waitFor(() => {
      expect(screen.getByText(/Vista previa/i)).toBeTruthy();
      expect(screen.getByText("1030.00")).toBeTruthy();
    });
  });

  it("muestra preview para EUR sin CE", async () => {
    render(<IGTFForm {...BASE_PROPS} isSpecialContributor={false} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "EUR" } });
    fireEvent.change(screen.getByPlaceholderText("1000.00"), { target: { value: "500" } });

    await waitFor(() => {
      expect(screen.getByText(/Vista previa/i)).toBeTruthy();
    });
  });

  it("NO muestra preview para VES sin CE", async () => {
    render(<IGTFForm {...BASE_PROPS} isSpecialContributor={false} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "VES" } });
    fireEvent.change(screen.getByPlaceholderText("1000.00"), { target: { value: "1000" } });

    await waitFor(() => {
      expect(screen.queryByText(/Vista previa/i)).toBeNull();
      expect(screen.getByText(/IGTF no aplica/i)).toBeTruthy();
    });
  });

  it("muestra preview para VES con CE", async () => {
    render(<IGTFForm {...BASE_PROPS} isSpecialContributor={true} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "VES" } });
    fireEvent.change(screen.getByPlaceholderText("1000.00"), { target: { value: "1000" } });

    await waitFor(() => {
      expect(screen.getByText(/Vista previa/i)).toBeTruthy();
      expect(screen.getByText("1030.00")).toBeTruthy();
    });
  });

  it("no muestra preview si monto es 0", async () => {
    render(<IGTFForm {...BASE_PROPS} isSpecialContributor={false} />);

    fireEvent.change(screen.getByPlaceholderText("1000.00"), { target: { value: "0" } });

    expect(screen.queryByText(/Vista previa/i)).toBeNull();
  });
});

describe("IGTFForm — submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("llama createIGTFAction con los datos correctos", async () => {
    vi.mocked(createIGTFAction).mockResolvedValue({ success: true } as never);

    render(<IGTFForm {...BASE_PROPS} isSpecialContributor={false} />);

    fireEvent.change(screen.getByPlaceholderText("Pago a proveedor en divisas"), {
      target: { value: "Pago proveedor" },
    });
    fireEvent.change(screen.getByPlaceholderText("1000.00"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: /Registrar IGTF/i }));

    await waitFor(() => {
      expect(createIGTFAction).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "company-1",
          amount: "500",
          currency: "USD",
          createdBy: "user-1",
        })
      );
    });
  });

  it("muestra toast.error si la action falla", async () => {
    vi.mocked(createIGTFAction).mockResolvedValue({
      success: false,
      error: "Error al registrar",
    } as never);

    const { toast } = await import("sonner");

    render(<IGTFForm {...BASE_PROPS} isSpecialContributor={false} />);

    fireEvent.change(screen.getByPlaceholderText("Pago a proveedor en divisas"), {
      target: { value: "Pago test" },
    });
    fireEvent.change(screen.getByPlaceholderText("1000.00"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /Registrar IGTF/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Error al registrar");
    });
  });
});
