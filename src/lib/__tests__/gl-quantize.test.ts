// src/lib/__tests__/gl-quantize.test.ts
//
// TDD SPEC (ADR-058, SPEC-004 paso 3) — contrato de `quantizeGLEntries`.
// Todos estos tests DEBEN fallar mientras la funcion sea el stub ("not implemented").
// No modificar este archivo: se implementa en src/lib/gl-assertions.ts hasta ponerlos en verde.
//
// Environment: node

import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { quantizeGLEntries } from "@/lib/gl-assertions";

const d = (v: string | number) => new Decimal(v);
const sum = (xs: { amount: Decimal }[]) => xs.reduce((a, e) => a.plus(e.amount), new Decimal(0));
const line = (v: string) => ({ amount: d(v) });
const lines = (...vs: string[]) => vs.map(line);
const half = (x: Decimal) => x.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const isCentMultiple = (x: Decimal) => x.times(100).isInteger();
const fixed = (xs: { amount: Decimal }[]) => xs.map((e) => e.amount.toFixed(2));

// Caso real de produccion (el bug): Σ bruta exactamente -0.0001.
const REAL_CASE = [
  "6268062.4567",
  "272234.5159",
  "-46.7971",
  "-93.5943",
  "-140.3914",
  "-280.7828",
  "-71958.3900",
  "-127912.1608",
  "-143901.1809",
  "-194988.0500",
  "-6000975.6254",
];

describe("quantizeGLEntries — caso real de produccion (el bug)", () => {
  const input = REAL_CASE.map((v, i) => ({ amount: d(v), accountId: `acc-${i}` }));

  it("la Σ bruta del fixture es exactamente -0.0001 (premisa del test)", () => {
    expect(sum(input).toString()).toBe("-0.0001");
  });

  it("la salida suma 0 EXACTO y cada monto es multiplo de 0.01", () => {
    const out = quantizeGLEntries(input);
    expect(sum(out.entries).isZero()).toBe(true);
    for (const e of out.entries) expect(isCentMultiple(e.amount)).toBe(true);
  });

  it("absorbedIndex apunta a la linea de mayor |amount| (la primera)", () => {
    const out = quantizeGLEntries(input);
    const maxAbs = input.reduce((m, e) => (e.amount.abs().gt(m) ? e.amount.abs() : m), d(0));
    expect(maxAbs.toString()).toBe("6268062.4567");
    expect(out.absorbedIndex).toBe(0);
  });

  it("las lineas no absorbidas son su redondeo HALF_UP; la absorbida difiere en el residual", () => {
    const out = quantizeGLEntries(input);
    const rounded = input.map((e) => half(e.amount));
    const expectedResidual = rounded.reduce((a, x) => a.plus(x), d(0));
    expect(out.residual.equals(expectedResidual)).toBe(true);
    expect(out.residual.isZero()).toBe(false);
    expect(out.entries).toHaveLength(input.length);
    out.entries.forEach((e, i) => {
      if (i === out.absorbedIndex) {
        expect(e.amount.equals(rounded[i]!.minus(out.residual))).toBe(true);
        expect(e.amount.minus(rounded[i]!).abs().equals(out.residual.abs())).toBe(true);
      } else {
        expect(e.amount.equals(rounded[i]!)).toBe(true);
      }
    });
  });

  it("conserva el resto de campos y el orden", () => {
    const out = quantizeGLEntries(input);
    expect(out.entries.map((e) => e.accountId)).toEqual(input.map((e) => e.accountId));
  });
});

