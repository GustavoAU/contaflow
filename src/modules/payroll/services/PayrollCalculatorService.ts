// src/modules/payroll/services/PayrollCalculatorService.ts
// Fase NOM-C: Motor de cálculo de nómina — servicio puro (sin DB, sin efectos secundarios)
//
// Seguridad (ADR-013 / NOM-C-12):
//   Las tasas legales son CONSTANTES INTERNAS — nunca se aceptan del cliente (ADR-006 D-3).
//   Los flags ivssEnabled/incesEnabled/banavihEnabled de PayrollConfig controlan
//   si el concepto aplica (booleano), no la tasa.
//
// NOM-C-05: Toda cantidad de horas se valida >= 0 antes de calcular.
// NOM-C-10: El calculador lanza si produce amount negativo en EARNING o netPayable < 0.
// NOM-C-14: totalEarnings/totalDeductions/totalNet se calculan aquí, nunca del input del cliente.

import Decimal from "decimal.js";
import type { ConceptType, PayrollFrequency, PayrollPaymentCurrency } from "@prisma/client";

// ─── Tasas legales venezolanas (inmutables — ADR-006 D-3) ────────────────────
// LSS Art. 62: IVSS obrero 4%
const IVSS_WORKER_RATE = new Decimal("0.04");
// Ley INCES Art. 30: trabajador 2%
const INCES_WORKER_RATE = new Decimal("0.02");
// LAH Art. 172: FAOV obrero 1%
const FAOV_WORKER_RATE = new Decimal("0.01");
// LOTTT Art. 118: HE diurna 50% recargo (multiplicador 1.5×)
const HE_DAY_MULTIPLIER = new Decimal("1.5");
// LOTTT Art. 118: HE nocturna 75% recargo (multiplicador 1.75×)
const HE_NIGHT_MULTIPLIER = new Decimal("1.75");
// Días base de cálculo mensual (convención LOTTT)
const DAYS_MONTH = new Decimal("30");
// Horas de jornada diaria
const HOURS_DAY = new Decimal("8");

// ─── Interfaces públicas ──────────────────────────────────────────────────────

export interface SystemConceptRef {
  code: string;
  conceptId: string;
}

export interface EmployeeCalculationInput {
  employeeId: string;
  // Salario vigente al periodStart (max effectiveFrom <= periodStart)
  salaryHistoryId: string;
  salaryAmount: Decimal;
  salaryCurrency: PayrollPaymentCurrency;
  // Novedades del período
  overtimeHoursDay: Decimal;   // HE diurnas (validadas >= 0)
  overtimeHoursNight: Decimal; // HE nocturnas (validadas >= 0)
  absenceDays: Decimal;        // Días de ausencia injustificada (descuento proporcional)
}

export interface ManualConceptCalculationInput {
  conceptId: string;
  conceptCode: string;
  conceptType: ConceptType;
  employeeId: string;
  amount: Decimal; // monto fijo positivo ingresado por el contador
}

export interface PayrollCalculatorConfig {
  frequency: PayrollFrequency;
  ivssEnabled: boolean;
  incesEnabled: boolean;
  banavihEnabled: boolean;
  systemConcepts: SystemConceptRef[];
}

export interface CalculatorLineOutput {
  conceptCode: string;
  conceptId: string;
  employeeId: string;
  conceptType: ConceptType;
  amount: Decimal;       // siempre positivo — el conceptType determina si es cargo o abono
  basis?: Decimal;       // base de cálculo (para auditoría)
  hours?: Decimal;       // solo HE_DIURNA / HE_NOCTURNA
  rate?: Decimal;        // porcentaje aplicado (fracción, ej: 0.04)
  salaryHistoryId: string;
  salarySnapshotAmount: Decimal;
  salarySnapshotCurrency: PayrollPaymentCurrency;
}

export interface PayrollCalculatorResult {
  lines: CalculatorLineOutput[];
  totalEarnings: Decimal;
  totalDeductions: Decimal;
  totalNet: Decimal;
}

