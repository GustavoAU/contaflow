// src/modules/payroll/__tests__/PayrollCalculatorService.test.ts
// Fase NOM-C: Tests del motor de cálculo puro (sin DB, sin mocks de Prisma)

import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  PayrollCalculatorService,
  type EmployeeCalculationInput,
  type PayrollCalculatorConfig,
  type ManualConceptCalculationInput,
} from "../services/PayrollCalculatorService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SYSTEM_CONCEPTS = [
  { code: "SAL_BASE", conceptId: "c-sal-base" },
  { code: "HE_DIURNA", conceptId: "c-he-diurna" },
  { code: "HE_NOCTURNA", conceptId: "c-he-noc" },
  { code: "IVSS_OBR", conceptId: "c-ivss" },
  { code: "INCES_OBR", conceptId: "c-inces" },
  { code: "FAOV_OBR", conceptId: "c-faov" },
];

const BASE_CONFIG: PayrollCalculatorConfig = {
  frequency: "MONTHLY",
  ivssEnabled: true,
  incesEnabled: true,
  banavihEnabled: true,
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
  it("calcula horas extra nocturnas (75% recargo LOTTT)", () => {
    const emp = makeEmp({ overtimeHoursNight: new Decimal(4) });
    const lines = PayrollCalculatorService.calculateEmployeeLines(emp, BASE_CONFIG);
    const he = lines.find((l) => l.conceptCode === "HE_NOCTURNA");
    // 125 * 1.75 * 4 = 875
    expect(he!.amount.toFixed(2)).toBe("875.00");
    expect(he!.rate!.toFixed(2)).toBe("1.75");
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

describe("PayrollCalculatorService — INCES_OBR", () => {
  it("calcula INCES 2% del salario", () => {
    const lines = PayrollCalculatorService.calculateEmployeeLines(makeEmp(), BASE_CONFIG);
    const inces = lines.find((l) => l.conceptCode === "INCES_OBR");
    // 30000 * 0.02 = 600
    expect(inces!.amount.toFixed(2)).toBe("600.00");
    expect(inces!.rate!.toFixed(2)).toBe("0.02");
  });

  it("no genera INCES si incesEnabled = false", () => {
    const config = { ...BASE_CONFIG, incesEnabled: false };
    const lines = PayrollCalculatorService.calculateEmployeeLines(makeEmp(), config);
    expect(lines.find((l) => l.conceptCode === "INCES_OBR")).toBeUndefined();
  });
});

describe("PayrollCalculatorService — FAOV_OBR", () => {
  it("calcula FAOV 1% del salario", () => {
    const lines = PayrollCalculatorService.calculateEmployeeLines(makeEmp(), BASE_CONFIG);
    const faov = lines.find((l) => l.conceptCode === "FAOV_OBR");
    // 30000 * 0.01 = 300
    expect(faov!.amount.toFixed(2)).toBe("300.00");
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
    // totalDeductions = 1200 (IVSS) + 600 (INCES) + 300 (FAOV) = 2100
    // totalNet = 27900
    expect(result.totalEarnings.toFixed(2)).toBe("30000.00");
    expect(result.totalDeductions.toFixed(2)).toBe("2100.00");
    expect(result.totalNet.toFixed(2)).toBe("27900.00");
  });

  it("incluye conceptos manuales en el cálculo", () => {
    const manuals: ManualConceptCalculationInput[] = [
      {
        conceptId: "c-islr",
        conceptCode: "ISLR_RET",
        conceptType: "DEDUCTION",
        employeeId: "emp-1",
        amount: new Decimal("500"),
      },
    ];
    const result = PayrollCalculatorService.calculate([makeEmp()], manuals, BASE_CONFIG);
    expect(result.totalDeductions.toFixed(2)).toBe("2600.00"); // 2100 + 500
    expect(result.totalNet.toFixed(2)).toBe("27400.00");
  });

  it("calcula múltiples empleados sumando correctamente", () => {
    const emp1 = makeEmp({ employeeId: "emp-1" });
    const emp2 = makeEmp({
      employeeId: "emp-2",
      salaryHistoryId: "sal-2",
      salaryAmount: new Decimal("20000"),
    });
    const result = PayrollCalculatorService.calculate([emp1, emp2], [], BASE_CONFIG);
    // emp1: net = 27900, emp2: net = 20000 * (1 - 0.07) = 18600
    // total earnings: 50000, deductions: 2100 + 1400 = 3500, net: 46500
    expect(result.totalEarnings.toFixed(2)).toBe("50000.00");
    expect(result.totalDeductions.toFixed(2)).toBe("3500.00");
    expect(result.totalNet.toFixed(2)).toBe("46500.00");
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