describe("quantizeGLEntries — redondeo HALF_UP (mitad alejandose de cero)", () => {
  it("0.005 -> 0.01 y -0.005 -> -0.01", () => {
    const out = quantizeGLEntries(lines("0.005", "-0.005"));
    expect(fixed(out.entries)).toEqual(["0.01", "-0.01"]);
    expect(out.residual.isZero()).toBe(true);
    expect(out.absorbedIndex).toBeNull();
  });

  it("1.235 -> 1.24 (no 1.23, no redondeo bancario)", () => {
    expect(fixed(quantizeGLEntries(lines("1.235", "-1.235")).entries)).toEqual(["1.24", "-1.24"]);
  });

  it("1.2349 -> 1.23", () => {
    expect(fixed(quantizeGLEntries(lines("1.2349", "-1.2349")).entries)).toEqual(["1.23", "-1.23"]);
  });

  it("0.004 se redondea a 0.00 y la linea se DESCARTA", () => {
    const out = quantizeGLEntries(lines("0.004", "5", "-5.004"));
    expect(fixed(out.entries)).toEqual(["5.00", "-5.00"]);
    expect(out.entries).toHaveLength(2);
  });

  it("-0.004 tambien se descarta (no queda un -0.00)", () => {
    const out = quantizeGLEntries(lines("-0.004", "5", "-4.996"));
    expect(fixed(out.entries)).toEqual(["5.00", "-5.00"]);
  });

  it("devuelve Decimal, no number", () => {
    const out = quantizeGLEntries(lines("1.235", "-1.235"));
    for (const e of out.entries) expect(Decimal.isDecimal(e.amount)).toBe(true);
    expect(Decimal.isDecimal(out.residual)).toBe(true);
  });

  it("un residuo de 0.01 se absorbe en la linea de mayor |amount| y suma 0", () => {
    // 1.005->1.01, -0.5025->-0.50, -0.5025->-0.50 => residual 0.01
    const out = quantizeGLEntries(lines("1.005", "-0.5025", "-0.5025"));
    expect(out.residual.toFixed(2)).toBe("0.01");
    expect(out.absorbedIndex).toBe(0);
    expect(fixed(out.entries)).toEqual(["1.00", "-0.50", "-0.50"]);
    expect(sum(out.entries).isZero()).toBe(true);
  });

  it("el absorbedIndex es indice del arreglo de SALIDA (tras descartar lineas en 0.00)", () => {
    // Entrada: la linea 0 y la 4 se descartan; la mayor (10.005) es la entrada 1 pero la SALIDA 0.
    const out = quantizeGLEntries(lines("0.001", "10.005", "-5.0025", "-5.0025", "-0.0000"));
    expect(out.entries).toHaveLength(3);
    expect(sum(out.entries).isZero()).toBe(true);
    expect(out.absorbedIndex).toBe(0);
    expect(fixed(out.entries)).toEqual(["10.00", "-5.00", "-5.00"]);
  });
});

describe("quantizeGLEntries — eleccion de la linea que absorbe", () => {
  it("empate de mayor |amount| -> absorbe en la primera", () => {
    // 10.00, -10.00, 0.005->0.01: residual 0.01; empate entre 10.00 y -10.00
    const out = quantizeGLEntries(lines("10.00", "-10.00", "0.005"));
    expect(out.absorbedIndex).toBe(0);
    expect(fixed(out.entries)).toEqual(["9.99", "-10.00", "0.01"]);
    expect(sum(out.entries).isZero()).toBe(true);
  });

  it("noAbsorb en la mayor -> absorbe en la siguiente mayor", () => {
    const input = [
      { amount: d("10.00"), noAbsorb: true },
      { amount: d("-10.00") },
      { amount: d("0.005") },
    ];
    const out = quantizeGLEntries(input);
    expect(out.absorbedIndex).toBe(1);
    expect(fixed(out.entries)).toEqual(["10.00", "-10.01", "0.01"]);
    expect(out.entries[0]!.noAbsorb).toBe(true);
    expect(sum(out.entries).isZero()).toBe(true);
  });

  it("todas noAbsorb con residuo -> lanza /absorb/", () => {
    const input = [
      { amount: d("10.00"), noAbsorb: true },
      { amount: d("-10.00"), noAbsorb: true },
      { amount: d("0.005"), noAbsorb: true },
    ];
    expect(() => quantizeGLEntries(input)).toThrow(/absorb/);
  });

  it("todas noAbsorb SIN residuo -> no lanza y absorbedIndex es null", () => {
    const input = [
      { amount: d("10.00"), noAbsorb: true },
      { amount: d("-10.00"), noAbsorb: true },
    ];
    const out = quantizeGLEntries(input);
    expect(out.absorbedIndex).toBeNull();
    expect(fixed(out.entries)).toEqual(["10.00", "-10.00"]);
  });
});

