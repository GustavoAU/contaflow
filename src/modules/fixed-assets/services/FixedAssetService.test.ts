// src/modules/fixed-assets/services/FixedAssetService.test.ts
import { describe, it, expect, vi } from "vitest";
import { Decimal } from "decimal.js";
import {
  calcMonthlyDepreciation,
  calcDepreciationForPeriod,
  generateDepreciationSchedule,
  FixedAssetService,
} from "./FixedAssetService";
import { postDepreciation } from "./FixedAssetDepreciationService";
import type { FixedAsset } from "@prisma/client";

// ─── Fixture helper ───────────────────────────────────────────────────────────

function makeAsset(
  overrides: Partial<
    Pick<
      FixedAsset,
      | "acquisitionCost"
      | "residualValue"
      | "usefulLifeMonths"
      | "depreciationMethod"
      | "totalUnits"
      | "acquisitionDate"
    >
  >
): Pick<
  FixedAsset,
  | "acquisitionCost"
  | "residualValue"
  | "usefulLifeMonths"
  | "depreciationMethod"
  | "totalUnits"
  | "acquisitionDate"
> {
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
    // (12000 − 2000) / 12 = 833.3333… → ADR-058 R-1: la cuota (monto de documento) se
    // redondea a 2 decimales HALF_UP en origen = 833.33 (antes se guardaba 833.3333).
    const amount = calcMonthlyDepreciation(asset, 1);
    expect(amount.toNumber()).toBe(833.33);
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

// ─── FixedAssetService.create — GL posting (hallazgo #8) ─────────────────────

describe("FixedAssetService.create — GL posting adquisición", () => {
  function makeTx(txCreate = vi.fn().mockResolvedValue({ id: "gl-tx-1" })) {
    return {
      fixedAsset: { create: vi.fn().mockResolvedValue({ id: "asset-1" }) },
      transaction: { create: txCreate, count: vi.fn().mockResolvedValue(5) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      // Guard de cuentas ajenas (2026-09-05): por defecto, todas las cuentas
      // pedidas existen y son de esta empresa.
      account: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => ({ id }))
        ),
      },
    };
  }

  const BASE = {
    companyId: "c-1",
    name: "Compresor",
    assetAccountId: "acc-asset",
    depreciationAccountId: "acc-dep-exp",
    accDepreciationAccountId: "acc-acc-dep",
    acquisitionDate: new Date("2026-01-01"),
    acquisitionCost: "30000.00",
    acquisitionCurrency: "VES" as const,
    residualValue: "0",
    usefulLifeMonths: 12,
    depreciationMethod: "LINEA_RECTA" as const,
  };

  it("crea asiento GL Dr Activos / Cr Contrapartida cuando acquisitionCounterpartAccountId está presente", async () => {
    const txCreate = vi.fn().mockResolvedValue({ id: "gl-tx-1" });
    const tx = makeTx(txCreate);

    await FixedAssetService.create(
      { ...BASE, acquisitionCounterpartAccountId: "acc-cxp" },
      "user-1",
      tx as never
    );

    expect(txCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entries: {
            create: expect.arrayContaining([
              expect.objectContaining({ accountId: "acc-asset" }), // Dr
              expect.objectContaining({ accountId: "acc-cxp" }), // Cr
            ]),
          },
        }),
      })
    );
  });

  it("NO crea asiento GL si acquisitionCounterpartAccountId es null", async () => {
    const txCreate = vi.fn().mockResolvedValue({ id: "gl-tx-1" });
    const tx = makeTx(txCreate);

    await FixedAssetService.create(
      { ...BASE, acquisitionCounterpartAccountId: null },
      "user-1",
      tx as never
    );

    expect(txCreate).not.toHaveBeenCalled();
  });

  it("NO crea asiento GL si acquisitionCounterpartAccountId se omite (campo opcional)", async () => {
    const txCreate = vi.fn().mockResolvedValue({ id: "gl-tx-1" });
    const tx = makeTx(txCreate);

    await FixedAssetService.create(BASE, "user-1", tx as never);

    expect(txCreate).not.toHaveBeenCalled();
  });

  it("RECHAZA si alguna cuenta GL no pertenece a esta empresa (hallazgo security-agent 2026-09-05)", async () => {
    const tx = makeTx();
    tx.account.findMany = vi.fn().mockResolvedValue([]); // ninguna de las 3 es de company

    await expect(FixedAssetService.create(BASE, "user-1", tx as never)).rejects.toThrow(
      /no pertenece(n)? a esta empresa/
    );
    expect(tx.fixedAsset.create).not.toHaveBeenCalled();
  });
});

