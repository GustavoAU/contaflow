// src/modules/payroll/__tests__/PayrollCalculatorService.test.ts
// Fase NOM-C: Tests del motor de cálculo puro (sin DB, sin mocks de Prisma)

import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import type { SalaryNature } from "@prisma/client";
import {
  PayrollCalculatorService,
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
    // 30000 * 0.04 = 1200
    expect(ivss!.amount.toFixed(2)).toBe("1200.00");
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
    // totalDeductions = 1200 (IVSS 4%) + 337,50 (FAOV 1% del integral) + 150 (RPE) = 1687,50
    // El INCES obrero ya no se retiene mes a mes (Art. 50).
    expect(result.totalEarnings.toFixed(2)).toBe("30000.00");
    expect(result.totalDeductions.toFixed(2)).toBe("1687.50");
    expect(result.totalNet.toFixed(2)).toBe("28312.50");
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
    expect(result.totalDeductions.toFixed(2)).toBe("2187.50"); // 1687,50 + 500
    expect(result.totalNet.toFixed(2)).toBe("27812.50");
  });

  it("calcula múltiples empleados sumando correctamente", () => {
    const emp1 = makeEmp({ employeeId: "emp-1" });
    const emp2 = makeEmp({
      employeeId: "emp-2",
      salaryHistoryId: "sal-2",
      salaryAmount: new Decimal("20000"),
    });
    const result = PayrollCalculatorService.calculate([emp1, emp2], [], BASE_CONFIG);
    // emp1: 30000 -> 1200 + 337,50 + 150 = 1687,50
    // emp2: 20000 ->  800 + 225,00 + 100 = 1125,00
    expect(result.totalEarnings.toFixed(2)).toBe("50000.00");
    expect(result.totalDeductions.toFixed(2)).toBe("2812.50");
    expect(result.totalNet.toFixed(2)).toBe("47187.50");
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
    // Sin tope: 1000 * 0.04 = 40
    expect(ivss!.amount.toFixed(2)).toBe("40.00");
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
    // base cappada = min(1000, 5×130) = 650; 650 * 0.04 = 26
    expect(ivss!.amount.toFixed(2)).toBe("26.00");
    expect(ivss!.basis!.toFixed(2)).toBe("650.00");
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

    expect(basisOf("IVSS_OBR").toFixed(2)).toBe("30000.00");
    expect(basisOf("RPE_OBR").toFixed(2)).toBe("30000.00");
    expect(basisOf("INCES_PAT").toFixed(2)).toBe("30000.00");
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
    // Sin recorte: 500 * 0.04 = 20 (500 < 650)
    expect(ivss!.amount.toFixed(2)).toBe("20.00");
    expect(ivss!.basis!.toFixed(2)).toBe("500.00");
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
    // 30000 x 0,10 = 3000 (Reglamento LSS Art. 109, Riesgo Medio)
    expect(line!.amount.toFixed(2)).toBe("3000.00");
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
    // IVSS 4% + RPE 0,5% sobre el normal, FAOV 1% sobre el integral
    expect(result.totalDeductions.toFixed(2)).toBe("1687.50");
    // totalEmployerCosts = IVSS 10% (3000) + INCES 2% (600) + RPE 2% (600) sobre
    // el normal, mas FAOV 2% sobre el integral de 33750 (675) = 4875
    expect(result.totalEmployerCosts.toFixed(2)).toBe("4875.00");
    // totalNet no incluye aportes patronales
    expect(result.totalNet.toFixed(2)).toBe("28312.50");
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
    // Con salaryMin=130 → tope 5×130=650 → 650×0.09=58.50
    expect(ivssPatLine!.amount.toFixed(2)).toBe("65.00");
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
    expect(ivss.basis!.toFixed(2)).toBe("10.00");   // Bs. 650 / 65
    expect(ivss.amount.toFixed(2)).toBe("0.40");    // 4%

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
    expect(ivss.amount.toFixed(2)).toBe("0.03");      // Bs. 26 / 780

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
    expect(ivssPat.basis!.toFixed(2)).toBe("10.00");
    expect(ivssPat.amount.toFixed(2)).toBe("1.00"); // 10% - Riesgo Medio
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
    expect(ivss.basis!.toFixed(2)).toBe("650.00"); // 5×130, sin convertir
    expect(ivss.amount.toFixed(2)).toBe("26.00");
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
    expect(ivss.basis!.toFixed(2)).toBe("2500.00");
    expect(ivss.amount.toFixed(2)).toBe("100.00");
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
    const ivss = lines.find((l) => l.conceptCode === "IVSS_OBR")!;
    expect(ivss.basis!.toFixed(2)).toBe("1000.00"); // no 6000
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
    const ivss = lines.find((l) => l.conceptCode === "IVSS_OBR")!;
    expect(ivss.basis!.toFixed(2)).toBe("30000.00"); // sin las HE
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
    const ivss = lines.find((l) => l.conceptCode === "IVSS_OBR")!;
    expect(ivss.basis!.toFixed(2)).toBe("1500.00");
    expect(ivss.amount.toFixed(2)).toBe("60.00");
  });

  it("las ausencias injustificadas reducen la base", () => {
    // SAL_BASE viene prorrateado; antes se cotizaba sobre el sueldo completo
    // aunque la persona no lo hubiera devengado.
    const config: PayrollCalculatorConfig = { ...BASE_CONFIG, systemConcepts: CONCEPTS };
    const emp = makeEmp({ salaryAmount: new Decimal("3000"), absenceDays: new Decimal("3") });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
    const ivss = lines.find((l) => l.conceptCode === "IVSS_OBR")!;
    expect(ivss.basis!.toFixed(2)).toBe("2700.00"); // 3000 × 27/30
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
    const ivss = result.lines.find((l) => l.conceptCode === "IVSS_OBR")!;
    expect(ivss.basis!.toFixed(2)).toBe("1500.00");
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

  it("Riesgo Minimo cotiza 9% (Art. 109)", () => {
    expect(patronal("MINIMO").amount.toFixed(2)).toBe("90.00");
  });

  it("Riesgo Medio cotiza 10%", () => {
    expect(patronal("MEDIO").amount.toFixed(2)).toBe("100.00");
  });

  it("Riesgo Maximo cotiza 11%", () => {
    expect(patronal("MAXIMO").amount.toFixed(2)).toBe("110.00");
  });

  it("sin clase declarada asume MEDIO, no la mas barata", () => {
    // Art. 192: "Riesgo Medio: todas las empresas que no esten expresamente
    // incluidas en otra clase". El residual del Reglamento es el 10%, y el
    // calculador tenia el 9% cableado como unica tarifa patronal.
    expect(patronal(undefined).amount.toFixed(2)).toBe("100.00");
  });

  it("el aporte del ASEGURADO es 4% en las tres clases (Art. 109)", () => {
    for (const r of ["MINIMO", "MEDIO", "MAXIMO"] as const) {
      const config: PayrollCalculatorConfig = { ...BASE_CONFIG, ivssRiskClass: r };
      const emp = makeEmp({ salaryAmount: new Decimal("1000") });
      const lines = PayrollCalculatorService.calculateEmployeeLines(emp, config);
      expect(lines.find((l) => l.conceptCode === "IVSS_OBR")!.amount.toFixed(2))
        .toBe("40.00");
    }
  });
});
