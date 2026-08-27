// src/modules/payroll/services/PayrollCalculatorService.ts
// Fase NOM-C: Motor de cálculo de nómina — servicio puro (sin DB, sin efectos secundarios)
//
// Seguridad (ADR-013 / NOM-C-12):
//   Las tasas legales vienen de LegalThreshold (DB, server-side) — nunca del cliente (ADR-006 D-3).
//   Los flags ivssEnabled/incesEnabled/banavihEnabled de PayrollConfig controlan
//   si el concepto aplica (booleano), no la tasa.
//
// NOM-C-05: Toda cantidad de horas se valida >= 0 antes de calcular.
// NOM-C-10: El calculador lanza si produce amount negativo en EARNING o netPayable < 0.
// NOM-C-14: totalEarnings/totalDeductions/totalNet se calculan aquí, nunca del input del cliente.

import Decimal from "decimal.js";
import type {
  ConceptType, PayrollFrequency, PayrollPaymentCurrency, SalaryNature,
} from "@prisma/client";

// ─── Tasas legales venezolanas — defaults (ADR-006 D-3) ──────────────────────
// Usadas cuando no hay registro en LegalThreshold para la empresa/período.
// LSS Art. 62: IVSS obrero 4% | patronal 9% | tope: 5 × salario mínimo
const DEFAULT_IVSS_WORKER_RATE = new Decimal("0.04");
const DEFAULT_IVSS_PAT_RATE    = new Decimal("0.09");
const IVSS_CAP_MULTIPLES = new Decimal("5");
// Ley del INCES (Decreto 1.414, G.O. 6.155 Extraordinario del 19-11-2014):
//   Art. 49 — patronal 2% del SALARIO NORMAL MENSUAL, SIN TOPE, pagadero por
//     trimestre, y sólo para entidades con cinco o más trabajadores.
//   Art. 50 — trabajador 0,5% de las UTILIDADES ANUALES, aguinaldos o
//     bonificaciones de fin de año. NO es una deducción mensual sobre el sueldo.
const DEFAULT_INCES_PAT_RATE    = new Decimal("0.02");
// Ley del Régimen Prestacional de Vivienda y Hábitat, reformada por la Ley de
// Reforma Parcial publicada en G.O. 6.805 Extraordinario del 01-05-2024:
// aporte total del 3% del SALARIO INTEGRAL — un tercio del trabajador (1%) y
// dos tercios del patrono (2%) — SIN TOPE, enterado dentro de los primeros diez
// días hábiles de cada mes por el portal de BANAVIH.
//
// El tope de 10× que se aplicaba aquí venía citado como "LAH Art. 172", o sea la
// Ley de Ahorro Habitacional: una norma que la LRPVH sustituyó. Es la misma
// clase de error que el bono vacacional ("LOTTT Art. 223", que es de la LOT de
// 1997) y el INCES ("Art. 30", de la ley de 2008 derogada en 2014): la constante
// se tomó de la ley anterior y la cita se actualizó sola.
const DEFAULT_FAOV_WORKER_RATE = new Decimal("0.01");
const DEFAULT_FAOV_PAT_RATE    = new Decimal("0.02");
// Ley del Régimen Prestacional de Empleo (G.O. 38.281 del 27-09-2005), Art. 46:
//   cotización total 2,50% del salario normal — 80% patrono (2,0%) y 20%
//   trabajador (0,5%) — con la base contributiva acotada entre UN salario mínimo
//   urbano (límite inferior) y DIEZ (límite superior).
const DEFAULT_RPE_WORKER_RATE = new Decimal("0.005");
const DEFAULT_RPE_PAT_RATE    = new Decimal("0.02");
const RPE_CAP_MULTIPLES   = new Decimal("10");
const RPE_FLOOR_MULTIPLES = new Decimal("1");
// LOTTT Art. 118: HE diurna 50% recargo (multiplicador 1.5×)
const HE_DAY_MULTIPLIER = new Decimal("1.5");
// Hora extra nocturna: la hora es nocturna Y extraordinaria, asi que acumula los
// dos recargos sobre la hora ordinaria diurna.
//   Art. 117 — "La jornada nocturna sera pagada con un treinta por ciento de
//     recargo, por lo menos, sobre el salario convenido para la jornada diurna."
//   Art. 118 — "Las horas extraordinarias seran pagadas con un cincuenta por
//     ciento de recargo, por lo menos, sobre el salario convenido para la
//     jornada ordinaria."
// 1,30 × 1,50 = 1,95. El codigo traia 1,75 con el comentario "75% de recargo",
// y el nombre del concepto decia "(100%)": tres numeros distintos para lo mismo,
// y el que se aplicaba estaba por debajo del piso legal.
//
// Nota de modelo: el salario hora se divide entre HOURS_DAY (8). El Art. 113
// manda dividir por las horas "de la jornada diurna, nocturna o mixta, segun sea
// el caso", y la nocturna topa en siete (Art. 173.2). Aqui el divisor correcto
// es 8 porque la base legal de ambos recargos es la jornada ORDINARIA del
// trabajador, que asumimos diurna: ContaFlow no guarda el tipo de jornada por
// empleado. Para quien tenga jornada nocturna ordinaria el divisor deberia ser
// 7 — hace falta modelar la jornada antes de poder distinguirlo.
const HE_NIGHT_MULTIPLIER = new Decimal("1.95");
// Días base de cálculo mensual (convención LOTTT)
const DAYS_MONTH = new Decimal("30");
// Horas de jornada diaria
const HOURS_DAY = new Decimal("8");