// ─── FixedAssetService.postINPCRestatement — guard de cuenta ajena ───────────
// El guard es lo primero que corre en la función (antes de leer el índice
// INPC), así que un tx mínimo basta para probar el rechazo.

describe("FixedAssetService.postINPCRestatement", () => {
  it("RECHAZA si patrimonioAccountId no pertenece a esta empresa (hallazgo security-agent 2026-09-05)", async () => {
    const tx = { account: { findMany: vi.fn().mockResolvedValue([]) } };

    await expect(
      FixedAssetService.postINPCRestatement(
        {
          companyId: "company-1",
          periodYear: 2026,
          periodMonth: 8,
          patrimonioAccountId: "acc-ajena",
        } as never,
        "user-1",
        tx as never
      )
    ).rejects.toThrow(/no existe o no pertenece/);
  });
});

// ─── ADR-058 R-1: cuotas al céntimo, suma EXACTA = depreciable ──────────────

describe("Depreciación al céntimo (ADR-058 R-1) — la suma de las cuotas es exactamente el depreciable", () => {
  const cases: { cost: string; residual: string; months: number; method: string }[] = [
    { cost: "1000", residual: "0", months: 3, method: "LINEA_RECTA" },
    { cost: "100", residual: "0", months: 7, method: "LINEA_RECTA" },
    { cost: "1234.56", residual: "0", months: 12, method: "LINEA_RECTA" },
    { cost: "1234.56", residual: "34.56", months: 7, method: "LINEA_RECTA" },
    { cost: "1000", residual: "100", months: 7, method: "SUMA_DIGITOS" },
    { cost: "1234.56", residual: "0", months: 11, method: "SUMA_DIGITOS" },
  ];

  it.each(cases)("$method costo $cost residual $residual en $months meses", (c) => {
    const asset = makeAsset({
      acquisitionCost: new Decimal(c.cost) as never,
      residualValue: new Decimal(c.residual) as never,
      usefulLifeMonths: c.months,
      depreciationMethod: c.method as never,
    });
    const depreciable = new Decimal(c.cost).minus(c.residual);
    const schedule = generateDepreciationSchedule(asset);
    expect(schedule).toHaveLength(c.months);

    const total = schedule.reduce((acc, r) => acc.plus(r.amount), new Decimal(0));
    expect(total.equals(depreciable)).toBe(true); // exacto, sin tolerancia

    for (const r of schedule) {
      // cada monto de documento es múltiplo de 0,01
      expect(r.amount.equals(r.amount.toDecimalPlaces(2))).toBe(true);
      expect(r.accumulated.equals(r.accumulated.toDecimalPlaces(2))).toBe(true);
      expect(r.bookValue.equals(r.bookValue.toDecimalPlaces(2))).toBe(true);
    }
    const last = schedule[schedule.length - 1]!;
    expect(last.bookValue.equals(new Decimal(c.residual))).toBe(true); // valor residual exacto
    expect(last.accumulated.equals(depreciable)).toBe(true);
  });

  it("1000 en 3 meses = 333.33 + 333.33 + 333.34 (la última cuota es el remanente)", () => {
    const asset = makeAsset({
      acquisitionCost: new Decimal("1000") as never,
      usefulLifeMonths: 3,
    });
    const amounts = generateDepreciationSchedule(asset).map((r) => r.amount.toFixed(2));
    expect(amounts).toEqual(["333.33", "333.33", "333.34"]);
  });

  it("postDepreciation: asiento y DepreciationEntry con la cuota a 2 decimales; asiento suma 0 y sin noAbsorb", async () => {
    const txCreate = vi.fn().mockResolvedValue({ id: "gl-1" });
    const entryCreate = vi.fn().mockResolvedValue({ id: "dep-1" });
    const tx = {
      depreciationEntry: {
        findUnique: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: new Decimal("666.66") } }),
        create: entryCreate,
      },
      fixedAsset: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "asset-1",
          name: "Equipo",
          status: "ACTIVE",
          acquisitionCost: new Decimal("1000"),
          residualValue: new Decimal("0"),
          usefulLifeMonths: 3,
          depreciationMethod: "LINEA_RECTA",
          totalUnits: null,
          acquisitionDate: new Date("2026-01-01T00:00:00Z"),
          depreciationAccountId: "acc-exp",
          accDepreciationAccountId: "acc-acc",
        }),
        update: vi.fn(),
      },
      transaction: { create: txCreate },
    };
    // month1 = 3 (abril vs enero): última cuota = remanente 333.34 (1000 − 666.66)
    const res = await postDepreciation("asset-1", "c-1", 2026, 4, "u-1", tx as never);
    expect(res.entry.amount.toFixed(2)).toBe("333.34");

    const lines = txCreate.mock.calls[0]![0].data.entries.create as {
      amount: Decimal;
    }[];
    const sum = lines.reduce((a, l) => a.plus(l.amount), new Decimal(0));
    expect(sum.isZero()).toBe(true);
    for (const l of lines) {
      expect(l.amount.equals(l.amount.toDecimalPlaces(2))).toBe(true);
      expect("noAbsorb" in l).toBe(false);
    }
    const data = entryCreate.mock.calls[0]![0].data;
    expect(new Decimal(data.accumulatedDepreciation).toFixed(2)).toBe("1000.00");
    expect(new Decimal(data.bookValue).toFixed(2)).toBe("0.00");
  });
});

