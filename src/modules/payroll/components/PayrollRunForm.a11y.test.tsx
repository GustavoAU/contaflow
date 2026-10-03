// @vitest-environment jsdom
// a11y automática (SPEC-002 RN-6/CA-5): PayrollRunForm.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { expectKnownA11yDebt } from "@/__tests__/a11y";
import { PayrollRunForm } from "./PayrollRunForm";

vi.mock("../actions/payroll-run.actions", () => ({ createPayrollRunAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const EMPLOYEES = [
  { id: "e1", name: "Ana Pérez", salaries: [{ amount: "1000", currency: "VES", effectiveFrom: "2020-01-01" }] },
  { id: "e2", name: "Luis Gómez", salaries: [{ amount: "500", currency: "USD", effectiveFrom: "2020-01-01" }] },
];

describe("PayrollRunForm — a11y", () => {
  it("estado inicial: deuda de a11y conocida (label de los 2 date; SPEC-003)", async () => {
    const { container } = render(
      <PayrollRunForm
        companyId="company-1"
        todayISO="2026-10-02"
        activeEmployeeCount={2}
        employees={EMPLOYEES as never}
      />,
    );
    expect(container.querySelectorAll("input").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll("label").length).toBeGreaterThanOrEqual(2);
    await expectKnownA11yDebt(container, ["label"]);
  });
});
