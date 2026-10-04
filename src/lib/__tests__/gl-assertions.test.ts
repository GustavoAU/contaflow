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
    expect(() => assertBalancedGLEntries([entry(100), entry(-100)])).not.toThrow();
  });

  // ------------------------------------------------------------------ //
  // 2. Asiento balanceado 4 entradas
  // ------------------------------------------------------------------ //
  it("no lanza con asiento balanceado de 4 entradas [+1000, +160, -1000, -160]", () => {
    expect(() =>
      assertBalancedGLEntries([entry(1000), entry(160), entry(-1000), entry(-160)])
    ).not.toThrow();
  });

  // ------------------------------------------------------------------ //
  // 3. Descuadrado > 0.01 → lanza con mensaje "descuadrado"
  // ------------------------------------------------------------------ //
  it("lanza si descuadrado > 0.01: [+100, -99] (diff=1)", () => {
    expect(() => assertBalancedGLEntries([entry(100), entry(-99)])).toThrow(/descuadrado/);
  });

  // ------------------------------------------------------------------ //
  // 4. Tolerancia por defecto = 0 (ADR-058): cualquier diferencia lanza
  // ------------------------------------------------------------------ //
  it("el defecto es EXACTO: [+100, -100.005] (|diff|=0.005) lanza", () => {
    expect(() => assertBalancedGLEntries([entry(100), entry("-100.005")])).toThrow(/descuadrado/);
  });

  it("el defecto es EXACTO: una diferencia de 0.0001 lanza (el caso real de producción)", () => {
    expect(() => assertBalancedGLEntries([entry(100), entry("-99.9999")])).toThrow(/descuadrado/);
  });

  it("el defecto es EXACTO: un asiento que suma 0 exacto con 4 decimales no lanza", () => {
    expect(() => assertBalancedGLEntries([entry("1234.5678"), entry("-1234.5678")])).not.toThrow();
  });

  // ------------------------------------------------------------------ //
  // 5. Una tolerancia explícita sigue funcionando para quien la pida
  // ------------------------------------------------------------------ //
  it("tolerancia explícita 0.01: [+100, -100.005] no lanza, [+100, -99.989] sí", () => {
    const tol = new Decimal("0.01");
    expect(() => assertBalancedGLEntries([entry(100), entry("-100.005")], tol)).not.toThrow();
    expect(() => assertBalancedGLEntries([entry(100), entry("-99.989")], tol)).toThrow(
      /descuadrado/
    );
  });

  // ------------------------------------------------------------------ //
  // 6. Tolerancia personalizada: [+100, -95] con tolerance=5.01 → no lanza
  // ------------------------------------------------------------------ //
  it("tolerancia personalizada: [+100, -95] con tolerance=new Decimal('5.01') → no lanza", () => {
    // |100 + (-95)| = 5.00 ≤ 5.01
    expect(() =>
      assertBalancedGLEntries([entry(100), entry(-95)], new Decimal("5.01"))
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