describe("FixedAssetService.create — ADR-058 cuantización del asiento de adquisición", () => {
  it("costo con muchos decimales: líneas múltiplos de 0,01, Σ = 0 exacto, sin noAbsorb", async () => {
    const txCreate = vi.fn().mockResolvedValue({ id: "gl-1" });
    const tx = {
      fixedAsset: { create: vi.fn().mockResolvedValue({ id: "asset-1" }) },
      transaction: { create: txCreate, count: vi.fn().mockResolvedValue(0) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      account: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => ({ id }))
        ),
      },
    };
    await FixedAssetService.create(
      {
        companyId: "c-1",
        name: "Equipo",
        assetAccountId: "acc-asset",
        depreciationAccountId: "acc-dep",
        accDepreciationAccountId: "acc-acc",
        acquisitionCounterpartAccountId: "acc-cxp",
        acquisitionDate: new Date("2026-01-01"),
        acquisitionCost: "1234.56789",
        acquisitionCurrency: "VES",
        residualValue: "0",
        usefulLifeMonths: 12,
        depreciationMethod: "LINEA_RECTA",
      } as never,
      "u-1",
      tx as never
    );
    const lines = txCreate.mock.calls[0]![0].data.entries.create as { amount: Decimal }[];
    expect(lines.reduce((a, l) => a.plus(l.amount), new Decimal(0)).isZero()).toBe(true);
    expect(lines[0]!.amount.toFixed(2)).toBe("1234.57");
    for (const l of lines) {
      expect(l.amount.equals(l.amount.toDecimalPlaces(2))).toBe(true);
      expect("noAbsorb" in l).toBe(false);
    }
  });
});

describe("FixedAssetService.postINPCRestatement — ADR-058 asiento al céntimo", () => {
  it("costos históricos a 4 decimales: asiento múltiplos de 0,01, Σ = 0, sin noAbsorb", async () => {
    const txCreate = vi.fn().mockResolvedValue({ id: "gl-1" });
    const mkAsset = (id: string, cost: string) => ({
      id,
      name: id,
      assetAccountId: `acc-${id}`,
      acquisitionCost: new Decimal(cost),
      acquisitionDate: new Date("2026-01-15T00:00:00Z"),
    });
    const tx = {
      account: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => ({ id }))
        ),
      },
      iNPCRate: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ year: 2026, month: 8, indexValue: new Decimal("137.7777") }),
        findMany: vi.fn().mockResolvedValue([
          { year: 2026, month: 1, indexValue: new Decimal("100.1234") },
          { year: 2026, month: 8, indexValue: new Decimal("137.7777") },
        ]),
      },
      fixedAsset: {
        findMany: vi
          .fn()
          .mockResolvedValue([mkAsset("a1", "1234.5678"), mkAsset("a2", "999.9999")]),
      },
      fixedAssetINPCRestatement: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn().mockResolvedValue({}),
      },
      transaction: { create: txCreate, count: vi.fn().mockResolvedValue(0) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const res = await FixedAssetService.postINPCRestatement(
      {
        companyId: "c-1",
        periodYear: 2026,
        periodMonth: 8,
        patrimonioAccountId: "acc-eq",
      } as never,
      "u-1",
      tx as never
    );
    expect(res.processed).toBe(2);
    const lines = txCreate.mock.calls[0]![0].data.entries.create as { amount: Decimal }[];
    expect(lines).toHaveLength(4);
    expect(lines.reduce((a, l) => a.plus(l.amount), new Decimal(0)).isZero()).toBe(true);
    for (const l of lines) {
      expect(l.amount.equals(l.amount.toDecimalPlaces(2))).toBe(true);
      expect("noAbsorb" in l).toBe(false);
    }
  });
});
