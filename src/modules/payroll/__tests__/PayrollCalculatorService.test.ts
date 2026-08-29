// src/modules/payroll/__tests__/PayrollCalculatorService.test.ts
// Fase NOM-C: Tests del motor de cálculo puro (sin DB, sin mocks de Prisma)

import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import type { SalaryNature } from "@prisma/client";
import {
  PayrollCalculatorService,
  contributableWeeks,
  weeklyWageFrom,
  type EmployeeCalculationInput,
  type PayrollCalculatorConfig,
  type ManualConceptCalculationInput,
  type SystemConceptRef,
  MISSING_USD_RATE_MESSAGE,
  MIXED_SALARY_MESSAGE,
} from "../services/PayrollCalculatorService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SYSTEM_CONCEPTS: SystemConceptRef[] = [
  { code: "SAL_BASE", conceptId: "c-sal-base", salaryNature: "SALARIO_NORMAL" },
  { code: "HE_DIURNA", conceptId: "c-he-diurna", salaryNature: "SALARIAL_ACCIDENTAL" },
  { code: "HE_NOCTURNA", conceptId: "c-he-noc", salaryNature: "SALARIAL_ACCIDENTAL" },
  { code: "IVSS_OBR", conceptId: "c-ivss", salaryNature: "NO_SALARIAL" },
  { code: "INCES_OBR", conceptId: "c-inces", salaryNature: "NO_SALARIAL" },
  { code: "FAOV_OBR", conceptId: "c-faov", salaryNature: "NO_SALARIAL" },
  { code: "RPE_OBR", conceptId: "c-rpe", salaryNature: "NO_SALARIAL" },
];

const BASE_CONFIG: PayrollCalculatorConfig = {
  frequency: "MONTHLY",
  ivssEnabled: true,
  incesEnabled: true,
  banavihEnabled: true,
  rpeEnabled: true,
  salaryMinimumVes: new Decimal(0), // sin tope — retro-compatible
  // Marzo de 2026 tiene CINCO lunes (2, 9, 16, 23 y 30): el IVSS se cotiza por
  // semana (Reglamento Art. 99), asi que el mes no vale siempre lo mismo.
  periodStart: new Date("2026-03-01T00:00:00Z"),
  periodEnd: new Date("2026-03-31T00:00:00Z"),
  // Ley INCES Art. 49: por encima del umbral de cinco, asi que el aporte
  // patronal al INCES aplica salvo que un test diga lo contrario.
  activeEmployeeCount: 10,
  systemConcepts: SYSTEM_CONCEPTS,
};

function makeEmp(overrides: Partial<EmployeeCalculationInput> = {}): EmployeeCalculationInput {
  return {
    employeeId: "emp-1",
    salaryHistoryId: "sal-1",
    salaryAmount: new Decimal("30000"),
    salaryCurrency: "VES",
    overtimeHoursDay: new Decimal(0),
    overtimeHoursNight: new Decimal(0),
    absenceDays: new Decimal(0),
    ...overrides,
  };
}

// ─── SAL_BASE ─────────────────────────────────────────────────────────────────

describe("PayrollCalculatorService — SAL_BASE", () => {
  it("calcula salario base sin ausencias", () => {
    const emp = makeEmp();
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, BASE_CONFIG);
    const sal = lines.find((l) => l.conceptCode === "SAL_BASE");
    expect(sal).toBeDefined();
    expect(sal!.conceptType).toBe("EARNING");
    expect(sal!.amount.toFixed(2)).toBe("30000.00");
    expect(sal!.salarySnapshotAmount.toFixed(2)).toBe("30000.00");
  });

  it("descuenta días de ausencia injustificada proporcionalmente", () => {
    const emp = makeEmp({ absenceDays: new Decimal(3) });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, BASE_CONFIG);
    const sal = lines.find((l) => l.conceptCode === "SAL_BASE");
    // 30000 * (30-3)/30 = 30000 * 27/30 = 27000
    expect(sal!.amount.toFixed(2)).toBe("27000.00");
  });

  it("con 30 días de ausencia el salario base es 0", () => {
    const emp = makeEmp({ absenceDays: new Decimal(30) });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, BASE_CONFIG);
    const sal = lines.find((l) => l.conceptCode === "SAL_BASE");
    expect(sal!.amount.toFixed(2)).toBe("0.00");
  });
});

// ─── Horas Extra ──────────────────────────────────────────────────────────────

describe("PayrollCalculatorService — HE_DIURNA", () => {
  it("calcula horas extra diurnas (50% recargo LOTTT)", () => {
    const emp = makeEmp({ overtimeHoursDay: new Decimal(8) });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, BASE_CONFIG);
    const he = lines.find((l) => l.conceptCode === "HE_DIURNA");
    // salarioHora = 30000/30/8 = 125
    // monto = 125 * 1.5 * 8 = 1500
    expect(he!.amount.toFixed(2)).toBe("1500.00");
    expect(he!.hours!.toFixed(0)).toBe("8");
    expect(he!.rate!.toFixed(1)).toBe("1.5");
  });

  it("sin horas extra no genera línea HE_DIURNA", () => {
    const emp = makeEmp({ overtimeHoursDay: new Decimal(0) });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, BASE_CONFIG);
    expect(lines.find((l) => l.conceptCode === "HE_DIURNA")).toBeUndefined();
  });
});

describe("PayrollCalculatorService — HE_NOCTURNA", () => {
  it("acumula el recargo nocturno y el de hora extra (Arts. 117 y 118)", () => {
    // La hora es nocturna Y extraordinaria: 1,30 × 1,50 = 1,95 sobre la hora
    // ordinaria diurna. El codigo traia 1,75, por debajo del piso legal.
    const emp = makeEmp({ overtimeHoursNight: new Decimal(4) });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, BASE_CONFIG);
    const he = lines.find((l) => l.conceptCode === "HE_NOCTURNA");
    // 125 × 1,95 × 4 = 975
    expect(he!.amount.toFixed(2)).toBe("975.00");
    expect(he!.rate!.toFixed(2)).toBe("1.95");
  });

  it("la nocturna paga mas que la diurna, y por el 30% del Art. 117", () => {
    const emp = makeEmp({
      overtimeHoursDay: new Decimal(4), overtimeHoursNight: new Decimal(4),
    });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, BASE_CONFIG);
    const dia = lines.find((l) => l.conceptCode === "HE_DIURNA")!.amount;
    const noche = lines.find((l) => l.conceptCode === "HE_NOCTURNA")!.amount;
    expect(noche.greaterThan(dia)).toBe(true);
    expect(noche.dividedBy(dia).toFixed(2)).toBe("1.30");
  });
});

// ─── Deducciones IVSS / INCES / FAOV ─────────────────────────────────────────

describe("PayrollCalculatorService — IVSS_OBR", () => {
  it("calcula IVSS 4% del salario", () => {
    const emp = makeEmp();
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, BASE_CONFIG);
    const ivss = lines.find((l) => l.conceptCode === "IVSS_OBR");
    expect(ivss!.conceptType).toBe("DEDUCTION");
    // 30000 x 12/52 x 5 semanas = 34.615,38 -> 4% = 1.384,62
    expect(ivss!.basis!.toFixed(2)).toBe("34615.38");
    expect(ivss!.amount.toFixed(2)).toBe("1384.62");
    expect(ivss!.rate!.toFixed(2)).toBe("0.04");
  });

  it("no genera IVSS si ivssEnabled = false", () => {
    const config = { ...BASE_CONFIG, ivssEnabled: false };
    const lines = PayrollCalculatorService.calculateEmployeeLines(makeEmp(), config);
    expect(lines.find((l) => l.conceptCode === "IVSS_OBR")).toBeUndefined();
  });
});

