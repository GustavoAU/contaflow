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
  it("aplica IGTF para pagos en USD", () => {
    expect(IGTFService.applies("USD", false)).toBe(true);
  });

  it("aplica IGTF para pagos en EUR", () => {
    expect(IGTFService.applies("EUR", false)).toBe(true);
  });

  it("aplica IGTF para Contribuyente Especial en VES", () => {
    expect(IGTFService.applies("VES", true)).toBe(true);
  });

  it("no aplica IGTF para pagos en VES sin Contribuyente Especial", () => {
    expect(IGTFService.applies("VES", false)).toBe(false);
  });
});

describe("IGTFService.getDescription", () => {
  it("describe pago en divisas", () => {
    const desc = IGTFService.getDescription("USD", false);
    expect(desc).toContain("divisas");
    expect(desc).toContain("USD");
  });

  it("describe Contribuyente Especial", () => {
    const desc = IGTFService.getDescription("VES", true);
    expect(desc).toContain("Contribuyente Especial");
  });

  it("describe cuando no aplica", () => {
    const desc = IGTFService.getDescription("VES", false);
    expect(desc).toContain("No aplica");
  });
});
