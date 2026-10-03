// @vitest-environment jsdom
// a11y automática (SPEC-002 RN-6/CA-5): PeriodManager (ejercicios fiscales) + diálogo "Abrir primer ejercicio".
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expectKnownA11yDebt, expectNoSeriousA11yViolations } from "@/__tests__/a11y";
import { PeriodManager } from "./PeriodManager";

vi.mock("@/modules/accounting/actions/fiscal-year.actions", () => ({
  openFiscalYearAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const fy = (year: number, status: "OPEN" | "CLOSED") => ({
  id: `fy-${year}`,
  companyId: "company-1",
  year,
  startMonth: 1,
  status,
  openedAt: new Date("2025-01-01"),
  openedBy: "u",
  closedAt: status === "CLOSED" ? new Date("2026-01-01") : null,
  closedBy: status === "CLOSED" ? "u" : null,
  periods: Array.from({ length: 12 }, (_, i) => ({
    id: `${year}-${i}`,
    year,
    month: i + 1,
    status,
  })),
});

describe("PeriodManager — a11y", () => {
  it("con ejercicios (activo + en cierre + cerrado) sin violaciones", async () => {
    const { container } = render(
      <PeriodManager
        companyId="company-1"
        fiscalYears={[fy(2026, "OPEN"), fy(2025, "OPEN"), fy(2024, "CLOSED")] as never}
      />
    );
    expect(container.querySelectorAll("table tbody tr").length).toBe(3);
    await expectNoSeriousA11yViolations(container);
  });

  it("diálogo Abrir primer ejercicio: deuda de a11y conocida (button-name del select de año; SPEC-003)", async () => {
    render(<PeriodManager companyId="company-1" fiscalYears={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /Abrir primer ejercicio/ }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(screen.getByText("Año del ejercicio")).toBeTruthy();
    await expectKnownA11yDebt(document.body, ["button-name"]);
  });
});