// ─── Interfaces públicas ──────────────────────────────────────────────────────

export interface SystemConceptRef {
  code: string;
  conceptId: string;
  // ADR-045 D-1. OBLIGATORIO a proposito: cuando era opcional, un llamador que
  // la omitia obtenia salarioNormal = 0 y las cuatro cotizaciones en CERO, sin
  // error y sin aviso. Un aporte parafiscal que desaparece en silencio es peor
  // que un build roto — que lo atrape el compilador.
  salaryNature: SalaryNature;
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
  // ADR-045 D-1/D-2: un concepto manual con incidencia salarial SI entra en la
  // base de cotizaciones. Es el caso del sueldo hibrido — la parte en divisas
  // se registra como concepto y la empresa declara su naturaleza.
  // Obligatorio por la misma razon que en SystemConceptRef.
  salaryNature: SalaryNature;
}

export interface PayrollCalculatorConfig {
  frequency: PayrollFrequency;
  ivssEnabled: boolean;
  incesEnabled: boolean;
  banavihEnabled: boolean;
  rpeEnabled: boolean;
  // Salario mínimo vigente en Bs. Cuando > 0 se aplican topes de cotización:
  //   IVSS/INCES/RPE: base ≤ 5 × salaryMinimumVes
  //   FAOV: base ≤ 10 × salaryMinimumVes
  // Cuando 0 o null: sin tope (retro-compatible con empresas sin configurar).
  salaryMinimumVes: Decimal;
  // Tasa BCV Bs./USD vigente al período (bolívares por dólar).
  // Sólo se consulta cuando hay topes configurados y algún sueldo va en dólares:
  // el tope es un monto en BOLÍVARES, y compararlo contra un sueldo en USD sin
  // convertirlo retiene de más por el factor de la tasa. La obtiene
  // PayrollRunService desde ExchangeRate — nunca del cliente (ADR-006 D-3).
  usdToVesRate?: Decimal | null;
  systemConcepts: SystemConceptRef[];
  // Alícuotas parafiscales como fracción decimal (ej: 0.04 = 4%).
  // Si no se proveen, el calculador usa los defaults hardcodeados.
  // PayrollRunService las obtiene de LegalThreshold server-side (nunca del cliente).
  ivssObrRate?: Decimal;
  ivssPatRate?: Decimal;
  incesObrRate?: Decimal;
  incesPatRate?: Decimal;
  faovObrRate?: Decimal;
  faovPatRate?: Decimal;
  rpeObrRate?: Decimal;
  rpePatRate?: Decimal;
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
  totalEmployerCosts: Decimal; // F-03: aportes patronales — no afectan neto del empleado
}

// ─── Helpers internos ────────────────────────────────────────────────────────

function findConcept(systemConcepts: SystemConceptRef[], code: string): string | undefined {
  return systemConcepts.find((c) => c.code === code)?.conceptId;
}

// Aplica el tope legal de cotización. Cuando salaryMin es 0 no hay tope.
// salaryMin YA viene en la moneda del sueldo — ver salaryMinimumInCurrency.
function cappedBasis(salary: Decimal, salaryMin: Decimal, multiples: Decimal): Decimal {
  if (salaryMin.lte(0)) return salary;
  return Decimal.min(salary, salaryMin.mul(multiples));
}

