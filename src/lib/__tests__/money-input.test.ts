import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";

import { formatMoneyVE, normalizeMoneyInput, parseMoneyInput } from "../money-input";

describe("normalizeMoneyInput", () => {
  it.each([
    ["100,99", "100.99"], // caso reportado: la coma rompía new Decimal()
    ["100.99", "100.99"],
    ["20000", "20000"],
    ["20.000", "20000"],
    ["20.000,50", "20000.50"],
    ["1.234.567", "1234567"],
    ["1.234.567,8", "1234567.8"],
    ["1,234.56", "1234.56"],
    ["0,5", "0.5"],
    [",5", "0.5"],
    ["007", "7"],
    ["100,", "100"],
    ["", ""],
    ["abc", ""],
    [" 1 000 ", "1000"],
  ])("%j → %j", (input, expected) => {
    // "100," → decPart vacío: queda entero
    expect(normalizeMoneyInput(input)).toBe(expected);
  });

  it("siempre produce algo que Decimal acepta", () => {
    for (const t of ["1,2,3", "..", ",,", "1.2.3,4", "9.9.9", "5,", ".5"]) {
      const out = normalizeMoneyInput(t);
      expect(() => (out ? new Decimal(out) : 0)).not.toThrow();
    }
  });
});

describe("parseMoneyInput", () => {
  it("vacío o basura → 0 sin lanzar", () => {
    expect(parseMoneyInput("").isZero()).toBe(true);
    expect(parseMoneyInput("x").isZero()).toBe(true);
  });

  it("suma exacta sin flotantes", () => {
    const total = parseMoneyInput("20000").plus(parseMoneyInput("100.99"));
    expect(total.toFixed(2)).toBe("20100.99");
  });
});

describe("formatMoneyVE", () => {
  it.each([
    ["0", "0,00"],
    ["100.99", "100,99"],
    ["20000", "20.000,00"],
    ["1234567.5", "1.234.567,50"],
    ["-1500.1", "-1.500,10"],
    ["-0.001", "0,00"],
  ])("%s → %s", (input, expected) => {
    expect(formatMoneyVE(input)).toBe(expected);
  });
});
