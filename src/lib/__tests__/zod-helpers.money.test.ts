// src/lib/__tests__/zod-helpers.money.test.ts
//
// INFO-2 (auditoría de seguridad MP-1). `Decimal` acepta bases y notación
// científica, así que "0x64" se guardaba como 100,00 sin que nadie se enterara:
// la persona teclea una cosa y la contabilidad registra otra.
//
// El agujero no estaba solo en zMoneyAmount: 27 refines repartidos por 10 schemas
// llamaban a `new Decimal(v)` directo. Por eso se prueban las dos capas — el
// helper compartido y un schema real de cada extremo.

import { describe, it, expect } from "vitest";
import {
  isPlainDecimal,
  strictDecimal,
  zExchangeRate,
  zMoneyAmount,
  zMoneyPositive,
} from "../zod-helpers";

/** Formas que `Decimal` interpreta como número y que un humano nunca teclea. */
const NO_LLANOS = ["0x64", "0X64", "0b11", "0o17", "1e3", "1E3", "1e+3", "1_000", "Infinity", "NaN"];

describe("isPlainDecimal", () => {
  it("acepta dígitos con punto decimal opcional", () => {
    for (const v of ["0", "100", "100.5", "100.50", "0.01", ".5", "5.", "-3", "+3"]) {
      expect(isPlainDecimal(v), v).toBe(true);
    }
  });

  it("rechaza bases, exponentes y separadores", () => {
    for (const v of NO_LLANOS) expect(isPlainDecimal(v), v).toBe(false);
  });

  it("rechaza basura y espacios", () => {
    for (const v of ["", "abc", " 5", "5 ", "1,5", "1.2.3", "--5"]) {
      expect(isPlainDecimal(v), v).toBe(false);
    }
  });
});

describe("strictDecimal", () => {
  it("parsea decimales llanos", () => {
    expect(strictDecimal("1234.56").toFixed(2)).toBe("1234.56");
  });

  it("lanza ante formatos no llanos — el catch del refine lo vuelve 'inválido'", () => {
    for (const v of NO_LLANOS) expect(() => strictDecimal(v), v).toThrow();
  });
});

describe("zMoneyAmount", () => {
  it("acepta montos normales", () => {
    for (const v of ["0", "100", "1234.56", "999999999.99"]) {
      expect(zMoneyAmount.safeParse(v).success, v).toBe(true);
    }
  });

  it("REGRESIÓN INFO-2: no convierte hex/exponencial en un monto", () => {
    // "0x64" pasaba y llegaba a la BD como 100.00
    for (const v of NO_LLANOS) {
      expect(zMoneyAmount.safeParse(v).success, v).toBe(false);
    }
  });

  it("sigue rechazando lo de siempre: negativos, >2 decimales y fuera de rango", () => {
    expect(zMoneyAmount.safeParse("-1").success).toBe(false);
    expect(zMoneyAmount.safeParse("1.234").success).toBe(false);
    expect(zMoneyAmount.safeParse("1000000000").success).toBe(false);
  });

  it("zMoneyPositive exige > 0 y hereda el filtro de formato", () => {
    expect(zMoneyPositive.safeParse("0").success).toBe(false);
    expect(zMoneyPositive.safeParse("0.01").success).toBe(true);
    expect(zMoneyPositive.safeParse("0x64").success).toBe(false);
  });
});

describe("schemas que validan montos a mano (los 27 refines del barrido)", () => {
  // Prueba de que el barrido llegó a los schemas, no solo al helper compartido:
  // estos NO usan zMoneyAmount, tienen su propio refine con `new Decimal(v)`.
  it("un presupuesto no acepta '0x64' como importe", async () => {
    const { UpsertBudgetLineSchema } = await import("@/modules/budgets/schemas/budget.schemas");
    const base = { accountId: "acc-1", notes: "" };

    expect(UpsertBudgetLineSchema.safeParse({ ...base, amount: "100.50" }).success).toBe(true);
    expect(UpsertBudgetLineSchema.safeParse({ ...base, amount: "0x64" }).success).toBe(false);
    expect(UpsertBudgetLineSchema.safeParse({ ...base, amount: "1e3" }).success).toBe(false);
  });
});

describe("zExchangeRate", () => {
  it("acepta tasas BCV de hasta 4 decimales", () => {
    expect(zExchangeRate.safeParse("549.3716").success).toBe(true);
  });

  it("REGRESIÓN INFO-2: tampoco acepta hex ni exponencial", () => {
    expect(zExchangeRate.safeParse("0x64").success).toBe(false);
    expect(zExchangeRate.safeParse("1e3").success).toBe(false);
  });
});