describe("PayrollCalculatorService — INCES_OBR ya no es mensual", () => {
  // Ley INCES Art. 50: el 0,5% del trabajador grava "sus UTILIDADES ANUALES,
  // aguinaldos o bonificaciones de fin de año". Se le venía cobrando doce veces
  // al año sobre el sueldo, una base que el artículo no menciona.
  it("no genera linea de INCES del trabajador en la nomina mensual", () => {
    const lines = PayrollCalculatorService.calculateEmployeeLines(makeEmp(), BASE_CONFIG);
    expect(lines.find((l) => l.conceptCode === "INCES_OBR")).toBeUndefined();
  });

  it("tampoco con incesEnabled — ese flag ya solo gobierna el aporte patronal", () => {
    const config = { ...BASE_CONFIG, incesEnabled: true };
    const lines = PayrollCalculatorService.calculateEmployeeLines(makeEmp(), config);
    expect(lines.find((l) => l.conceptCode === "INCES_OBR")).toBeUndefined();
  });
});

describe("PayrollCalculatorService — FAOV_OBR", () => {
  it("calcula FAOV 1% del salario", () => {
    const lines = PayrollCalculatorService.calculateEmployeeLines(makeEmp(), BASE_CONFIG);
    const faov = lines.find((l) => l.conceptCode === "FAOV_OBR");
    // LRPVH Art. 33.1: la base es el salario INTEGRAL, no el normal.
    // 30000 x (1 + 30/360 + 15/360) = 33750 -> 1% = 337,50
    expect(faov!.amount.toFixed(2)).toBe("337.50");
    expect(faov!.rate!.toFixed(3)).toBe("0.010");
  });

  it("no genera FAOV si banavihEnabled = false", () => {
    const config = { ...BASE_CONFIG, banavihEnabled: false };
    const lines = PayrollCalculatorService.calculateEmployeeLines(makeEmp(), config);
    expect(lines.find((l) => l.conceptCode === "FAOV_OBR")).toBeUndefined();
  });
});

// ─── Guards de validación (NOM-C-05 / NOM-C-10) ───────────────────────────────

describe("PayrollCalculatorService — Guards", () => {
  it("lanza si horas diurnas son negativas (NOM-C-05)", () => {
    const emp = makeEmp({ overtimeHoursDay: new Decimal(-1) });
    expect(() =>
      PayrollCalculatorService.calculateEmployeeLines(emp, BASE_CONFIG)
    ).toThrow("Las horas extra no pueden ser negativas");
  });

  it("lanza si horas nocturnas son negativas (NOM-C-05)", () => {
    const emp = makeEmp({ overtimeHoursNight: new Decimal(-5) });
    expect(() =>
      PayrollCalculatorService.calculateEmployeeLines(emp, BASE_CONFIG)
    ).toThrow("Las horas extra no pueden ser negativas");
  });

  it("lanza si días de ausencia son negativos", () => {
    const emp = makeEmp({ absenceDays: new Decimal(-1) });
    expect(() =>
      PayrollCalculatorService.calculateEmployeeLines(emp, BASE_CONFIG)
    ).toThrow("Los días de ausencia no pueden ser negativos");
  });

  it("lanza si el neto calculado es negativo (NOM-C-10)", () => {
    // Deducción manual enorme que supera el salario
    const emp = makeEmp({ salaryAmount: new Decimal("100") });
    const manuals: ManualConceptCalculationInput[] = [
      {
        conceptId: "c-manual",
        conceptCode: "ISLR_RET",
        conceptType: "DEDUCTION",
        employeeId: "emp-1",
        amount: new Decimal("999999"),
        salaryNature: "NO_SALARIAL",
      },
    ];
    expect(() =>
      PayrollCalculatorService.calculate([emp], manuals, BASE_CONFIG)
    ).toThrow("El neto a pagar no puede ser negativo");
  });
});

// ─── calculate — integración completa ────────────────────────────────────────

describe("PayrollCalculatorService.calculate", () => {
  it("calcula correctamente para un empleado sin novedades", () => {
    const result = PayrollCalculatorService.calculate([makeEmp()], [], BASE_CONFIG);
    // totalEarnings = 30000 (SAL_BASE)
    // totalDeductions = 1.384,62 (IVSS 4% semanal) + 337,50 (FAOV 1% del integral)
    //                 + 150 (RPE 0,5% mensual) = 1.872,12
    // El INCES obrero ya no se retiene mes a mes (Art. 50).
    expect(result.totalEarnings.toFixed(2)).toBe("30000.00");
    expect(result.totalDeductions.toFixed(2)).toBe("1872.12");
    expect(result.totalNet.toFixed(2)).toBe("28127.88");
  });

  it("incluye conceptos manuales en el cálculo", () => {
    const manuals: ManualConceptCalculationInput[] = [
      {
        conceptId: "c-islr",
        conceptCode: "ISLR_RET",
        conceptType: "DEDUCTION",
        employeeId: "emp-1",
        amount: new Decimal("500"),
        salaryNature: "NO_SALARIAL",
      },
    ];
    const result = PayrollCalculatorService.calculate([makeEmp()], manuals, BASE_CONFIG);
    expect(result.totalDeductions.toFixed(2)).toBe("2372.12"); // 1.872,12 + 500
    expect(result.totalNet.toFixed(2)).toBe("27627.88");
  });

  it("calcula múltiples empleados sumando correctamente", () => {
    const emp1 = makeEmp({ employeeId: "emp-1" });
    const emp2 = makeEmp({
      employeeId: "emp-2",
      salaryHistoryId: "sal-2",
      salaryAmount: new Decimal("20000"),
    });
    const result = PayrollCalculatorService.calculate([emp1, emp2], [], BASE_CONFIG);
    // emp1: 30000 -> IVSS 1.384,62 + FAOV 337,50 + RPE 150 = 1.872,12
    // emp2: 20000 -> IVSS   923,08 + FAOV 225,00 + RPE 100 = 1.248,08
    expect(result.totalEarnings.toFixed(2)).toBe("50000.00");
    expect(result.totalDeductions.toFixed(2)).toBe("3120.20");
    expect(result.totalNet.toFixed(2)).toBe("46879.80");
  });

  it("preserva snapshot de salario en cada línea", () => {
    const result = PayrollCalculatorService.calculate([makeEmp()], [], BASE_CONFIG);
    for (const line of result.lines) {
      expect(line.salaryHistoryId).toBe("sal-1");
      expect(line.salarySnapshotAmount.toFixed(2)).toBe("30000.00");
    }
  });

  it("sin conceptos configurados retorna lista vacía", () => {
    const config = { ...BASE_CONFIG, systemConcepts: [] };
    const result = PayrollCalculatorService.calculate([makeEmp()], [], config);
    expect(result.lines).toHaveLength(0);
    expect(result.totalNet.toFixed(2)).toBe("0.00");
  });
});

// ─── RPE_OBR — Paro Forzoso 0.5% (LSSO Art. 7) ──────────────────────────────

describe("PayrollCalculatorService — RPE_OBR", () => {
  it("calcula RPE 0.5% del salario", () => {
    const lines = PayrollCalculatorService.calculateEmployeeLines(makeEmp(), BASE_CONFIG);
    const rpe = lines.find((l) => l.conceptCode === "RPE_OBR");
    expect(rpe).toBeDefined();
    expect(rpe!.conceptType).toBe("DEDUCTION");
    // 30000 * 0.005 = 150
    expect(rpe!.amount.toFixed(2)).toBe("150.00");
    expect(rpe!.rate!.toFixed(3)).toBe("0.005");
  });

  it("no genera RPE si rpeEnabled = false", () => {
    const config = { ...BASE_CONFIG, rpeEnabled: false };
    const lines = PayrollCalculatorService.calculateEmployeeLines(makeEmp(), config);
    expect(lines.find((l) => l.conceptCode === "RPE_OBR")).toBeUndefined();
  });

  it("no genera RPE si RPE_OBR no está en systemConcepts", () => {
    const conceptsWithoutRpe = SYSTEM_CONCEPTS.filter((c) => c.code !== "RPE_OBR");
    const config = { ...BASE_CONFIG, systemConcepts: conceptsWithoutRpe };
    const lines = PayrollCalculatorService.calculateEmployeeLines(makeEmp(), config);
    expect(lines.find((l) => l.conceptCode === "RPE_OBR")).toBeUndefined();
  });
});