describe("quantizeGLEntries — guardas de cuadre y de residuo", () => {
  it("[100.00, -99.50] -> lanza /descuadr/ (no es residuo de redondeo)", () => {
    expect(() => quantizeGLEntries(lines("100.00", "-99.50"))).toThrow(/descuadr/);
  });

  it("limite del cuadre: |Σ bruta| == N x 0.005 NO lanza; apenas por encima SI", () => {
    // N=2 => limite 0.01. Σ = 0.0100 pasa el cuadre; Σ = 0.0101 no.
    expect(() => quantizeGLEntries(lines("100.005", "-99.995"))).not.toThrow();
    expect(() => quantizeGLEntries(lines("100.0051", "-99.995"))).toThrow(/descuadr/);
  });

  it("residuo de redondeo > N x 0.005 -> lanza /residuo/", () => {
    // N=2: Σ bruta 0.010 (<= 0.010, pasa el cuadre) pero Σ redondeada 0.02 > 0.010
    expect(() => quantizeGLEntries(lines("0.005", "0.005"))).toThrow(/residuo/);
  });

  it("[10.004] con expectBalanced:false -> redondea a 10.00 sin lanzar", () => {
    const out = quantizeGLEntries(lines("10.004"), { expectBalanced: false });
    expect(fixed(out.entries)).toEqual(["10.00"]);
    expect(out.residual.toFixed(2)).toBe("10.00");
    expect(out.absorbedIndex).toBeNull();
  });

  it("expectBalanced:false descarta lineas en 0.00 pero no absorbe", () => {
    const out = quantizeGLEntries(lines("0.004", "3.335", "-1.004"), { expectBalanced: false });
    expect(fixed(out.entries)).toEqual(["3.34", "-1.00"]);
    expect(out.residual.toFixed(2)).toBe("2.34");
    expect(out.absorbedIndex).toBeNull();
  });

  it("expectBalanced:true explicito se comporta como el defecto", () => {
    expect(() => quantizeGLEntries(lines("100.00", "-99.50"), { expectBalanced: true })).toThrow(
      /descuadr/
    );
  });

  it("mode 'absorb' explicito se comporta como el defecto", () => {
    const a = quantizeGLEntries(lines("1.005", "-0.5025", "-0.5025"), { mode: "absorb" });
    const b = quantizeGLEntries(lines("1.005", "-0.5025", "-0.5025"));
    expect(fixed(a.entries)).toEqual(fixed(b.entries));
    expect(a.absorbedIndex).toBe(b.absorbedIndex);
    expect(a.absorbedIndex).toBe(0);
  });
});

describe("quantizeGLEntries — modo exact", () => {
  it("no redondea: 833.3333 y -833.3333 salen identicos; residual = Σ exacta", () => {
    const out = quantizeGLEntries(lines("833.3333", "-833.3333"), { mode: "exact" });
    expect(out.entries.map((e) => e.amount.toString())).toEqual(["833.3333", "-833.3333"]);
    expect(out.residual.isZero()).toBe(true);
    expect(out.absorbedIndex).toBeNull();
  });

  it("no descarta, no absorbe y no exige cuadre: residual = Σ exacta", () => {
    const out = quantizeGLEntries(lines("833.3333", "-833.3333", "0.0001", "0.004"), {
      mode: "exact",
    });
    expect(out.entries.map((e) => e.amount.toString())).toEqual([
      "833.3333",
      "-833.3333",
      "0.0001",
      "0.004",
    ]);
    expect(out.residual.toString()).toBe("0.0041");
    expect(out.absorbedIndex).toBeNull();
  });

  it("modo exact no lanza ni con todas noAbsorb ni con asiento descuadrado", () => {
    const out = quantizeGLEntries(
      [
        { amount: d("100.00"), noAbsorb: true },
        { amount: d("-99.50"), noAbsorb: true },
      ],
      { mode: "exact" }
    );
    expect(out.residual.toFixed(2)).toBe("0.50");
    expect(out.absorbedIndex).toBeNull();
  });
});

