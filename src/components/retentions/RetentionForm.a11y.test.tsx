// @vitest-environment jsdom
// a11y automática (SPEC-002 RN-6/CA-5): RetentionForm.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { expectKnownA11yDebt } from "@/__tests__/a11y";
import { RetentionForm } from "./RetentionForm";

vi.mock("@/modules/retentions/actions/retention.actions", () => ({
  createRetentionAction: vi.fn(),
  exportRetentionVoucherPDFAction: vi.fn(),
  linkRetentionToInvoiceAction: vi.fn(),
  findInvoiceByNumberAction: vi.fn(),
  getActivePeriodAction: vi.fn().mockResolvedValue({ success: false, error: "sin período" }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));

describe("RetentionForm — a11y", () => {
  it("estado inicial: deuda de a11y conocida (label date + select-name; SPEC-003)", async () => {
    const { container } = render(<RetentionForm companyId="company-1" userId="user-1" />);
    expect(container.querySelectorAll("input, select").length).toBeGreaterThanOrEqual(5);
    expect(container.querySelectorAll("label").length).toBeGreaterThanOrEqual(5);
    await expectKnownA11yDebt(container, ["label", "select-name"]);
  });
});