// ─── Topes de cotización (salaryMinimumVes > 0) ───────────────────────────────

describe("PayrollCalculatorService — topes de cotización", () => {
  const salaryMin = new Decimal("130"); // salario mínimo de referencia

  it("sin tope (salaryMinimumVes=0): aplica tasa sobre salario completo", () => {
    const salary = new Decimal("1000"); // 7.69× el mínimo — supera topes
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG,
      salaryMinimumVes: new Decimal(0),
    };
    const emp = makeEmp({ salaryAmount: salary });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
    const ivss = lines.find((l) => l.conceptCode === "IVSS_OBR");
    // Sin tope: 1000 x 12/52 x 5 semanas = 1.153,85 -> 4% = 46,15
    expect(ivss!.amount.toFixed(2)).toBe("46.15");
  });

  it("IVSS: capped a 5×salaryMin cuando salario supera el tope", () => {
    const salary = new Decimal("1000");  // supera 5×130=650
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG,
      salaryMinimumVes: salaryMin,
    };
    const emp = makeEmp({ salaryAmount: salary });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
    const ivss = lines.find((l) => l.conceptCode === "IVSS_OBR");
    // El tope del Art. 98 es MENSUAL, asi que se acota el mes y DESPUES se lleva
    // a semanas: min(1000, 5x130) = 650 -> 650 x 12/52 x 5 = 750 -> 4% = 30
    expect(ivss!.basis!.toFixed(2)).toBe("750.00");
    expect(ivss!.amount.toFixed(2)).toBe("30.00");
  });

  it("FAOV: SIN tope - LRPVH reformada (G.O. 6.805)", () => {
    const salary = new Decimal("2000");
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG,
      salaryMinimumVes: salaryMin,
    };
    const emp = makeEmp({ salaryAmount: salary });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
    const faov = lines.find((l) => l.conceptCode === "FAOV_OBR");
    // El tope de 10x venia citado como "LAH Art. 172", una ley que la LRPVH
    // sustituyo. El Art. 33 de la LRPVH (G.O. 6.805 Extr., 01-05-2024) no fija
    // ningun maximo — su numeral 5 fija un PISO ("no podra ser menor al tres por
    // ciento"). La base es el salario integral completo: 2000 x 1,125 = 2250.
    expect(faov!.basis!.toFixed(2)).toBe("2250.00");
    expect(faov!.amount.toFixed(2)).toBe("22.50");
  });

  it("FAOV: cotiza sobre el salario INTEGRAL; las otras tres, sobre el normal", () => {
    // LRPVH Art. 33.1 dice "salario integral"; la LSS, la Ley INCES y la LRPE
    // dicen salario normal, cada una en su propia ley. Que las cuatro bases
    // coincidan seria el sintoma de que alguien las unifico por comodidad.
    const emp = makeEmp({ salaryAmount: new Decimal("30000") });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, CONFIG_WITH_PAT);

    const basisOf = (code: string) => lines.find((l) => l.conceptCode === code)!.basis!;

    // Integral = normal + alicuota de utilidades (30/360) + de bono vacacional
    // (15/360) = 30000 x 1,125 (Art. 122 LOTTT).
    expect(basisOf("FAOV_OBR").toFixed(2)).toBe("33750.00");
    expect(basisOf("FAOV_PAT").toFixed(2)).toBe("33750.00");

    // El RPE y el INCES patronal cotizan sobre el salario normal MENSUAL.
    expect(basisOf("RPE_OBR").toFixed(2)).toBe("30000.00");
    expect(basisOf("INCES_PAT").toFixed(2)).toBe("30000.00");
    // El IVSS parte del mismo salario normal pero lo lleva a semanas (Art. 99):
    // 30000 x 12/52 x 5 = 34.615,38. Tres bases distintas, tres leyes distintas.
    expect(basisOf("IVSS_OBR").toFixed(2)).toBe("34615.38");
  });

  it("FAOV: sin dias configurados aplica los minimos legales, nunca menos", () => {
    // Una empresa que aun paga los 15 dias de utilidades de la LOT de 1997 no
    // puede por eso cotizar FAOV sobre una base menor a la legal.
    const emp = makeEmp({ salaryAmount: new Decimal("30000") });

    const sinDias = PayrollCalculatorService.calculateEmployeeLines(emp, BASE_CONFIG);
    const conDiasViejos = PayrollCalculatorService.calculateEmployeeLines(emp, {
      ...BASE_CONFIG, profitDays: 15, vacationBonusDays: 7,
    });
    const conDiasGenerosos = PayrollCalculatorService.calculateEmployeeLines(emp, {
      ...BASE_CONFIG, profitDays: 120, vacationBonusDays: 30,
    });

    const faovBasis = (ls: typeof sinDias) =>
      ls.find((l) => l.conceptCode === "FAOV_OBR")!.basis!.toFixed(2);

    expect(faovBasis(sinDias)).toBe("33750.00");
    expect(faovBasis(conDiasViejos)).toBe("33750.00");
    // Por encima del minimo si sube: 30000 x (1 + 120/360 + 30/360) = 42500
    expect(faovBasis(conDiasGenerosos)).toBe("42500.00");
  });

  it("INCES: el del trabajador ya no se calcula mes a mes", () => {
    const salary = new Decimal("1000"); // supera 5×130=650
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG,
      salaryMinimumVes: salaryMin,
    };
    const emp = makeEmp({ salaryAmount: salary });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
    // El INCES del trabajador ya no se calcula aqui (Art. 50 — va con
    // utilidades). Se comprueba con el patronal, que si es mensual y NO tiene
    // tope: Art. 49 fija la base en el salario normal, sin limite superior.
    const incesPat = lines.find((l) => l.conceptCode === "INCES_PAT");
    expect(incesPat).toBeUndefined(); // no esta en el fixture de conceptos
    expect(lines.find((l) => l.conceptCode === "INCES_OBR")).toBeUndefined();
  });

  it("RPE: capped a 5×salaryMin cuando salario supera el tope", () => {
    const salary = new Decimal("1000");
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG,
      salaryMinimumVes: salaryMin,
    };
    const emp = makeEmp({ salaryAmount: salary });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
    const rpe = lines.find((l) => l.conceptCode === "RPE_OBR");
    // LRPE Art. 46: el techo son DIEZ salarios mínimos (10×130 = 1300), no cinco.
    // 1000 no llega al techo → base = 1000; 1000 × 0,005 = 5,00.
    expect(rpe!.basis!.toFixed(2)).toBe("1000.00");
    expect(rpe!.amount.toFixed(2)).toBe("5.00");
  });

  it("RPE: el techo son 10×salMin — LRPE Art. 46", () => {
    const config: PayrollCalculatorConfig = { ...BASE_CONFIG, salaryMinimumVes: salaryMin };
    const emp = makeEmp({ salaryAmount: new Decimal("5000") }); // supera 10×130=1300
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
    const rpe = lines.find((l) => l.conceptCode === "RPE_OBR")!;
    expect(rpe.basis!.toFixed(2)).toBe("1300.00");
    expect(rpe.amount.toFixed(2)).toBe("6.50");
  });

  it("RPE: quien gana menos del mínimo cotiza igual sobre un salario mínimo", () => {
    // Art. 46 fija también un límite INFERIOR — es el único aporte que lo tiene.
    const config: PayrollCalculatorConfig = { ...BASE_CONFIG, salaryMinimumVes: salaryMin };
    const emp = makeEmp({ salaryAmount: new Decimal("50") }); // < 130
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
    const rpe = lines.find((l) => l.conceptCode === "RPE_OBR")!;
    expect(rpe.basis!.toFixed(2)).toBe("130.00");
    expect(rpe.amount.toFixed(2)).toBe("0.65");
  });

  it("INCES patronal: sin tope — Ley INCES Art. 49", () => {
    // El 2% va sobre el salario normal mensual completo. El tope de 5× que se
    // aplicaba aquí no sale de la Ley.
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG,
      salaryMinimumVes: salaryMin,
      systemConcepts: [...SYSTEM_CONCEPTS, { code: "INCES_PAT", conceptId: "c-inces-pat", salaryNature: "NO_SALARIAL" as SalaryNature }],
    };
    const emp = makeEmp({ salaryAmount: new Decimal("5000") });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
    const incesPat = lines.find((l) => l.conceptCode === "INCES_PAT")!;
    expect(incesPat.basis!.toFixed(2)).toBe("5000.00"); // antes: 650,00
    expect(incesPat.amount.toFixed(2)).toBe("100.00");  // antes: 13,00
  });

  it("sin tope cuando salario está por debajo del límite", () => {
    const salary = new Decimal("500");  // menor que 5×130=650
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG,
      salaryMinimumVes: salaryMin,
    };
    const emp = makeEmp({ salaryAmount: salary });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
    const ivss = lines.find((l) => l.conceptCode === "IVSS_OBR");
    // Sin recorte (500 < 650): 500 x 12/52 x 5 = 576,92 -> 4% = 23,08
    expect(ivss!.amount.toFixed(2)).toBe("23.08");
    expect(ivss!.basis!.toFixed(2)).toBe("576.92");
  });
});