describe("quantizeGLEntries — idempotencia, no mutacion, campos, vacio", () => {
  const input = [
    { amount: d("1.005"), accountId: "a", description: "uno" },
    { amount: d("-0.5025"), accountId: "b", description: "dos" },
    { amount: d("-0.5025"), accountId: "c", description: "tres" },
  ];

  it("idempotente: cuantizar lo ya cuantizado no cambia nada y residual es 0", () => {
    const once = quantizeGLEntries(input);
    const twice = quantizeGLEntries(once.entries);
    expect(fixed(twice.entries)).toEqual(fixed(once.entries));
    expect(twice.residual.isZero()).toBe(true);
    expect(twice.absorbedIndex).toBeNull();
  });

  it("no muta el arreglo ni los objetos de entrada", () => {
    const snapshot = input.map((e) => ({ ...e, amount: e.amount.toString() }));
    const refs = [...input];
    const out = quantizeGLEntries(input);
    expect(out.entries).not.toBe(input);
    expect(input).toHaveLength(3);
    input.forEach((e, i) => {
      expect(e).toBe(refs[i]);
      expect(e.amount.toString()).toBe(snapshot[i]!.amount);
      expect(e.accountId).toBe(snapshot[i]!.accountId);
    });
  });

  it("conserva orden y demas campos de cada linea", () => {
    const out = quantizeGLEntries(input);
    expect(out.entries.map((e) => e.accountId)).toEqual(["a", "b", "c"]);
    expect(out.entries.map((e) => e.description)).toEqual(["uno", "dos", "tres"]);
  });

  it("entrada vacia -> { entries: [], residual: 0, absorbedIndex: null }", () => {
    const out = quantizeGLEntries([]);
    expect(out.entries).toEqual([]);
    expect(out.residual.isZero()).toBe(true);
    expect(out.absorbedIndex).toBeNull();
  });

  it("entrada vacia tambien en modo exact y con expectBalanced:false", () => {
    for (const opts of [{ mode: "exact" as const }, { expectBalanced: false }]) {
      const out = quantizeGLEntries([], opts);
      expect(out.entries).toEqual([]);
      expect(out.residual.isZero()).toBe(true);
      expect(out.absorbedIndex).toBeNull();
    }
  });
});

describe("quantizeGLEntries — propiedad sobre 200 asientos USD x tasa de 6 decimales", () => {
  // LCG determinista (Numerical Recipes), sin Math.random.
  let seed = 20261003;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const RATE = d("779.952200");

  const entries200 = Array.from({ length: 200 }, () => {
    const n = 3 + (next() % 10); // 3..12 lineas
    const body = Array.from({ length: n - 1 }, () => {
      const cents = 1 + (next() % 5_000_000);
      const usd = d(cents).div(100); // 2 decimales
      const signed = next() % 2 === 0 ? usd : usd.negated();
      return { amount: signed.times(RATE) };
    });
    const total = body.reduce((a, e) => a.plus(e.amount), d(0));
    return [...body, { amount: total.negated() }]; // Σ bruta exactamente 0
  });

  it("el generador produce asientos de 3 a 12 lineas con Σ bruta 0", () => {
    expect(entries200).toHaveLength(200);
    for (const e of entries200) {
      expect(e.length).toBeGreaterThanOrEqual(3);
      expect(e.length).toBeLessThanOrEqual(12);
      expect(sum(e).isZero()).toBe(true);
    }
  });

  it("todos: salida Σ = 0 exacto, multiplos de 0.01 y |residual| <= N x 0.005", () => {
    for (const e of entries200) {
      const out = quantizeGLEntries(e);
      expect(sum(out.entries).isZero()).toBe(true);
      for (const x of out.entries) expect(isCentMultiple(x.amount)).toBe(true);
      expect(out.residual.abs().lte(d(e.length).times("0.005"))).toBe(true);
    }
  });
});
