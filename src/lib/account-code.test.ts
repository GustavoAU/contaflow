import { describe, expect, it } from "vitest";
import * as accountCode from "./account-code";
import { countCodeDigits, isPostableCode, POSTABLE_CODE_DIGITS } from "./account-code";

// SPEC-008 / ADR-059 (modo RED): estos tres nombres los añade el ledger-agent. Se leen a través del
// namespace y se tipan con el contrato de la SPEC §7 para que `tsc` no se ponga rojo antes de que
// existan. Una vez en verde, resuelven exactamente a las firmas reales (la intersección es idéntica).
type MovementCodeApi = {
  MOVEMENT_CODE_REGEX: RegExp;
  parentCodeOf(movementCode: string): string | null;
  isTitleParentCode(code: string): boolean;
};
const api = accountCode as typeof accountCode & MovementCodeApi;

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

// ─── SPEC-008 · RN-1: forma exacta de una cuenta de movimiento ────────────────────────────────────

describe("MOVEMENT_CODE_REGEX (SPEC-008 RN-1) — forma exacta A.B.CC.DD.EEE", () => {
  it("es exactamente la expresión del contrato (1+1+2+2+3 dígitos, separada por puntos)", () => {
    expect(api.MOVEMENT_CODE_REGEX.source).toBe(/^\d\.\d\.\d{2}\.\d{2}\.\d{3}$/.source);
  });

  it("no lleva flags g/y: `.test()` repetido no arrastra lastIndex entre llamadas", () => {
    expect(api.MOVEMENT_CODE_REGEX.global).toBe(false);
    expect(api.MOVEMENT_CODE_REGEX.sticky).toBe(false);
    expect(api.MOVEMENT_CODE_REGEX.test("1.1.01.01.001")).toBe(true);
    expect(api.MOVEMENT_CODE_REGEX.test("1.1.01.01.001")).toBe(true);
  });

  it.each(["1.1.01.01.001", "2.1.05.02.123", "5.9.99.99.999", "3.2.01.01.001", "1.1.06.01.002"])(
    "acepta el código de movimiento %s",
    (code) => {
      expect(api.MOVEMENT_CODE_REGEX.test(code)).toBe(true);
    }
  );

  it.each([
    ["sin puntos (9 dígitos planos)", "110101001"],
    ["último segmento de 4 dígitos (10 dígitos)", "1.1.01.01.0010"],
    ["último segmento de 2 dígitos", "1.1.01.01.01"],
    ["un título de 6 dígitos", "1.1.01.01"],
    ["un título de 4 dígitos", "1.1.01"],
    ["separador guion en vez de punto", "1-1-01-01-001"],
    ["segmentos con tamaños cambiados (1.1.1.01.001)", "1.1.1.01.001"],
    ["segmentos con tamaños cambiados (1.1.01.001.01)", "1.1.01.001.01"],
    ["primer segmento de 2 dígitos", "11.1.01.01.001"],
    ["letras en vez de dígitos", "A.1.01.01.001"],
    ["espacio al final", "1.1.01.01.001 "],
    ["espacio al inicio", " 1.1.01.01.001"],
    ["salto de línea al final", "1.1.01.01.001\n"],
    ["un segmento extra", "1.1.01.01.001.001"],
    ["cadena vacía", ""],
  ])("rechaza %s", (_label, code) => {
    expect(api.MOVEMENT_CODE_REGEX.test(code)).toBe(false);
  });

  it("todo código que cumple la forma es de movimiento (9 dígitos) según isPostableCode", () => {
    for (const code of ["1.1.01.01.001", "4.1.02.03.999", "5.2.10.10.010"]) {
      expect(api.MOVEMENT_CODE_REGEX.test(code)).toBe(true);
      expect(isPostableCode(code)).toBe(true);
    }
  });
});

// ─── SPEC-008 · RN-1: el padre es el código sin el último segmento ───────────────────────────────

describe("parentCodeOf (SPEC-008 RN-1)", () => {
  it.each([
    ["1.1.01.01.001", "1.1.01.01"],
    ["1.1.01.01.050", "1.1.01.01"],
    ["2.1.05.02.123", "2.1.05.02"],
    ["5.9.99.99.999", "5.9.99.99"],
    ["3.2.01.01.001", "3.2.01.01"],
  ])("el padre de %s es %s", (code, parent) => {
    expect(api.parentCodeOf(code)).toBe(parent);
  });

  it.each([
    ["sin puntos", "110101001"],
    ["10 dígitos", "1.1.01.01.0010"],
    ["último segmento de 2 dígitos", "1.1.01.01.01"],
    ["un título de 6 dígitos (no es de movimiento)", "1.1.01.01"],
    ["un título de 4 dígitos", "1.1.01"],
    ["un código heredado de 4 dígitos", "1105"],
    ["guiones", "1-1-01-01-001"],
    ["texto", "abc"],
    ["cadena vacía", ""],
  ])("devuelve null si el código no cumple la forma (%s)", (_label, code) => {
    expect(api.parentCodeOf(code)).toBeNull();
  });

  it("el padre de un código de movimiento es siempre un título de 6 dígitos", () => {
    const parent = api.parentCodeOf("1.1.01.01.001");
    expect(parent).not.toBeNull();
    expect(api.isTitleParentCode(parent as string)).toBe(true);
  });
});

// ─── SPEC-008 · RN-2: un padre válido tiene exactamente 6 dígitos ────────────────────────────────

describe("isTitleParentCode (SPEC-008 RN-2) — exactamente 6 dígitos sin contar separadores", () => {
  it.each(["1.1.01.01", "2.1.05.02", "5.9.99.99", "110101"])(
    "%s tiene 6 dígitos → puede ser padre",
    (code) => {
      expect(api.isTitleParentCode(code)).toBe(true);
    }
  );

  it.each([
    ["1 dígito", "1"],
    ["2 dígitos", "1.1"],
    ["4 dígitos (título de nivel 3)", "1.1.01"],
    ["4 dígitos heredado", "1105"],
    ["5 dígitos", "1.1.01.0"],
    ["7 dígitos", "1.1.01.011"],
    ["8 dígitos", "1.1.01.01.0"],
    ["9 dígitos (una cuenta de movimiento)", "1.1.01.01.001"],
    ["10 dígitos", "1.1.01.01.0010"],
    ["cadena vacía", ""],
  ])("%s → no puede ser padre", (_label, code) => {
    expect(api.isTitleParentCode(code)).toBe(false);
  });
});