// ─── Helper interno ───────────────────────────────────────────────────────────

function findConcept(systemConcepts: SystemConceptRef[], code: string): string | undefined {
  return systemConcepts.find((c) => c.code === code)?.conceptId;
}

// ─── PayrollCalculatorService ─────────────────────────────────────────────────

export const PayrollCalculatorService = {
  /**
   * Calcula todas las líneas de nómina para una lista de empleados.
   * Lanza si se detecta un EARNING negativo o un netPayable negativo (NOM-C-10).
   */
  calculate(
    employees: EmployeeCalculationInput[],
    manualConcepts: ManualConceptCalculationInput[],
    config: PayrollCalculatorConfig
  ): PayrollCalculatorResult {
    const allLines: CalculatorLineOutput[] = [];

    for (const emp of employees) {
      const empLines = this.calculateEmployeeLines(emp, config);
      // Conceptos manuales del empleado
      const empManuals = manualConcepts
        .filter((m) => m.employeeId === emp.employeeId)
        .map((m): CalculatorLineOutput => ({
          conceptCode: m.conceptCode,
          conceptId: m.conceptId,
          employeeId: m.employeeId,
          conceptType: m.conceptType,
          amount: m.amount,
          salaryHistoryId: emp.salaryHistoryId,
          salarySnapshotAmount: emp.salaryAmount,
          salarySnapshotCurrency: emp.salaryCurrency,
        }));
      allLines.push(...empLines, ...empManuals);
    }

    // Validación post-cálculo (NOM-C-10)
    for (const line of allLines) {
      if (line.conceptType === "EARNING" && line.amount.lessThan(0)) {
        throw new Error(
          `Error de cálculo: asignación negativa detectada en concepto ${line.conceptCode} para empleado ${line.employeeId}`
        );
      }
    }

    const totalEarnings = allLines
      .filter((l) => l.conceptType === "EARNING")
      .reduce((s, l) => s.plus(l.amount), new Decimal(0));

    const totalDeductions = allLines
      .filter((l) => l.conceptType === "DEDUCTION")
      .reduce((s, l) => s.plus(l.amount), new Decimal(0));

    const totalNet = totalEarnings.minus(totalDeductions);

    if (totalNet.lessThan(0)) {
      throw new Error(
        "El neto a pagar no puede ser negativo — revisa las deducciones o el salario base"
      );
    }

    return { lines: allLines, totalEarnings, totalDeductions, totalNet };
  },

  /**
   * Calcula las líneas de nómina de un solo empleado.
   * Usado internamente y en tests unitarios.
   */
  calculateEmployeeLines(
    emp: EmployeeCalculationInput,
    config: PayrollCalculatorConfig
  ): CalculatorLineOutput[] {
    const lines: CalculatorLineOutput[] = [];
    const { systemConcepts, ivssEnabled, incesEnabled, banavihEnabled } = config;
    const salary = emp.salaryAmount;

    const salaryBase = {
      salaryHistoryId: emp.salaryHistoryId,
      salarySnapshotAmount: salary,
      salarySnapshotCurrency: emp.salaryCurrency,
    };

    // Validación de horas (NOM-C-05)
    if (emp.overtimeHoursDay.lessThan(0) || emp.overtimeHoursNight.lessThan(0)) {
      throw new Error("Las horas extra no pueden ser negativas");
    }
    if (emp.absenceDays.lessThan(0)) {
      throw new Error("Los días de ausencia no pueden ser negativos");
    }

    // ── SAL_BASE ─────────────────────────────────────────────────────────────
    const salBaseId = findConcept(systemConcepts, "SAL_BASE");
    if (salBaseId) {
      // Descuento proporcional por ausencias injustificadas
      const effectiveDays = DAYS_MONTH.minus(emp.absenceDays).clampedTo(new Decimal(0), DAYS_MONTH);
      const salBase = salary.times(effectiveDays).dividedBy(DAYS_MONTH).toDecimalPlaces(2);
      lines.push({
        conceptCode: "SAL_BASE",
        conceptId: salBaseId,
        employeeId: emp.employeeId,
        conceptType: "EARNING",
        amount: salBase,
        basis: salary,
        ...salaryBase,
      });
    }

    // ── HE_DIURNA ────────────────────────────────────────────────────────────
    const heDiurnaId = findConcept(systemConcepts, "HE_DIURNA");
    if (heDiurnaId && emp.overtimeHoursDay.greaterThan(0)) {
      const salarioHora = salary.dividedBy(DAYS_MONTH).dividedBy(HOURS_DAY);
      const amount = salarioHora.times(HE_DAY_MULTIPLIER).times(emp.overtimeHoursDay).toDecimalPlaces(2);
      lines.push({
        conceptCode: "HE_DIURNA",
        conceptId: heDiurnaId,
        employeeId: emp.employeeId,
        conceptType: "EARNING",
        amount,
        basis: salarioHora,
        hours: emp.overtimeHoursDay,
        rate: HE_DAY_MULTIPLIER,
        ...salaryBase,
      });
    }

    // ── HE_NOCTURNA ──────────────────────────────────────────────────────────
    const heNocturnaId = findConcept(systemConcepts, "HE_NOCTURNA");
    if (heNocturnaId && emp.overtimeHoursNight.greaterThan(0)) {
      const salarioHora = salary.dividedBy(DAYS_MONTH).dividedBy(HOURS_DAY);
      const amount = salarioHora.times(HE_NIGHT_MULTIPLIER).times(emp.overtimeHoursNight).toDecimalPlaces(2);
      lines.push({
        conceptCode: "HE_NOCTURNA",
        conceptId: heNocturnaId,
        employeeId: emp.employeeId,
        conceptType: "EARNING",
        amount,
        basis: salarioHora,
        hours: emp.overtimeHoursNight,
        rate: HE_NIGHT_MULTIPLIER,
        ...salaryBase,
      });
    }

    // ── IVSS_OBR (4% — solo si ivssEnabled) ──────────────────────────────────
    const ivssObrId = findConcept(systemConcepts, "IVSS_OBR");
    if (ivssEnabled && ivssObrId) {
      const amount = salary.times(IVSS_WORKER_RATE).toDecimalPlaces(2);
      lines.push({
        conceptCode: "IVSS_OBR",
        conceptId: ivssObrId,
        employeeId: emp.employeeId,
        conceptType: "DEDUCTION",
        amount,
        basis: salary,
        rate: IVSS_WORKER_RATE,
        ...salaryBase,
      });
    }

    // ── INCES_OBR (2% — solo si incesEnabled) ────────────────────────────────
    const incesObrId = findConcept(systemConcepts, "INCES_OBR");
    if (incesEnabled && incesObrId) {
      const amount = salary.times(INCES_WORKER_RATE).toDecimalPlaces(2);
      lines.push({
        conceptCode: "INCES_OBR",
        conceptId: incesObrId,
        employeeId: emp.employeeId,
        conceptType: "DEDUCTION",
        amount,
        basis: salary,
        rate: INCES_WORKER_RATE,
        ...salaryBase,
      });
    }

    // ── FAOV_OBR (1% — solo si banavihEnabled) ───────────────────────────────
    const faovObrId = findConcept(systemConcepts, "FAOV_OBR");
    if (banavihEnabled && faovObrId) {
      const amount = salary.times(FAOV_WORKER_RATE).toDecimalPlaces(2);
      lines.push({
        conceptCode: "FAOV_OBR",
        conceptId: faovObrId,
        employeeId: emp.employeeId,
        conceptType: "DEDUCTION",
        amount,
        basis: salary,
        rate: FAOV_WORKER_RATE,
        ...salaryBase,
      });
    }

    return lines;
  },
};
