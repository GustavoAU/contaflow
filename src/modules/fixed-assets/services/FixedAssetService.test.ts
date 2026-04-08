// src/modules/fixed-assets/services/FixedAssetService.test.ts
import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import {
  calcMonthlyDepreciation,
  calcDepreciationForPeriod,
  generateDepreciationSchedule,
} from "./FixedAssetService";
import type { FixedAsset } from "@prisma/client";

// ─── Fixture helper ───────────────────────────────────────────────────────────

function makeAsset(overrides: Partial<
  Pick<FixedAsset, "acquisitionCost" | "residualValue" | "usefulLifeMonths" | "depreciationMethod" | "totalUnits" | "acquisitionDate">
>): Pick<FixedAsset, "acquisitionCost" | "residualValue" | "usefulLifeMonths" | "depreciationMethod" | "totalUnits" | "acquisitionDate"> {
  return {
    acquisitionCost: new Decimal("12000.00") as never,
    residualValue: new Decimal("0.00") as never,
    usefulLifeMonths: 12,
    depreciationMethod: "LINEA_RECTA",
    totalUnits: null,
    acquisitionDate: new Date("2026-01-01"),
    ...overrides,
  };
}

// ─── LÍNEA RECTA ─────────────────────────────────────────────────────────────

describe("calcMonthlyDepreciation — LINEA_RECTA", () => {
  it("cuota mensual = (costo − residual) / vida útil", () => {
    const asset = makeAsset({});
    // (12000 − 0) / 12 = 1000/mes
    expect(calcMonthlyDepreciation(asset, 1).toNumber()).toBe(1000);
    expect(calcMonthlyDepreciation(asset, 6).toNumber()).toBe(1000);
    expect(calcMonthlyDepreciation(asset, 12).toNumber()).toBe(1000);
  });

  it("cuota considera valor residual", () => {
    const asset = makeAsset({ residualValue: new Decimal("2000") as never });
    // (12000 − 2000) / 12 = 833.3333
    const amount = calcMonthlyDepreciation(asset, 1);
    expect(amount.toDecimalPlaces(4).toNumber()).toBe(833.3333);
  });

  it("retorna 0 cuando month1 > usefulLifeMonths", () => {
    const asset = makeAsset({});
    expect(calcMonthlyDepreciation(asset, 13).toNumber()).toBe(0);
    expect(calcMonthlyDepreciation(asset, 24).toNumber()).toBe(0);
  });

  it("retorna 0 cuando depreciable <= 0 (costo = residual)", () => {
    const asset = makeAsset({ residualValue: new Decimal("12000") as never });
    expect(calcMonthlyDepreciation(asset, 1).toNumber()).toBe(0);
  });
});

// ─── SUMA DE DÍGITOS ─────────────────────────────────────────────────────────

describe("calcMonthlyDepreciation — SUMA_DIGITOS", () => {
  it("primer mes tiene cuota más alta, último mes tiene la más baja", () => {
    const asset = makeAsset({ depreciationMethod: "SUMA_DIGITOS" });
    const month1 = calcMonthlyDepreciation(asset, 1);
    const month12 = calcMonthlyDepreciation(asset, 12);
    expect(month1.greaterThan(month12)).toBe(true);
  });

  it("suma de todas las cuotas SDA = depreciable total", () => {
    const asset = makeAsset({ depreciationMethod: "SUMA_DIGITOS" });
    let total = new Decimal(0);
    for (let m = 1; m <= 12; m++) {
      total = total.plus(calcMonthlyDepreciation(asset, m));
    }
    // Tolerancia por redondeo: diferencia < 0.01
    expect(Math.abs(total.toNumber() - 12000)).toBeLessThan(0.01);
  });

  it("cuota mes 1 con n=3: peso = 3/(1+2+3) = 3/6 = 0.5", () => {
    // activo 3 meses, costo 6000, residual 0 → depreciable 6000
    // mes 1: 6000 × 3/6 = 3000
    const asset = makeAsset({
      acquisitionCost: new Decimal("6000") as never,
      usefulLifeMonths: 3,
      depreciationMethod: "SUMA_DIGITOS",
    });
    expect(calcMonthlyDepreciation(asset, 1).toNumber()).toBe(3000);
    // mes 2: 6000 × 2/6 = 2000
    expect(calcMonthlyDepreciation(asset, 2).toNumber()).toBe(2000);
    // mes 3: 6000 × 1/6 = 1000
    expect(calcMonthlyDepreciation(asset, 3).toNumber()).toBe(1000);
  });
});

// ─── UNIDADES DE PRODUCCIÓN ──────────────────────────────────────────────────

