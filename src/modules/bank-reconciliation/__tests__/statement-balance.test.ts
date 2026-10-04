import { describe, expect, it } from "vitest";

import { findStatementBalanceMismatch } from "../services/statement-balance";

describe("findStatementBalanceMismatch", () => {
  it("cuadra con formato venezolano", () => {
    const rows = [
      { debit: null, credit: "1.000,50" },
      { debit: "250,25", credit: null },
    ];
    expect(findStatementBalanceMismatch(rows, "10.000,00", "10.750,25")).toBeNull();
  });

  it("no acumula error de coma flotante (0,1 + 0,2 = 0,3 exacto)", () => {
    const rows = [
      { debit: null, credit: "0,10" },
      { debit: null, credit: "0,20" },
    ];
    expect(findStatementBalanceMismatch(rows, "0,00", "0,30")).toBeNull();
  });

  it("reporta saldo calculado y declarado cuando difieren más de 0,02", () => {
    const m = findStatementBalanceMismatch([{ debit: null, credit: "100,00" }], "0,00", "99,00");
    expect(m?.computed.toFixed(2)).toBe("100.00");
    expect(m?.declared.toFixed(2)).toBe("99.00");
  });

  it("tolera una diferencia de hasta 0,02", () => {
    expect(
      findStatementBalanceMismatch([{ debit: null, credit: "100,00" }], "0,00", "100,02")
    ).toBeNull();
    expect(
      findStatementBalanceMismatch([{ debit: null, credit: "100,00" }], "0,00", "100,03")
    ).not.toBeNull();
  });

  it("sin filas o con saldos ilegibles no se pronuncia", () => {
    expect(findStatementBalanceMismatch([], "0,00", "50,00")).toBeNull();
    expect(
      findStatementBalanceMismatch([{ debit: null, credit: "1,00" }], "abc", "50,00")
    ).toBeNull();
  });

  it("saldo inicial sobregirado (negativo)", () => {
    const rows = [{ debit: null, credit: "500,00" }];
    expect(findStatementBalanceMismatch(rows, "-200,00", "300,00")).toBeNull();
  });
});