// El RPE es el único aporte con límite INFERIOR: quien gana menos del mínimo
// cotiza igual sobre un salario mínimo (LRPE Art. 46).
function clampedBasis(
  salary: Decimal, salaryMin: Decimal, floorMultiples: Decimal, ceilingMultiples: Decimal,
): Decimal {
  if (salaryMin.lte(0)) return salary;
  return salary
    .clampedTo(salaryMin.mul(floorMultiples), salaryMin.mul(ceilingMultiples));
}

export const MISSING_USD_RATE_MESSAGE =
  "Nómina en USD: registra la tasa BCV USD/VES en Contabilidad → Tasas de Cambio " +
  "antes de procesar esta nómina. Los topes legales (IVSS, FAOV, INCES, RPE) están " +
  "fijados en bolívares y no pueden aplicarse a un sueldo en dólares sin la tasa.";

export const MIXED_SALARY_MESSAGE =
  "Sueldo híbrido (VES + USD) todavía no soportado en el cálculo de nómina. " +
  "Registra el sueldo del empleado en una sola moneda.";

// H-4: los topes de cotización son múltiplos del salario mínimo, que es un monto
// en BOLÍVARES. Hasta 2026-08 se comparaban directo contra el sueldo, fuera cual
// fuera su moneda: para un sueldo en dólares eso trataba "Bs. 650" como "USD 650"
// y retenía de más exactamente por el factor de la tasa (USD 26 de IVSS donde la
// ley pide el equivalente a Bs. 26). Se convierte el TOPE, no el sueldo: el sueldo
// es el importe que se paga y no debe moverse.
function salaryMinimumInCurrency(
  salaryMinVes: Decimal,
  currency: PayrollPaymentCurrency,
  usdToVesRate: Decimal | null | undefined,
): Decimal {
  // Sin tope configurado no hay nada que convertir — ni tasa que exigir.
  if (salaryMinVes.lte(0)) return salaryMinVes;
  if (currency === "VES") return salaryMinVes;
  if (currency === "MIXED") throw new Error(MIXED_SALARY_MESSAGE);
  if (!usdToVesRate || usdToVesRate.lte(0)) throw new Error(MISSING_USD_RATE_MESSAGE);
  return salaryMinVes.dividedBy(usdToVesRate);
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
    // C-01: monedas mixtas generan totales imposibles — bloquear antes de calcular
    const currencies = new Set(employees.map((e) => e.salaryCurrency));
    if (currencies.size > 1) {
      throw new Error(
        `Nómina con monedas mixtas (${[...currencies].join(" y ")}). ` +
        "Procese por separado los empleados con sueldo en VES y en USD."
      );
    }

    // C-01-bis: un sueldo MIXED guarda un solo importe sin decir cuánto va en cada
    // moneda. No se puede ni topar ni convertir al asiento (approve() lo trataría
    // como bolívares). Se bloquea antes de producir números que parecen buenos.
    if (currencies.has("MIXED")) throw new Error(MIXED_SALARY_MESSAGE);

    const allLines: CalculatorLineOutput[] = [];

    for (const emp of employees) {
      // Los conceptos manuales se pasan al calculo del empleado en vez de
      // anadirse despues: uno con incidencia salarial forma parte de la base de
      // cotizaciones, y colgarlo al final lo dejaba fuera (ADR-045 D-4).
      allLines.push(...this.calculateEmployeeLines(
        emp, config, manualConcepts.filter((m) => m.employeeId === emp.employeeId),
      ));
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

    // EMPLOYER_COST nunca entra en totalEarnings/Deductions/Net — es costo patronal separado
    const totalEmployerCosts = allLines
      .filter((l) => l.conceptType === "EMPLOYER_COST")
      .reduce((s, l) => s.plus(l.amount), new Decimal(0));

    const totalNet = totalEarnings.minus(totalDeductions);

    if (totalNet.lessThan(0)) {
      throw new Error(
        "El neto a pagar no puede ser negativo — revisa las deducciones o el salario base"
      );
    }

    return { lines: allLines, totalEarnings, totalDeductions, totalNet, totalEmployerCosts };
  },

  /**
   * Calcula las líneas de nómina de un solo empleado.
   * Usado internamente y en tests unitarios.
   */
  calculateEmployeeLines(
    emp: EmployeeCalculationInput,
    config: PayrollCalculatorConfig,
    manualConcepts: ManualConceptCalculationInput[] = []
  ): CalculatorLineOutput[] {
    const lines: CalculatorLineOutput[] = [];
    const { systemConcepts, ivssEnabled, incesEnabled, banavihEnabled, rpeEnabled, salaryMinimumVes } = config;
    // Tasas efectivas: usa las configuradas por el admin (LegalThreshold) si existen,
    // o los defaults legales hardcodeados como fallback.
    const ivssWorkerRate  = config.ivssObrRate  ?? DEFAULT_IVSS_WORKER_RATE;
    const ivssPatRate     = config.ivssPatRate  ?? DEFAULT_IVSS_PAT_RATE;
    const incesPatRate    = config.incesPatRate ?? DEFAULT_INCES_PAT_RATE;
    const faovWorkerRate  = config.faovObrRate  ?? DEFAULT_FAOV_WORKER_RATE;
    const faovPatRate     = config.faovPatRate  ?? DEFAULT_FAOV_PAT_RATE;
    const rpeWorkerRate   = config.rpeObrRate   ?? DEFAULT_RPE_WORKER_RATE;
    const rpePatRate      = config.rpePatRate   ?? DEFAULT_RPE_PAT_RATE;
    const salary = emp.salaryAmount;
    // Tope legal llevado a la moneda del sueldo (H-4).
    const salaryMinInCurrency = salaryMinimumInCurrency(
      salaryMinimumVes, emp.salaryCurrency, config.usdToVesRate,
    );

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

    // ── Conceptos manuales del empleado ───────────────────────────────────────
    for (const m of manualConcepts) {
      lines.push({
        conceptCode: m.conceptCode,
        conceptId: m.conceptId,
        employeeId: m.employeeId,
        conceptType: m.conceptType,
        amount: m.amount,
        ...salaryBase,
      });
    }

    // ── Base de cotizaciones: el SALARIO NORMAL (ADR-045 D-4) ─────────────────
    // Hasta 2026-08 las cuatro cotizaciones salian de `salary`, el monto crudo de
    // SalaryHistory. Eso ignoraba dos cosas: que un concepto puede no tener
    // incidencia salarial (cestaticket, bono de guerra — LOTTT Art. 105 y
    // Decreto 4.805 Art. 2), y que las horas extra son salario pero NO salario
    // normal (Art. 104, tercer aparte, excluye lo accidental).
    //
    // Efecto colateral querido: las ausencias injustificadas ya reducen la base,
    // porque SAL_BASE viene prorrateado. Antes se cotizaba sobre el sueldo
    // completo aunque la persona no lo hubiera devengado.
    const natureById = new Map<string, SalaryNature>();
    for (const c of systemConcepts) natureById.set(c.conceptId, c.salaryNature);
    for (const m of manualConcepts) natureById.set(m.conceptId, m.salaryNature);

    const salarioNormal = lines
      .filter((l) =>
        l.conceptType === "EARNING" &&
        natureById.get(l.conceptId) === "SALARIO_NORMAL")
      .reduce((sum, l) => sum.plus(l.amount), new Decimal(0));

    // ── IVSS_OBR (default 4%, tope 5×salMin — solo si ivssEnabled) ─────────────
    const ivssObrId = findConcept(systemConcepts, "IVSS_OBR");
    if (ivssEnabled && ivssObrId) {
      const basis = cappedBasis(salarioNormal, salaryMinInCurrency, IVSS_CAP_MULTIPLES);
      const amount = basis.times(ivssWorkerRate).toDecimalPlaces(2);
      lines.push({
        conceptCode: "IVSS_OBR",
        conceptId: ivssObrId,
        employeeId: emp.employeeId,
        conceptType: "DEDUCTION",
        amount,
        basis,
        rate: ivssWorkerRate,
        ...salaryBase,
      });
    }

    // ── INCES_OBR: NO se calcula aquí ─────────────────────────────────────────
    // La Ley del INCES Art. 50 grava "el cero coma cinco por ciento (0,5%) de
    // sus UTILIDADES ANUALES, aguinaldos o bonificaciones de fin de año". No es
    // una deducción mensual sobre el sueldo, que es donde estaba: se le cobraba
    // al trabajador doce veces al año sobre una base que la ley no menciona.
    // Vive ahora en ProfitSharingService, al liquidar utilidades.
    // El concepto INCES_OBR se conserva para no romper el histórico de nóminas
    // ya aprobadas que lo tienen en sus líneas.

    // ── FAOV_OBR (1% sin tope — LRPVH reformada, G.O. 6.805) ──────────────────
    // PENDIENTE: la base legal es el salario INTEGRAL (normal + alícuota de
    // utilidades + alícuota de bono vacacional, Art. 122 LOTTT), no el normal.
    // Usar salarioNormal deja la base corta por las alícuotas; quitar el tope ya
    // corrige el grueso del error. El integral llega con ADR-045 D-4.
    const faovObrId = findConcept(systemConcepts, "FAOV_OBR");
    if (banavihEnabled && faovObrId) {
      const basis = salarioNormal;
      const amount = basis.times(faovWorkerRate).toDecimalPlaces(2);
      lines.push({
        conceptCode: "FAOV_OBR",
        conceptId: faovObrId,
        employeeId: emp.employeeId,
        conceptType: "DEDUCTION",
        amount,
        basis,
        rate: faovWorkerRate,
        ...salaryBase,
      });
    }

    // ── RPE_OBR (0,5% — base entre 1× y 10× salMin, LRPE Art. 46) ─────────────
    const rpeObrId = findConcept(systemConcepts, "RPE_OBR");
    if (rpeEnabled && rpeObrId) {
      const basis = clampedBasis(
        salarioNormal, salaryMinInCurrency, RPE_FLOOR_MULTIPLES, RPE_CAP_MULTIPLES,
      );
      const amount = basis.times(rpeWorkerRate).toDecimalPlaces(2);
      lines.push({
        conceptCode: "RPE_OBR",
        conceptId: rpeObrId,
        employeeId: emp.employeeId,
        conceptType: "DEDUCTION",
        amount,
        basis,
        rate: rpeWorkerRate,
        ...salaryBase,
      });
    }

    // ── F-03: Aportes patronales — EMPLOYER_COST (no afectan neto del empleado) ─
    // ── IVSS_PAT (default 9%, tope 5×salMin — LSS Art. 62) ──────────────────────
    const ivssPatId = findConcept(systemConcepts, "IVSS_PAT");
    if (ivssEnabled && ivssPatId) {
      const basis = cappedBasis(salarioNormal, salaryMinInCurrency, IVSS_CAP_MULTIPLES);
      const amount = basis.times(ivssPatRate).toDecimalPlaces(2);
      lines.push({
        conceptCode: "IVSS_PAT",
        conceptId: ivssPatId,
        employeeId: emp.employeeId,
        conceptType: "EMPLOYER_COST",
        amount,
        basis,
        rate: ivssPatRate,
        ...salaryBase,
      });
    }

    // ── INCES_PAT (2% del salario normal, SIN TOPE — Ley INCES Art. 49) ────────
    // Art. 49 fija la base sin límite superior; el tope de 5× que se aplicaba
    // aquí no sale de la Ley. Falta además el supuesto de aplicación: sólo
    // aplica a entidades con cinco o más trabajadores.
    const incesPatId = findConcept(systemConcepts, "INCES_PAT");
    if (incesEnabled && incesPatId) {
      const basis = salarioNormal;
      const amount = basis.times(incesPatRate).toDecimalPlaces(2);
      lines.push({
        conceptCode: "INCES_PAT",
        conceptId: incesPatId,
        employeeId: emp.employeeId,
        conceptType: "EMPLOYER_COST",
        amount,
        basis,
        rate: incesPatRate,
        ...salaryBase,
      });
    }

    // ── FAOV_PAT (2% sin tope — LRPVH reformada, G.O. 6.805) ──────────────────
    const faovPatId = findConcept(systemConcepts, "FAOV_PAT");
    if (banavihEnabled && faovPatId) {
      const basis = salarioNormal;
      const amount = basis.times(faovPatRate).toDecimalPlaces(2);
      lines.push({
        conceptCode: "FAOV_PAT",
        conceptId: faovPatId,
        employeeId: emp.employeeId,
        conceptType: "EMPLOYER_COST",
        amount,
        basis,
        rate: faovPatRate,
        ...salaryBase,
      });
    }

    // ── RPE_PAT (2% — misma base que el obrero: 1× a 10×, LRPE Art. 46) ───────
    const rpePatId = findConcept(systemConcepts, "RPE_PAT");
    if (rpeEnabled && rpePatId) {
      const basis = clampedBasis(
        salarioNormal, salaryMinInCurrency, RPE_FLOOR_MULTIPLES, RPE_CAP_MULTIPLES,
      );
      const amount = basis.times(rpePatRate).toDecimalPlaces(2);
      lines.push({
        conceptCode: "RPE_PAT",
        conceptId: rpePatId,
        employeeId: emp.employeeId,
        conceptType: "EMPLOYER_COST",
        amount,
        basis,
        rate: rpePatRate,
        ...salaryBase,
      });
    }

    return lines;
  },
};