describe("calcMonthlyDepreciation — UNIDADES_PRODUCCION", () => {
  it("cuota = (depreciable / totalUnits) × unidadesUsadas", () => {
    const asset = makeAsset({
      depreciationMethod: "UNIDADES_PRODUCCION",
      totalUnits: 1000,
    });
    // 12000 / 1000 = 12 por unidad; 100 unidades = 1200
    expect(calcMonthlyDepreciation(asset, 1, 100).toNumber()).toBe(1200);
  });

  it("retorna 0 si totalUnits es null", () => {
    const asset = makeAsset({
      depreciationMethod: "UNIDADES_PRODUCCION",
      totalUnits: null,
    });
    expect(calcMonthlyDepreciation(asset, 1, 100).toNumber()).toBe(0);
  });

  it("retorna 0 si unitsThisPeriod = 0", () => {
    const asset = makeAsset({ depreciationMethod: "UNIDADES_PRODUCCION", totalUnits: 1000 });
    expect(calcMonthlyDepreciation(asset, 1, 0).toNumber()).toBe(0);
  });
});

// ─── calcDepreciationForPeriod ───────────────────────────────────────────────

describe("calcDepreciationForPeriod", () => {
  it("acumula correctamente mes a mes (LINEA_RECTA)", () => {
    const asset = makeAsset({});
    let acc = new Decimal(0);
    for (let m = 1; m <= 12; m++) {
      const calc = calcDepreciationForPeriod(asset, m, acc);
      expect(calc.amount.toNumber()).toBe(1000);
      acc = calc.accumulated;
    }
    expect(acc.toNumber()).toBe(12000);
  });

  it("no deprecia más allá del valor depreciable (cap en último mes)", () => {
    // 12000, 12 meses, 11 meses ya depreciados manualmente casi completos
    const asset = makeAsset({});
    const prevAccumulated = new Decimal("11999.50"); // casi todo depreciado
    const calc = calcDepreciationForPeriod(asset, 12, prevAccumulated);
    // Solo puede depreciar 0.50 restante
    expect(calc.amount.toNumber()).toBe(0.5);
    expect(calc.accumulated.toNumber()).toBe(12000);
    expect(calc.bookValue.toNumber()).toBe(0);
  });

  it("bookValue = acquisitionCost − accumulated", () => {
    const asset = makeAsset({});
    const calc = calcDepreciationForPeriod(asset, 1, new Decimal(0));
    expect(calc.bookValue.toNumber()).toBe(11000); // 12000 − 1000
  });
});

// ─── generateDepreciationSchedule ────────────────────────────────────────────

describe("generateDepreciationSchedule", () => {
  it("genera exactamente usefulLifeMonths filas para LINEA_RECTA", () => {
    const asset = makeAsset({ usefulLifeMonths: 12 });
    const schedule = generateDepreciationSchedule(asset);
    expect(schedule).toHaveLength(12);
  });

  it("la última fila tiene bookValue = residualValue", () => {
    const asset = makeAsset({ residualValue: new Decimal("1000") as never });
    const schedule = generateDepreciationSchedule(asset);
    const last = schedule[schedule.length - 1]!;
    expect(last.bookValue.toNumber()).toBeCloseTo(1000, 1);
  });

  it("la suma de amounts = depreciable (LINEA_RECTA, sin residual)", () => {
    const asset = makeAsset({ usefulLifeMonths: 24 });
    const schedule = generateDepreciationSchedule(asset);
    const total = schedule.reduce((acc, r) => acc.plus(r.amount), new Decimal(0));
    expect(total.toNumber()).toBeCloseTo(12000, 1);
  });

  it("el primer mes es el siguiente a la adquisición", () => {
    const asset = makeAsset({ acquisitionDate: new Date("2026-01-15") });
    const schedule = generateDepreciationSchedule(asset);
    expect(schedule[0]!.year).toBe(2026);
    expect(schedule[0]!.month).toBe(2); // febrero = mes siguiente
  });

  it("cruza correctamente de diciembre a enero del año siguiente", () => {
    const asset = makeAsset({ acquisitionDate: new Date("2026-11-01"), usefulLifeMonths: 3 });
    const schedule = generateDepreciationSchedule(asset);
    // mes 1 = dic 2026, mes 2 = ene 2027, mes 3 = feb 2027
    expect(schedule[0]!).toMatchObject({ year: 2026, month: 12 });
    expect(schedule[1]!).toMatchObject({ year: 2027, month: 1 });
    expect(schedule[2]!).toMatchObject({ year: 2027, month: 2 });
  });
});
