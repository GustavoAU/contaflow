// @vitest-environment jsdom
// SPEC-008 RN-11: una fila de movimiento sin título padre llega como error de fila
// (`reason: "missing_parent"`) y el importador la muestra con el listado de errores existente.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AccountsImporter } from "./AccountsImporter";
import {
  importAccountsAction,
  parseAccountsFileAction,
} from "@/modules/import/actions/import.actions";
import type { ImportAccountRow } from "@/modules/import/schemas/import.schema";

vi.mock("@/modules/import/actions/import.actions", () => ({
  importAccountsAction: vi.fn(),
  parseAccountsFileAction: vi.fn(),
  downloadTemplateAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));

function row(codigo: string, nombre: string): ImportAccountRow {
  return {
    codigo,
    nombre,
    tipo: "ASSET",
    isPostable: true,
    isBudgetable: false,
    requiresThirdParty: false,
  };
}

describe("AccountsImporter — filas sin título padre (SPEC-008)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("explica en las instrucciones que la cuenta de movimiento necesita su título padre", () => {
    render(<AccountsImporter companyId="company-1" userId="user-1" />);
    expect(screen.getByText("título padre", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText(/Las filas sin título padre no se importan/)).toBeTruthy();
  });

  it("muestra el error de fila missing_parent y sigue informando lo que sí se importó", async () => {
    const orphan = row("1.1.09.01.001", "CAJA HUERFANA");
    vi.mocked(parseAccountsFileAction).mockResolvedValue({
      success: true,
      data: [row("1.1.01.01.001", "CAJA PRINCIPAL"), orphan],
    });
    vi.mocked(importAccountsAction).mockResolvedValue({
      success: true,
      data: {
        created: 1,
        skipped: 0,
        errors: [
          {
            message: "Fila 1.1.09.01.001: falta el título padre 1.1.09.01.",
            reason: "missing_parent",
            row: orphan,
          },
        ],
      },
    });

    const { container } = render(<AccountsImporter companyId="company-1" userId="user-1" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["codigo,nombre,tipo"], "plan.csv", { type: "text/csv" });
    fireEvent.change(input, { target: { files: [file] } });

    fireEvent.click(await screen.findByRole("button", { name: /importar 2 cuentas/i }));

    expect(
      await screen.findByText("Fila 1.1.09.01.001: falta el título padre 1.1.09.01.")
    ).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Errores:")).toBeTruthy());
    expect(screen.getByText(/cuentas creadas/).textContent).toContain("1");
  });
});