// ─── F-03: Aportes patronales — EMPLOYER_COST ─────────────────────────────────

const SYSTEM_CONCEPTS_WITH_PAT = [
  ...SYSTEM_CONCEPTS,
  { code: "IVSS_PAT", conceptId: "c-ivss-pat", salaryNature: "NO_SALARIAL" as SalaryNature },
  { code: "INCES_PAT", conceptId: "c-inces-pat", salaryNature: "NO_SALARIAL" as SalaryNature },
  { code: "FAOV_PAT", conceptId: "c-faov-pat", salaryNature: "NO_SALARIAL" as SalaryNature },
  { code: "RPE_PAT", conceptId: "c-rpe-pat", salaryNature: "NO_SALARIAL" as SalaryNature },
];

const CONFIG_WITH_PAT: PayrollCalculatorConfig = {
  ...BASE_CONFIG,
  systemConcepts: SYSTEM_CONCEPTS_WITH_PAT,
};

describe("PayrollCalculatorService — Aportes patronales (F-03)", () => {
  it("calcula IVSS patronal 10% - Riesgo Medio, la clase residual del Art. 192", () => {
    const emp = makeEmp({ salaryAmount: new Decimal("30000") });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, CONFIG_WITH_PAT);
    const line = lines.find((l) => l.conceptCode === "IVSS_PAT");
    expect(line).toBeDefined();
    expect(line!.conceptType).toBe("EMPLOYER_COST");
    // 30000 x 12/52 x 5 = 34.615,38 -> 10% = 3.461,54
    // (Reglamento LSS Art. 109 la tarifa, Art. 99 la periodicidad)
    expect(line!.amount.toFixed(2)).toBe("3461.54");
    expect(line!.rate!.toFixed(4)).toBe("0.1000");
  });

  it("calcula INCES patronal 2% (Ley INCES Art. 30)", () => {
    const emp = makeEmp({ salaryAmount: new Decimal("30000") });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, CONFIG_WITH_PAT);
    const line = lines.find((l) => l.conceptCode === "INCES_PAT");
    expect(line).toBeDefined();
    expect(line!.conceptType).toBe("EMPLOYER_COST");
    // 30000 × 0.02 = 600
    expect(line!.amount.toFixed(2)).toBe("600.00");
  });

  it("calcula FAOV patronal 2% del salario integral (LRPVH Art. 33.1)", () => {
    const emp = makeEmp({ salaryAmount: new Decimal("30000") });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, CONFIG_WITH_PAT);
    const line = lines.find((l) => l.conceptCode === "FAOV_PAT");
    expect(line).toBeDefined();
    expect(line!.conceptType).toBe("EMPLOYER_COST");
    // 33750 (integral) x 0.02 = 675
    expect(line!.amount.toFixed(2)).toBe("675.00");
  });

  it("calcula RPE patronal 2% (LSSO Art. 7)", () => {
    const emp = makeEmp({ salaryAmount: new Decimal("30000") });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, CONFIG_WITH_PAT);
    const line = lines.find((l) => l.conceptCode === "RPE_PAT");
    expect(line).toBeDefined();
    expect(line!.conceptType).toBe("EMPLOYER_COST");
    // 30000 × 0.02 = 600
    expect(line!.amount.toFixed(2)).toBe("600.00");
  });

  it("totalEmployerCosts excluye EARNING y DEDUCTION — no afecta neto del empleado", () => {
    const emp = makeEmp({ salaryAmount: new Decimal("30000") });
    const result = PayrollCalculatorService.calculate([emp], [], CONFIG_WITH_PAT);
    // Aportes patronales no deben estar en totalEarnings ni totalDeductions
    expect(result.totalEarnings.toFixed(2)).toBe("30000.00");
    // IVSS 4% semanal (1.384,62) + RPE 0,5% mensual (150) + FAOV 1% del
    // integral (337,50) = 1.872,12
    expect(result.totalDeductions.toFixed(2)).toBe("1872.12");
    // totalEmployerCosts = IVSS 10% semanal (3.461,54) + INCES 2% mensual (600)
    // + RPE 2% mensual (600) + FAOV 2% del integral 33.750 (675) = 5.336,54
    expect(result.totalEmployerCosts.toFixed(2)).toBe("5336.54");
    // totalNet no incluye aportes patronales
    expect(result.totalNet.toFixed(2)).toBe("28127.88");
  });

  it("aplica tope salario mínimo a aportes patronales (igual que obreros)", () => {
    const emp = makeEmp({ salaryAmount: new Decimal("1000") });
    const configWithMin: PayrollCalculatorConfig = {
      ...CONFIG_WITH_PAT,
      salaryMinimumVes: new Decimal("130"), // 5×130=650 tope IVSS
    };
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, configWithMin);
    const ivssPatLine = lines.find((l) => l.conceptCode === "IVSS_PAT");
    expect(ivssPatLine).toBeDefined();
    // Tope MENSUAL 5x130 = 650, llevado a las 5 semanas de marzo = 750.
    // 750 x 10% (Riesgo Medio) = 75.
    expect(ivssPatLine!.amount.toFixed(2)).toBe("75.00");
  });

  it("no genera EMPLOYER_COST cuando ivssEnabled=false", () => {
    const config = { ...CONFIG_WITH_PAT, ivssEnabled: false };
    const emp = makeEmp();
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
    expect(lines.find((l) => l.conceptCode === "IVSS_PAT")).toBeUndefined();
  });
});

// ─── C-01: Monedas mixtas — guard multimoneda ─────────────────────────────────

