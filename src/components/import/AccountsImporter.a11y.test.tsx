// @vitest-environment jsdom
// a11y automática (SPEC-002 RN-6/CA-5): AccountsImporter (estado inicial, antes de subir archivo).
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { expectKnownA11yDebt } from "@/__tests__/a11y";
import { AccountsImporter } from "./AccountsImporter";

vi.mock("@/modules/import/actions/import.actions", () => ({
  importAccountsAction: vi.fn(),
  parseAccountsFileAction: vi.fn(),
  downloadTemplateAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));

describe("AccountsImporter — a11y", () => {
  // Posible falso positivo: el input file lleva `hidden` (Tailwind) y jsdom no carga estilos.
  // Confirmar en navegador real; si lo es, basta aria-label y se quita la marca.
  it("estado inicial: deuda de a11y conocida (label del input file; SPEC-003)", async () => {
    const { container } = render(<AccountsImporter companyId="company-1" userId="user-1" />);
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
    expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(1);
    await expectKnownA11yDebt(container, ["label"]);
  });
});
