import { describe, expect, it } from "vitest";
import { countCodeDigits, isPostableCode, POSTABLE_CODE_DIGITS } from "./account-code";

describe("account-code (ADR-059)", () => {
  it("cuenta dígitos sin separadores", () => {
    expect(countCodeDigits("1.1.01.01.001")).toBe(9);
    expect(countCodeDigits("1-1-01")).toBe(4);
    expect(countCodeDigits("110101001")).toBe(9);
  });

  it("9 dígitos exactos o más = movimiento", () => {
    expect(POSTABLE_CODE_DIGITS).toBe(9);
    expect(isPostableCode("1.1.01.01.001")).toBe(true);
    expect(isPostableCode("3.2.01.01.001")).toBe(true);
    expect(isPostableCode("1.1.06.01.001")).toBe(true);
    expect(isPostableCode("1.1.01.01.0010")).toBe(true);
  });

  it("menos de 9 dígitos = título/subtítulo", () => {
    expect(isPostableCode("1")).toBe(false);
    expect(isPostableCode("1.1")).toBe(false);
    expect(isPostableCode("1.1.01")).toBe(false);
    expect(isPostableCode("3.2.01.01")).toBe(false);
    expect(isPostableCode("1105")).toBe(false);
  });
});
