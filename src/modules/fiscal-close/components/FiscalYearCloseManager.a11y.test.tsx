// @vitest-environment jsdom
// a11y automática (SPEC-002 RN-6/CA-5): FiscalYearCloseManager + diálogos de cierre y apropiación.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expectNoSeriousA11yViolations } from "@/__tests__/a11y";
import { FiscalYearCloseManager } from "./FiscalYearCloseManager";

vi.mock("../actions/fiscal-close.actions", () => ({
  closeFiscalYearAction: vi.fn(),
  appropriateFiscalYearResultAction: vi.fn(),
}));
vi.mock("@clerk/nextjs", () => ({ useReverification: (fn: unknown) => fn }));
vi.mock("@clerk/nextjs/errors", () => ({ isReverificationCancelledError: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const HISTORY = [
  {
    id: "c1",
    year: 2024,
    closedAt: new Date("2025-01-15"),
    closedBy: "u",
    totalRevenue: "1000.00",
    totalExpenses: "400.00",
    netResult: "600.00",
    hasAppropriation: false,
  },
];

describe("FiscalYearCloseManager — a11y", () => {
  it("estado inicial (con historial) sin violaciones", async () => {
    const { container } = render(
      <FiscalYearCloseManager companyId="company-1" yearToClose={2025} isConfigured history={HISTORY as never} />,
    );
    expect(screen.getByRole("button", { name: "Cerrar Ejercicio 2025" })).toBeTruthy();
    expect(container.querySelectorAll("table tbody tr").length).toBe(1);
    await expectNoSeriousA11yViolations(container);
  });

  it("diálogo de confirmación de cierre de ejercicio abierto sin violaciones", async () => {
    render(<FiscalYearCloseManager companyId="company-1" yearToClose={2025} isConfigured history={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar Ejercicio 2025" }));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
    expect(screen.getByRole("button", { name: /Sí, cerrar ejercicio 2025/ })).toBeTruthy();
    await expectNoSeriousA11yViolations(document.body);
  });

  it("diálogo de apropiación abierto sin violaciones", async () => {
    render(
      <FiscalYearCloseManager companyId="company-1" yearToClose={2025} isConfigured history={HISTORY as never} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
    await expectNoSeriousA11yViolations(document.body);
  });
});
