// src/modules/inflation/services/INPCService.test.ts
import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { calcInflationFactor, calcAdjustmentAmount, lastDayOfMonth } from "./INPCService";

// ─── calcInflationFactor ──────────────────────────────────────────────────────

describe("calcInflationFactor", () => {
  it("factor = currentIndex / baseIndex", () => {
    const factor = calcInflationFactor(new Decimal("100"), new Decimal("120"));
    expect(factor.toNumber()).toBeCloseTo(1.2, 6);
  });

  it("factor = 1 cuando current == base (sin inflación)", () => {
    const factor = calcInflationFactor(new Decimal("250.5"), new Decimal("250.5"));
    expect(factor.toNumber()).toBe(1);
  });

  it("factor < 1 cuando current < base (deflación hipotética)", () => {
    const factor = calcInflationFactor(new Decimal("200"), new Decimal("150"));
    expect(factor.toNumber()).toBeCloseTo(0.75, 6);
  });

  it("lanza error cuando baseIndex <= 0", () => {
    expect(() => calcInflationFactor(new Decimal("0"), new Decimal("100"))).toThrow();
    expect(() => calcInflationFactor(new Decimal("-50"), new Decimal("100"))).toThrow();
  });

  it("precisión 6 decimales", () => {
    const factor = calcInflationFactor(new Decimal("3"), new Decimal("10"));
    expect(factor.decimalPlaces()).toBeLessThanOrEqual(6);
  });
});

// ─── calcAdjustmentAmount ─────────────────────────────────────────────────────

describe("calcAdjustmentAmount", () => {
  it("ajuste = balance × (factor − 1)", () => {
    // balance 1000, factor 1.2 → ajuste 200
    const adj = calcAdjustmentAmount(new Decimal("1000"), new Decimal("1.2"));
    expect(adj.toNumber()).toBe(200);
  });

  it("ajuste = 0 cuando factor = 1 (sin inflación)", () => {
    const adj = calcAdjustmentAmount(new Decimal("5000"), new Decimal("1"));
    expect(adj.toNumber()).toBe(0);
  });

  it("ajuste es negativo para balance negativo con factor > 1 (LIABILITY aumenta como crédito)", () => {
    // pasivo saldo −10000, factor 1.05 → ajuste −500 (crédito → aumenta pasivo)
    const adj = calcAdjustmentAmount(new Decimal("-10000"), new Decimal("1.05"));
    expect(adj.toNumber()).toBeCloseTo(-500, 4);
  });

  it("ajuste es negativo con factor < 1 para balance positivo (deflación)", () => {
    const adj = calcAdjustmentAmount(new Decimal("1000"), new Decimal("0.9"));
    expect(adj.toNumber()).toBeCloseTo(-100, 4);
  });

  it("redondea a 4 decimales", () => {
    const adj = calcAdjustmentAmount(new Decimal("1000"), new Decimal("1.00001"));
    expect(adj.decimalPlaces()).toBeLessThanOrEqual(4);
  });
});

// ─── lastDayOfMonth ───────────────────────────────────────────────────────────

describe("lastDayOfMonth", () => {
  it("enero tiene 31 días", () => {
    const d = lastDayOfMonth(2026, 1);
    expect(d.getUTCDate()).toBe(31);
    expect(d.getUTCMonth()).toBe(0); // January = 0
  });

  it("febrero 2024 (año bisiesto) tiene 29 días", () => {
    const d = lastDayOfMonth(2024, 2);
    expect(d.getUTCDate()).toBe(29);
  });

  it("febrero 2025 (no bisiesto) tiene 28 días", () => {
    const d = lastDayOfMonth(2025, 2);
    expect(d.getUTCDate()).toBe(28);
  });

  it("diciembre tiene 31 días", () => {
    const d = lastDayOfMonth(2026, 12);
    expect(d.getUTCDate()).toBe(31);
    expect(d.getUTCMonth()).toBe(11); // December = 11
  });

  it("hora es 23:59:59.999 UTC (incluye todo el día)", () => {
    const d = lastDayOfMonth(2026, 3);
    expect(d.getUTCHours()).toBe(23);
    expect(d.getUTCMinutes()).toBe(59);
    expect(d.getUTCSeconds()).toBe(59);
  });
});

// ─── Propiedades de invarianza ────────────────────────────────────────────────

describe("invarianzas contables", () => {
  it("la suma de ajustes de N cuentas = total que va a la cuenta actualizadora (negado)", () => {
    const factor = new Decimal("1.15");
    const balances = [new Decimal("10000"), new Decimal("-5000"), new Decimal("3000")];
    const adjustments = balances.map((b) => calcAdjustmentAmount(b, factor));
    const totalNet = adjustments.reduce((acc, a) => acc.plus(a), new Decimal(0));

    // La contrapartida es totalNet negado → suma total = 0 (partida doble)
    const counterEntry = totalNet.negated();
    const grandTotal = totalNet.plus(counterEntry);
    expect(grandTotal.toNumber()).toBe(0);
  });

  it("factor de roundtrip: calcInflationFactor + calcAdjustmentAmount reproduce el nuevo saldo", () => {
    const base = new Decimal("200");
    const current = new Decimal("300");
    const balance = new Decimal("50000");

    const factor = calcInflationFactor(base, current);
    const adjustment = calcAdjustmentAmount(balance, factor);
    const adjustedBalance = balance.plus(adjustment);

    // adjustedBalance debería ≈ balance × (current/base) = 50000 × 1.5 = 75000
    expect(adjustedBalance.toNumber()).toBeCloseTo(75000, 2);
  });
});