describe("PayrollCalculatorService.calculate — monedas mixtas (C-01)", () => {
  it("lanza error descriptivo cuando se mezclan VES y USD en un solo run", () => {
    const empVes = makeEmp({ employeeId: "emp-ves", salaryCurrency: "VES" });
    const empUsd = makeEmp({
      employeeId: "emp-usd",
      salaryHistoryId: "sal-usd",
      salaryCurrency: "USD",
    });
    expect(() =>
      PayrollCalculatorService.calculate([empVes, empUsd], [], BASE_CONFIG)
    ).toThrow("Nómina con monedas mixtas");
  });

  it("no lanza error cuando todos los empleados tienen la misma moneda (VES)", () => {
    const emp1 = makeEmp({ employeeId: "emp-1", salaryCurrency: "VES" });
    const emp2 = makeEmp({ employeeId: "emp-2", salaryHistoryId: "sal-2", salaryCurrency: "VES" });
    expect(() =>
      PayrollCalculatorService.calculate([emp1, emp2], [], BASE_CONFIG)
    ).not.toThrow();
  });

  it("no lanza error cuando todos los empleados tienen la misma moneda (USD)", () => {
    const emp1 = makeEmp({ employeeId: "emp-1", salaryCurrency: "USD" });
    const emp2 = makeEmp({ employeeId: "emp-2", salaryHistoryId: "sal-2", salaryCurrency: "USD" });
    expect(() =>
      PayrollCalculatorService.calculate([emp1, emp2], [], BASE_CONFIG)
    ).not.toThrow();
  });
});

// ─── H-4: los topes legales están en bolívares ────────────────────────────────
//
// El salario mínimo venezolano es un monto en Bs., y los topes de cotización son
// múltiplos suyos (5× para IVSS/INCES/RPE, 10× para FAOV). Hasta 2026-08 el
// calculador comparaba ese tope contra el sueldo sin mirar su moneda: a un sueldo
// en dólares le aplicaba "650" como si fueran dólares. La retención salía inflada
// exactamente por el factor de la tasa de cambio.

describe("PayrollCalculatorService — topes legales con sueldo en USD (H-4)", () => {
  const salaryMin = new Decimal("130"); // Bs. — 5× = 650, 10× = 1300

  it("convierte el tope a dólares antes de comparar", () => {
    // Tasa redonda a propósito: 650 / 65 = USD 10 clavados.
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG,
      salaryMinimumVes: salaryMin,
      usdToVesRate: new Decimal("65"),
    };
    const emp = makeEmp({ salaryAmount: new Decimal("2500"), salaryCurrency: "USD" });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);

    const ivss = lines.find((l) => l.conceptCode === "IVSS_OBR")!;
    // Tope mensual USD 10 (Bs. 650 / 65), llevado a las 5 semanas de marzo:
    // 10 x 12/52 x 5 = 11,54 -> 4% = 0,46
    expect(ivss.basis!.toFixed(2)).toBe("11.54");
    expect(ivss.amount.toFixed(2)).toBe("0.46");

    // El FAOV no tiene tope, asi que no hay nada que convertir: la conversion de
    // H-4 no le aplica. La base es el salario INTEGRAL en la moneda del sueldo:
    // USD 2.500 x 1,125 = USD 2.812,50 (las alicuotas son una razon, no un monto
    // en bolivares, asi que la moneda no interviene).
    const faov = lines.find((l) => l.conceptCode === "FAOV_OBR")!;
    expect(faov.basis!.toFixed(2)).toBe("2812.50");
    expect(faov.amount.toFixed(2)).toBe("28.13");
  });

  it("regresión del recibo de agosto 2026: retenía USD 26 de IVSS", () => {
    // Sueldo USD 2.500, tasa 780 Bs./USD. El recibo real mostró:
    //   FAOV 13 · IVSS 26 · INCES 3,25 · RPE 3,25  — todos en USD.
    // Esos son los importes EN BOLÍVARES de la ley, cobrados como si fueran dólares.
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG,
      salaryMinimumVes: salaryMin,
      usdToVesRate: new Decimal("780"),
    };
    const emp = makeEmp({ salaryAmount: new Decimal("2500"), salaryCurrency: "USD" });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);

    const ivss = lines.find((l) => l.conceptCode === "IVSS_OBR")!;
    expect(ivss.amount.toFixed(2)).not.toBe("26.00"); // el bug
    expect(ivss.amount.toFixed(2)).toBe("0.04");      // centavos, no USD 26

    const faov = lines.find((l) => l.conceptCode === "FAOV_OBR")!;

    // Las cotizaciones CON tope caen a centavos: sus bases estan fijadas en
    // bolivares y ya se comparan en la moneda correcta.
    const conTope = lines
      .filter((l) => ["IVSS_OBR", "RPE_OBR"].includes(l.conceptCode))
      .reduce((sum, l) => sum.plus(l.amount), new Decimal(0));
    expect(conTope.lessThan(new Decimal("1"))).toBe(true);

    // El FAOV es el unico sin tope, asi que si escala con el sueldo: 1% del
    // integral de USD 2.500 (= 2.812,50) = USD 28,13. No es una perdida para el
    // trabajador: es ahorro habitacional acreditado a su nombre.
    expect(faov.amount.toFixed(2)).toBe("28.13");
  });

  it("el aporte PATRONAL se topa con la misma conversión", () => {
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG,
      salaryMinimumVes: salaryMin,
      usdToVesRate: new Decimal("65"),
      // El fixture base sólo trae los conceptos del trabajador.
      systemConcepts: [...SYSTEM_CONCEPTS, { code: "IVSS_PAT", conceptId: "c-ivss-pat", salaryNature: "NO_SALARIAL" as SalaryNature }],
    };
    const emp = makeEmp({ salaryAmount: new Decimal("2500"), salaryCurrency: "USD" });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);

    const ivssPat = lines.find((l) => l.conceptCode === "IVSS_PAT")!;
    expect(ivssPat.basis!.toFixed(2)).toBe("11.54"); // mismo tope, mismas semanas
    expect(ivssPat.amount.toFixed(2)).toBe("1.15");  // 10% - Riesgo Medio
  });

  it("un sueldo en VES no se toca aunque haya tasa cargada", () => {
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG,
      salaryMinimumVes: salaryMin,
      usdToVesRate: new Decimal("780"),
    };
    const emp = makeEmp({ salaryAmount: new Decimal("1000"), salaryCurrency: "VES" });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
    const ivss = lines.find((l) => l.conceptCode === "IVSS_OBR")!;
    // Tope 5x130 = 650 sin convertir (el sueldo ya esta en Bs.), llevado a las
    // 5 semanas de marzo: 650 x 12/52 x 5 = 750 -> 4% = 30
    expect(ivss.basis!.toFixed(2)).toBe("750.00");
    expect(ivss.amount.toFixed(2)).toBe("30.00");
  });

  it("sin tasa cargada NO calcula: bloquea en vez de inventar el tope", () => {
    const config: PayrollCalculatorConfig = { ...BASE_CONFIG, salaryMinimumVes: salaryMin };
    const emp = makeEmp({ salaryAmount: new Decimal("2500"), salaryCurrency: "USD" });
    expect(() => PayrollCalculatorService.calculateEmployeeLines(emp, config))
      .toThrow(MISSING_USD_RATE_MESSAGE);
  });

  it("una tasa cero o negativa cuenta como ausente", () => {
    for (const bad of ["0", "-780"]) {
      const config: PayrollCalculatorConfig = {
        ...BASE_CONFIG,
        salaryMinimumVes: salaryMin,
        usdToVesRate: new Decimal(bad),
      };
      const emp = makeEmp({ salaryAmount: new Decimal("2500"), salaryCurrency: "USD" });
      expect(() => PayrollCalculatorService.calculateEmployeeLines(emp, config))
        .toThrow(MISSING_USD_RATE_MESSAGE);
    }
  });

  it("sin topes configurados no hace falta tasa — retro-compatible", () => {
    // salaryMinimumVes = 0 → no hay tope que convertir, luego no hay nada que exigir.
    const emp = makeEmp({ salaryAmount: new Decimal("2500"), salaryCurrency: "USD" });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, BASE_CONFIG);
    const ivss = lines.find((l) => l.conceptCode === "IVSS_OBR")!;
    // Sin tope, el sueldo entero llevado a semanas: 2500 x 12/52 x 5 = 2.884,62
    expect(ivss.basis!.toFixed(2)).toBe("2884.62");
    expect(ivss.amount.toFixed(2)).toBe("115.38");
  });
});

