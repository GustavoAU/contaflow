// src/lib/__tests__/gl-assertions.test.ts
// Unit tests for assertBalancedGLEntries — N4 invariante de partida doble.
// Node environment (pure logic, no DOM).
import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";

import { assertBalancedGLEntries } from "../gl-assertions";

// Helper: converts a plain number to a { amount: Decimal } entry.
function entry(n: number | string): { amount: Decimal } {
  return { amount: new Decimal(n) };
}

describe("assertBalancedGLEntries", () => {
  // ------------------------------------------------------------------ //
  // 1. Asiento balanceado 2 entradas
  // ------------------------------------------------------------------ //
  it("no lanza con asiento balanceado [+100, -100]", () => {
    expect(() =>
      assertBalancedGLEntries([entry(100), entry(-100)]),
    ).not.toThrow();
  });

  // ------------------------------------------------------------------ //
  // 2. Asiento balanceado 4 entradas
  // ------------------------------------------------------------------ //
  it("no lanza con asiento balanceado de 4 entradas [+1000, +160, -1000, -160]", () => {
    expect(() =>
      assertBalancedGLEntries([
        entry(1000),
        entry(160),
        entry(-1000),
        entry(-160),
      ]),
    ).not.toThrow();
  });

  // ------------------------------------------------------------------ //
  // 3. Descuadrado > 0.01 → lanza con mensaje "descuadrado"
  // ------------------------------------------------------------------ //
  it('lanza si descuadrado > 0.01: [+100, -99] (diff=1)', () => {
    expect(() =>
      assertBalancedGLEntries([entry(100), entry(-99)]),
    ).toThrow(/descuadrado/);
  });

  // ------------------------------------------------------------------ //
  // 4. Diferencia <= tolerancia default (0.01) → no lanza
  // ------------------------------------------------------------------ //
  it("no lanza con diferencia <= tolerancia default: [+100, -100.005] (|diff|=0.005)", () => {
    // |100 + (-100.005)| = 0.005 ≤ 0.01
    expect(() =>
      assertBalancedGLEntries([entry(100), entry("-100.005")]),
    ).not.toThrow();
  });

  // ------------------------------------------------------------------ //
  // 5. Diferencia = 0.011 → lanza (supera tolerancia 0.01)
  // ------------------------------------------------------------------ //
  it("lanza con diferencia = 0.011: [+100, -99.989]", () => {
    // |100 + (-99.989)| = 0.011 > 0.01
    expect(() =>
      assertBalancedGLEntries([entry(100), entry("-99.989")]),
    ).toThrow(/descuadrado/);
  });

  // ------------------------------------------------------------------ //
  // 6. Tolerancia personalizada: [+100, -95] con tolerance=5.01 → no lanza
  // ------------------------------------------------------------------ //
  it("tolerancia personalizada: [+100, -95] con tolerance=new Decimal('5.01') → no lanza", () => {
    // |100 + (-95)| = 5.00 ≤ 5.01
    expect(() =>
      assertBalancedGLEntries(
        [entry(100), entry(-95)],
        new Decimal("5.01"),
      ),
    ).not.toThrow();
  });

  // ------------------------------------------------------------------ //
  // 7. Array vacío → no lanza (suma = 0)
  // ------------------------------------------------------------------ //
  it("array vacío → no lanza", () => {
    expect(() => assertBalancedGLEntries([])).not.toThrow();
  });

  // ------------------------------------------------------------------ //
  // 8. Asiento de 1 entrada → lanza (no balanceado)
  // ------------------------------------------------------------------ //
  it("asiento de 1 entrada [+100] → lanza", () => {
    expect(() => assertBalancedGLEntries([entry(100)])).toThrow(/descuadrado/);
  });
});
