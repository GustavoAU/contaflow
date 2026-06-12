// src/modules/igtf/services/IGTFService.test.ts
import { describe, it, expect } from "vitest";
import { IGTFService, IGTF_RATE } from "./IGTFService";

describe("IGTFService.calculate", () => {
  it("calcula IGTF al 3% correctamente", () => {
    const result = IGTFService.calculate("1000.00");
    expect(result.amount).toBe("1000.00");
    expect(result.igtfRate).toBe(3);
    expect(result.igtfAmount).toBe("30.00");
    expect(result.total).toBe("1030.00");
  });

  it("calcula IGTF con monto decimal", () => {
    const result = IGTFService.calculate("975207.36");
    expect(result.igtfAmount).toBe("29256.22");
    expect(result.total).toBe("1004463.58");
  });

  it("calcula IGTF con tasa personalizada", () => {
    const result = IGTFService.calculate("1000.00", 2);
    expect(result.igtfAmount).toBe("20.00");
    expect(result.total).toBe("1020.00");
  });

  it("usa la tasa vigente correcta", () => {
    expect(IGTF_RATE).toBe(3);
  });
});

describe("IGTFService.applies", () => {
  it("aplica IGTF para CE con pago en USD", () => {
    expect(IGTFService.applies("USD", true)).toBe(true);
  });

  it("aplica IGTF para CE con pago en EUR", () => {
    expect(IGTFService.applies("EUR", true)).toBe(true);
  });

  it("no aplica IGTF para no-CE con pago en USD (A5)", () => {
    expect(IGTFService.applies("USD", false)).toBe(false);
  });

  it("no aplica IGTF para no-CE con pago en EUR (A5)", () => {
    expect(IGTFService.applies("EUR", false)).toBe(false);
  });

  it("no aplica IGTF para CE con pago en VES (A5)", () => {
    expect(IGTFService.applies("VES", true)).toBe(false);
  });

  it("no aplica IGTF para no-CE con pago en VES", () => {
    expect(IGTFService.applies("VES", false)).toBe(false);
  });
});

describe("IGTFService.getDescription", () => {
  it("describe CE con pago en divisas", () => {
    const desc = IGTFService.getDescription("USD", true);
    expect(desc).toContain("divisas");
    expect(desc).toContain("USD");
  });

  it("no aplica para no-CE con pago en divisas", () => {
    const desc = IGTFService.getDescription("USD", false);
    expect(desc).toContain("No aplica");
  });

  it("no aplica para CE con pago en VES", () => {
    const desc = IGTFService.getDescription("VES", true);
    expect(desc).toContain("No aplica");
  });

  it("describe cuando no aplica (VES, no-CE)", () => {
    const desc = IGTFService.getDescription("VES", false);
    expect(desc).toContain("No aplica");
  });
});