describe("PayrollCalculatorService — sueldo híbrido bloqueado (C-01-bis)", () => {
  it("calculate() rechaza un sueldo MIXED antes de producir líneas", () => {
    const emp = makeEmp({ salaryCurrency: "MIXED" });
    expect(() => PayrollCalculatorService.calculate([emp], [], BASE_CONFIG))
      .toThrow(MIXED_SALARY_MESSAGE);
  });

  it("lo rechaza aunque no haya topes configurados", () => {
    // Sin tope el importe no se puede topar mal, pero el asiento de approve()
    // trataría el sueldo como bolívares. Se bloquea igual.
    const emp = makeEmp({ salaryCurrency: "MIXED", salaryAmount: new Decimal("500") });
    expect(() => PayrollCalculatorService.calculate([emp], [], BASE_CONFIG))
      .toThrow(MIXED_SALARY_MESSAGE);
  });

  it("calculateEmployeeLines() también lo rechaza cuando hay topes", () => {
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG,
      salaryMinimumVes: new Decimal("130"),
      usdToVesRate: new Decimal("65"),
    };
    const emp = makeEmp({ salaryCurrency: "MIXED" });
    expect(() => PayrollCalculatorService.calculateEmployeeLines(emp, config))
      .toThrow(MIXED_SALARY_MESSAGE);
  });
});

// ─── ADR-045 D-4: la base de cotizaciones es el SALARIO NORMAL ────────────────
//
// Antes salia de `salary`, el monto crudo de SalaryHistory. Eso metia en la base
// cosas que la ley deja fuera y no permitia representar el sueldo hibrido.

// La sonda de estos tests es el RPE, no el IVSS: los dos cotizan sobre el salario
// normal, pero el RPE lo hace por MES (LRPE Art. 46) mientras el IVSS lo lleva a
// semanas (Reglamento LSS Art. 99). Con el IVSS habria que reexpresar cada cifra
// esperada y el test dejaria de leerse como lo que comprueba: que entra y que no.
describe("PayrollCalculatorService — base de cotizaciones (ADR-045 D-4)", () => {
  const CONCEPTS: SystemConceptRef[] = [
    ...SYSTEM_CONCEPTS,
    { code: "CESTA_TICKET", conceptId: "c-cesta", salaryNature: "NO_SALARIAL" },
  ];

  it("un concepto sin incidencia salarial NO entra en la base", () => {
    // LOTTT Art. 105 numeral 2. Da igual cuanto sea el cestaticket.
    const config: PayrollCalculatorConfig = { ...BASE_CONFIG, systemConcepts: CONCEPTS };
    const emp = makeEmp({ salaryAmount: new Decimal("1000") });
    const manual: ManualConceptCalculationInput[] = [{
      conceptId: "c-cesta", conceptCode: "CESTA_TICKET", conceptType: "EARNING",
      employeeId: emp.employeeId, amount: new Decimal("5000"),
      salaryNature: "NO_SALARIAL",
    }];
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config, manual);
    const rpe = lines.find((l) => l.conceptCode === "RPE_OBR")!;
    expect(rpe.basis!.toFixed(2)).toBe("1000.00"); // no 6000
  });

  it("las horas extra son salario pero NO salario normal — quedan fuera", () => {
    // Art. 104 tercer aparte: excluye "las percepciones de caracter accidental".
    const config: PayrollCalculatorConfig = { ...BASE_CONFIG, systemConcepts: CONCEPTS };
    const emp = makeEmp({
      salaryAmount: new Decimal("30000"),
      overtimeHoursDay: new Decimal("10"),
    });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
    expect(lines.find((l) => l.conceptCode === "HE_DIURNA")!.amount.greaterThan(0)).toBe(true);
    const rpe = lines.find((l) => l.conceptCode === "RPE_OBR")!;
    expect(rpe.basis!.toFixed(2)).toBe("30000.00"); // sin las HE
  });

  it("un concepto manual CON incidencia salarial SI entra — sueldo hibrido", () => {
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG,
      systemConcepts: [
        ...SYSTEM_CONCEPTS,
        { code: "BONO_PROD", conceptId: "c-bono", salaryNature: "SALARIO_NORMAL" },
      ],
    };
    const emp = makeEmp({ salaryAmount: new Decimal("1000") });
    const manual: ManualConceptCalculationInput[] = [{
      conceptId: "c-bono", conceptCode: "BONO_PROD", conceptType: "EARNING",
      employeeId: emp.employeeId, amount: new Decimal("500"),
      salaryNature: "SALARIO_NORMAL",
    }];
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config, manual);
    const rpe = lines.find((l) => l.conceptCode === "RPE_OBR")!;
    expect(rpe.basis!.toFixed(2)).toBe("1500.00");
    expect(rpe.amount.toFixed(2)).toBe("7.50"); // 0,5%
  });

  it("las ausencias injustificadas reducen la base", () => {
    // SAL_BASE viene prorrateado; antes se cotizaba sobre el sueldo completo
    // aunque la persona no lo hubiera devengado.
    const config: PayrollCalculatorConfig = { ...BASE_CONFIG, systemConcepts: CONCEPTS };
    const emp = makeEmp({ salaryAmount: new Decimal("3000"), absenceDays: new Decimal("3") });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
    const rpe = lines.find((l) => l.conceptCode === "RPE_OBR")!;
    expect(rpe.basis!.toFixed(2)).toBe("2700.00"); // 3000 × 27/30
  });

  it("calculate() mete los manuales en la base, no despues del calculo", () => {
    // Regresion: los conceptos manuales se anadian al array de salida DESPUES de
    // calcular las cotizaciones, asi que uno con incidencia salarial nunca
    // llegaba a la base.
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG,
      systemConcepts: [
        ...SYSTEM_CONCEPTS,
        { code: "BONO_PROD", conceptId: "c-bono", salaryNature: "SALARIO_NORMAL" },
      ],
    };
    const emp = makeEmp({ salaryAmount: new Decimal("1000") });
    const result = PayrollCalculatorService.calculate(emp ? [emp] : [], [{
      conceptId: "c-bono", conceptCode: "BONO_PROD", conceptType: "EARNING",
      employeeId: emp.employeeId, amount: new Decimal("500"),
      salaryNature: "SALARIO_NORMAL",
    }], config);
    const rpe = result.lines.find((l) => l.conceptCode === "RPE_OBR")!;
    expect(rpe.basis!.toFixed(2)).toBe("1500.00");
  });
});

// --- Clase de riesgo ocupacional (Reglamento LSS Arts. 108, 109 y 192) -------

