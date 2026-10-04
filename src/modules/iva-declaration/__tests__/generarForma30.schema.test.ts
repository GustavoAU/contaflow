import { describe, expect, it } from "vitest";

import { GenerarForma30Schema } from "../schemas/generarForma30.schema";

// El crédito fiscal del período anterior viaja como string decimal (R-5). El tope es
// MAX_INVOICE_AMOUNT (ADR-006 D-2), no el de zMoneyAmount: un crédito acumulado puede
// superar los mil millones de Bs. y no debe rechazarse.
const parse = (credito?: unknown) =>
  GenerarForma30Schema.safeParse({
    companyId: "cmp_1",
    year: 2026,
    month: 3,
    creditoFiscalPeriodoAnterior: credito,
  });

const msg = (credito: unknown) => {
  const r = parse(credito);
  return r.success ? null : r.error.issues[0]?.message;
};

describe("GenerarForma30Schema.creditoFiscalPeriodoAnterior", () => {
  it('omitido equivale a "0"', () => {
    const r = parse(undefined);
    expect(r.success && r.data.creditoFiscalPeriodoAnterior).toBe("0");
  });

  it.each(["0", "500", "500.00", "1234.5", "1000000000", "9999999999.99", "5."])(
    "acepta %j",
    (v) => {
      expect(parse(v).success).toBe(true);
    }
  );

  it("el valor llega tal cual, sin pasar por number", () => {
    const r = parse("12345678.90");
    expect(r.success && r.data.creditoFiscalPeriodoAnterior).toBe("12345678.90");
  });

  it("un number de un bundle viejo se coacciona a string y se valida igual", () => {
    expect(parse(500).success).toBe(true);
    expect(msg(-5)).toBe("El crédito fiscal no puede ser negativo");
  });

  it.each(["100,99", "0x64", "1e3", "1_000", "abc", "12abc", "", " 5", "null"])(
    "formato inválido %j → mensaje de formato",
    (v) => {
      expect(msg(v)).toMatch(/^Crédito fiscal inválido/);
    }
  );

  it("negativo → mensaje propio (y -0 sí pasa)", () => {
    expect(msg("-100")).toBe("El crédito fiscal no puede ser negativo");
    expect(msg("-0.01")).toBe("El crédito fiscal no puede ser negativo");
    expect(parse("-0").success).toBe(true);
  });

  it("más de 2 decimales → mensaje de decimales (no el del tope)", () => {
    expect(msg("100.123")).toBe("El crédito fiscal admite máximo 2 decimales");
  });

  it("el tope es el de ADR-006 D-2: 9.999.999.999,99 pasa, un céntimo más no", () => {
    expect(parse("9999999999.99").success).toBe(true);
    expect(msg("10000000000")).toMatch(/supera el máximo permitido/);
    expect(msg("10000000000.00")).toMatch(/supera el máximo permitido/);
  });
});