describe("PayrollCalculatorService - clase de riesgo del IVSS", () => {
  const CONCEPTS: SystemConceptRef[] = [
    ...SYSTEM_CONCEPTS,
    { code: "IVSS_PAT", conceptId: "c-ivss-pat", salaryNature: "NO_SALARIAL" },
  ];

  function patronal(riesgo: "MINIMO" | "MEDIO" | "MAXIMO" | undefined) {
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG, systemConcepts: CONCEPTS, ivssRiskClass: riesgo,
    };
    const emp = makeEmp({ salaryAmount: new Decimal("1000") });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
    return lines.find((l) => l.conceptCode === "IVSS_PAT")!;
  }

  // Base: 1000 x 12/52 x 5 semanas = 1.153,85 (Art. 99, cotizacion semanal).
  it("Riesgo Minimo cotiza 9% (Art. 109)", () => {
    expect(patronal("MINIMO").amount.toFixed(2)).toBe("103.85");
  });

  it("Riesgo Medio cotiza 10%", () => {
    expect(patronal("MEDIO").amount.toFixed(2)).toBe("115.38");
  });

  it("Riesgo Maximo cotiza 11%", () => {
    expect(patronal("MAXIMO").amount.toFixed(2)).toBe("126.92");
  });

  it("sin clase declarada asume MEDIO, no la mas barata", () => {
    // Art. 192: "Riesgo Medio: todas las empresas que no esten expresamente
    // incluidas en otra clase". El residual del Reglamento es el 10%, y el
    // calculador tenia el 9% cableado como unica tarifa patronal.
    expect(patronal(undefined).amount.toFixed(2)).toBe("115.38");
  });

  it("el aporte del ASEGURADO es 4% en las tres clases (Art. 109)", () => {
    for (const r of ["MINIMO", "MEDIO", "MAXIMO"] as const) {
      const config: PayrollCalculatorConfig = { ...BASE_CONFIG, ivssRiskClass: r };
      const emp = makeEmp({ salaryAmount: new Decimal("1000") });
      const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
      expect(lines.find((l) => l.conceptCode === "IVSS_OBR")!.amount.toFixed(2))
        .toBe("46.15");
    }
  });
});

// --- Cotizacion SEMANAL del IVSS (Reglamento LSS Arts. 99, 100 y 102) -------
// Hasta 2026-08 el calculador multiplicaba el salario mensual por la tasa y ya.
// El Art. 99 dice que las cotizaciones "se causaran por semanas" y el Art. 100
// que el pago se efectua por periodos de cuatro o cinco semanas: un mes de cinco
// lunes cotiza mas que uno de cuatro, y ContaFlow cobraba lo mismo en los dos.

describe("contributableWeeks", () => {
  const d = (iso: string) => new Date(iso + "T00:00:00Z");

  it("cuenta cinco semanas en un mes de cinco lunes", () => {
    // Marzo 2026: lunes 2, 9, 16, 23 y 30.
    expect(contributableWeeks(d("2026-03-01"), d("2026-03-31"))).toBe(5);
  });

  it("cuenta cuatro en un mes de cuatro lunes", () => {
    // Febrero 2026: lunes 2, 9, 16 y 23.
    expect(contributableWeeks(d("2026-02-01"), d("2026-02-28"))).toBe(4);
  });

  it("siempre cae en el 4 o 5 que contempla el Art. 100", () => {
    for (let m = 0; m < 12; m++) {
      const start = new Date(Date.UTC(2026, m, 1));
      const end = new Date(Date.UTC(2026, m + 1, 0));
      const weeks = contributableWeeks(start, end);
      expect(weeks === 4 || weeks === 5).toBe(true);
    }
  });

  it("una quincena cotiza sus propias semanas, no medio mes", () => {
    // Art. 102: una cotizacion por semana de trabajo. La primera quincena de
    // marzo de 2026 tiene dos lunes (2 y 9); la segunda, tres (16, 23 y 30).
    expect(contributableWeeks(d("2026-03-01"), d("2026-03-15"))).toBe(2);
    expect(contributableWeeks(d("2026-03-16"), d("2026-03-31"))).toBe(3);
  });

  it("periodo invertido no inventa semanas", () => {
    expect(contributableWeeks(d("2026-03-31"), d("2026-03-01"))).toBe(0);
  });
});

describe("weeklyWageFrom", () => {
  it("divide el ano en 52 semanas, no el mes en 4", () => {
    // Art. 99: salario semanal = (mensual x 12) / 52. Dividir entre 4 daria
    // 7.500 y sobreestimaria cada cotizacion en un 8%.
    expect(weeklyWageFrom(new Decimal("30000")).toFixed(4)).toBe("6923.0769");
  });
});

describe("PayrollCalculatorService - el IVSS cotiza por semana", () => {
  const febrero: PayrollCalculatorConfig = {
    ...BASE_CONFIG,
    periodStart: new Date("2026-02-01T00:00:00Z"),
    periodEnd: new Date("2026-02-28T00:00:00Z"),
  };

  function ivssDe(config: PayrollCalculatorConfig) {
    const emp = makeEmp({ salaryAmount: new Decimal("30000") });
    return PayrollCalculatorService.calculateEmployeeLines(emp, config)
      .find((l) => l.conceptCode === "IVSS_OBR")!;
  }

  it("un mes de cinco lunes cotiza mas que uno de cuatro", () => {
    const marzo = ivssDe(BASE_CONFIG);      // 5 semanas
    const feb = ivssDe(febrero);            // 4 semanas
    expect(marzo.amount.greaterThan(feb.amount)).toBe(true);
    expect(marzo.amount.dividedBy(feb.amount).toFixed(2)).toBe("1.25");
  });

  it("cuatro semanas cotizan menos que el mes plano; cinco, mas", () => {
    // Es la desviacion que descuadraba contra la factura de TIUNA:
    // 12/52 x 4 = 0,923 y 12/52 x 5 = 1,154 del mes plano.
    const plano = new Decimal("30000").times("0.04");
    expect(ivssDe(febrero).amount.lessThan(plano)).toBe(true);
    expect(ivssDe(BASE_CONFIG).amount.greaterThan(plano)).toBe(true);
  });

  it("las otras tres cotizaciones NO se llevan a semanas", () => {
    // Solo el Seguro Social cotiza por semana. La LRPE Art. 46 habla del salario
    // "del MES inmediatamente anterior", la Ley INCES Art. 49 del salario normal
    // mensual y la LRPVH Art. 33 del aporte "mensual".
    const marzo = PayrollCalculatorService.calculateEmployeeLines(
      makeEmp({ salaryAmount: new Decimal("30000") }), BASE_CONFIG,
    );
    const feb = PayrollCalculatorService.calculateEmployeeLines(
      makeEmp({ salaryAmount: new Decimal("30000") }), febrero,
    );
    for (const code of ["RPE_OBR", "FAOV_OBR"]) {
      const a = marzo.find((l) => l.conceptCode === code)!.amount;
      const b = feb.find((l) => l.conceptCode === code)!.amount;
      expect(a.toFixed(2)).toBe(b.toFixed(2));
    }
  });
});

// --- D-5: la base de las contribuciones es la del MES ANTERIOR ---------------
// LOTTT Art. 107: toda contribucion se calcula "considerando el salario normal
// correspondiente al mes inmediatamente anterior a aquel en que se causo".
// LRPE Art. 46 lo repite para el RPE. ContaFlow usaba el mes en curso.

describe("PayrollCalculatorService - base del mes anterior (ADR-045 D-5)", () => {
  it("cotiza sobre el mes anterior, no sobre el sueldo del mes en curso", () => {
    // Le subieron el sueldo de 1.000 a 3.000 este mes: las contribuciones de
    // este mes todavia van sobre los 1.000 que devengo el mes pasado.
    const emp = makeEmp({
      salaryAmount: new Decimal("3000"),
      previousMonthNormalWage: new Decimal("1000"),
    });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, BASE_CONFIG);
    expect(lines.find((l) => l.conceptCode === "SAL_BASE")!.amount.toFixed(2))
      .toBe("3000.00"); // lo que se le paga no cambia
    expect(lines.find((l) => l.conceptCode === "RPE_OBR")!.basis!.toFixed(2))
      .toBe("1000.00"); // lo que se cotiza, si
  });

  it("alcanza a las cuatro contribuciones, cada una con su base", () => {
    const emp = makeEmp({
      salaryAmount: new Decimal("3000"),
      previousMonthNormalWage: new Decimal("1000"),
    });
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG,
      systemConcepts: [
        ...SYSTEM_CONCEPTS,
        { code: "IVSS_PAT", conceptId: "c-ivss-pat", salaryNature: "NO_SALARIAL" },
        { code: "INCES_PAT", conceptId: "c-inces-pat", salaryNature: "NO_SALARIAL" },
        { code: "FAOV_PAT", conceptId: "c-faov-pat", salaryNature: "NO_SALARIAL" },
      ],
    };
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
    const basisOf = (c: string) => lines.find((l) => l.conceptCode === c)!.basis!;

    expect(basisOf("RPE_OBR").toFixed(2)).toBe("1000.00");   // mensual
    expect(basisOf("INCES_PAT").toFixed(2)).toBe("1000.00"); // mensual
    expect(basisOf("FAOV_OBR").toFixed(2)).toBe("1125.00");  // integral del anterior
    expect(basisOf("IVSS_OBR").toFixed(2)).toBe("1153.85");  // semanal del anterior
  });

  it("sin mes anterior cotiza sobre el mes en curso, nunca sobre cero", () => {
    // Primer proceso de la empresa, o empleado recien ingresado. La obligacion
    // existe igual: un aporte que desaparece por falta de historico seria peor
    // que uno calculado sobre la unica base que hay.
    const emp = makeEmp({ salaryAmount: new Decimal("3000") });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, BASE_CONFIG);
    expect(lines.find((l) => l.conceptCode === "RPE_OBR")!.basis!.toFixed(2))
      .toBe("3000.00");
  });

  it("un mes anterior en cero SI cotiza cero — no es lo mismo que no tenerlo", () => {
    // Mes completo de permiso no remunerado: no devengo salario normal, no hay
    // base. Distinto de `undefined`, que significa que no hay mes anterior.
    const emp = makeEmp({
      salaryAmount: new Decimal("3000"),
      previousMonthNormalWage: new Decimal(0),
    });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, BASE_CONFIG);
    expect(lines.find((l) => l.conceptCode === "RPE_OBR")!.amount.toFixed(2))
      .toBe("0.00");
  });
});

// --- Topes de horas extraordinarias (LOTTT Art. 178) ------------------------
// "No podran exceder de diez horas semanales, ni de cien horas por ano". El
// calculador solo validaba que las horas no fueran negativas.
//
// AVISA, no bloquea: las horas ya se trabajaron y el Art. 118 obliga a pagarlas.
// Negarse a liquidar dejaria al trabajador sin cobrar lo devengado para corregir
// una infraccion del patrono.

describe("PayrollCalculatorService - topes de horas extra (Art. 178)", () => {
  // Marzo de 2026: cinco semanas -> 50 horas admitidas en el periodo.
  function run(overrides: Partial<EmployeeCalculationInput>) {
    return PayrollCalculatorService.calculate(
      [makeEmp({ salaryAmount: new Decimal("30000"), ...overrides })], [], BASE_CONFIG,
    );
  }

  it("dentro del tope no genera aviso", () => {
    const r = run({ overtimeHoursDay: new Decimal("40"), overtimeHoursYearToDate: new Decimal("0") });
    expect(r.overtimeWarnings).toHaveLength(0);
  });

  it("avisa al pasar de diez horas por semana del periodo", () => {
    const r = run({ overtimeHoursDay: new Decimal("60"), overtimeHoursYearToDate: new Decimal("0") });
    const semanal = r.overtimeWarnings.filter((w) => w.kind === "SEMANAL");
    expect(semanal).toHaveLength(1);
    expect(semanal[0].limit.toFixed(0)).toBe("50"); // 10 x 5 semanas
    expect(semanal[0].message).toContain("Art. 178");
  });

  it("suma diurnas y nocturnas: el tope es de horas extra, no de cada tipo", () => {
    const r = run({
      overtimeHoursDay: new Decimal("30"),
      overtimeHoursNight: new Decimal("30"),
      overtimeHoursYearToDate: new Decimal("0"),
    });
    expect(r.overtimeWarnings.some((w) => w.kind === "SEMANAL")).toBe(true);
  });

  it("avisa al pasar de cien horas en el ano, contando lo ya devengado", () => {
    const r = run({
      overtimeHoursDay: new Decimal("20"),
      overtimeHoursYearToDate: new Decimal("95"),
    });
    const anual = r.overtimeWarnings.filter((w) => w.kind === "ANUAL");
    expect(anual).toHaveLength(1);
    expect(anual[0].hours.toFixed(0)).toBe("115");
    expect(anual[0].limit.toFixed(0)).toBe("100");
  });

  it("sin acumulado del ano solo se comprueba el semanal", () => {
    const r = run({ overtimeHoursDay: new Decimal("20") }); // ytd undefined
    expect(r.overtimeWarnings.filter((w) => w.kind === "ANUAL")).toHaveLength(0);
  });

  it("excederse NO impide pagar: las lineas y el neto salen igual", () => {
    const r = run({ overtimeHoursDay: new Decimal("60"), overtimeHoursYearToDate: new Decimal("200") });
    expect(r.overtimeWarnings.length).toBeGreaterThan(0);
    const he = r.lines.find((l) => l.conceptCode === "HE_DIURNA")!;
    expect(he.amount.greaterThan(0)).toBe(true);
    expect(r.totalNet.greaterThan(0)).toBe(true);
  });
});

// --- Umbral de cinco trabajadores del INCES (Ley INCES Art. 49) --------------
// "Las personas naturales y juridicas ... que den ocupacion a CINCO (5) O MAS
// trabajadores". Por debajo no hay obligacion, y se cobraba igual.

describe("PayrollCalculatorService - umbral del INCES patronal", () => {
  const CONCEPTS: SystemConceptRef[] = [
    ...SYSTEM_CONCEPTS,
    { code: "INCES_PAT", conceptId: "c-inces-pat", salaryNature: "NO_SALARIAL" },
  ];

  function incesPat(activeEmployeeCount: number) {
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG, systemConcepts: CONCEPTS, activeEmployeeCount,
    };
    return PayrollCalculatorService
      .calculateEmployeeLines(makeEmp({ salaryAmount: new Decimal("30000") }), config)
      .find((l) => l.conceptCode === "INCES_PAT");
  }

  it("con cinco trabajadores aplica", () => {
    expect(incesPat(5)!.amount.toFixed(2)).toBe("600.00"); // 2% de 30.000
  });

  it("con mas de cinco aplica", () => {
    expect(incesPat(40)).toBeDefined();
  });

  it("con cuatro NO aplica: no se genera la linea", () => {
    // Antes se le cobraba a la empresa un 2% patronal que la ley no le impone.
    expect(incesPat(4)).toBeUndefined();
  });

  it("una empresa de un solo trabajador tampoco cotiza", () => {
    expect(incesPat(1)).toBeUndefined();
  });

  it("el umbral no toca a los otros tres organismos", () => {
    const config: PayrollCalculatorConfig = {
      ...BASE_CONFIG, systemConcepts: CONCEPTS, activeEmployeeCount: 2,
    };
    const lines = PayrollCalculatorService
      .calculateEmployeeLines(makeEmp({ salaryAmount: new Decimal("30000") }), config);
    for (const code of ["IVSS_OBR", "FAOV_OBR", "RPE_OBR"]) {
      expect(lines.find((l) => l.conceptCode === code)).toBeDefined();
    }
  });
});
