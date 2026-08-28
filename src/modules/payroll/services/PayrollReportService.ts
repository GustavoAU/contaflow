// src/modules/payroll/services/PayrollReportService.ts
// Fase NOM-E: Reportes legales de nómina — IVSS, Banavih/FAOV, INCES, ARC/ISLR
//
// Seguridad (ADR-006 D-3):
//   Todas las tasas patronales son CONSTANTES INTERNAS — nunca del cliente.
//   El servicio es read-only: nunca escribe en DB, nunca genera asientos.
//
// NOM-E-01: Los reportes incluyen empleados ACTIVE aunque no tengan runs en el período
//   (Opción A acordada) — cumplen LSS Art. 62 (Forma 14-02 declara todos los inscritos).
// NOM-E-02: utValue NULL → techo IVSS no aplicado, reporte lo indica.
// NOM-E-03: ARC usa ingresos reales del año (no proyección) — correcto para Forma ARC.

import Decimal from "decimal.js";
import prisma from "@/lib/prisma";

// ─── Tasas y topes legales ────────────────────────────────────────────────────
// Viven en PayrollCalculatorService: lo que se declara al instituto tiene que ser
// exactamente lo que se calculó en la nómina, así que este archivo los importa
// en vez de tener los suyos.
//
// Aquí había cuatro constantes propias, todas citadas a leyes derogadas (LSS
// Art. 62, LAH Art. 172, Ley INCES 2008 Art. 30) y ninguna coincidía con la ley
// vigente: el techo del IVSS no son 10 UT sino 5 salarios mínimos (Reglamento
// Art. 98), la patronal del IVSS depende de la clase de riesgo, el FAOV patronal
// es 2% y no 1%, y el 0,5% sobre utilidades es retención AL TRABAJADOR (Ley
// INCES Art. 50), no aporte patronal.
//
// Las cotizaciones patronales de FAOV e INCES ya no se recalculan aquí: se leen
// de las líneas FAOV_PAT / INCES_PAT devengadas.
import {
  IVSS_PAT_RATE_BY_RISK,
  IVSS_CAP_MULTIPLES,
} from "./PayrollCalculatorService";

// ─── ISLR Decreto 1808 — Tarifa 1 (personas naturales residentes) ─────────────
// Expresada en Unidades Tributarias (UT). Escalonada — se aplica tramo a tramo.
// Sustraendo en UT = lo que se acumuló en tramos anteriores (evitar doble cálculo).
export const ISLR_DESGRAVAMEN_UT = new Decimal("774"); // Decreto 1808 Art. 60

export interface IslrBracket {
  fromUT: Decimal;
  toUT: Decimal | null; // null = sin límite superior
  rate: Decimal;
  sustraendoUT: Decimal; // impuesto ya pagado en tramos anteriores (en UT)
}

export const ISLR_BRACKETS: IslrBracket[] = [
  { fromUT: new Decimal(0), toUT: new Decimal(1000), rate: new Decimal("0"), sustraendoUT: new Decimal("0") },
  { fromUT: new Decimal(1000), toUT: new Decimal(1500), rate: new Decimal("0.06"), sustraendoUT: new Decimal("60") },
  { fromUT: new Decimal(1500), toUT: new Decimal(2000), rate: new Decimal("0.09"), sustraendoUT: new Decimal("105") },
  { fromUT: new Decimal(2000), toUT: new Decimal(2500), rate: new Decimal("0.12"), sustraendoUT: new Decimal("165") },
  { fromUT: new Decimal(2500), toUT: new Decimal(3000), rate: new Decimal("0.16"), sustraendoUT: new Decimal("265") },
  { fromUT: new Decimal(3000), toUT: new Decimal(4000), rate: new Decimal("0.22"), sustraendoUT: new Decimal("445") },
  { fromUT: new Decimal(4000), toUT: null, rate: new Decimal("0.34"), sustraendoUT: new Decimal("925") },
];

// ─── DTOs de reporte ──────────────────────────────────────────────────────────

export interface ReportEmployeeSnap {
  employeeId: string;
  firstName: string;
  lastName: string;
  cedulaType: string;
  cedulaNumber: string;
}

export interface IvssEmployeeRow extends ReportEmployeeSnap {
  weeksWorked: number;         // semanas cotizadas en el mes (días / 7, techo al entero)
  salaryBase: Decimal;         // suma SAL_BASE del mes
  ivssWorkerAmount: Decimal;   // suma IVSS_OBR de PayrollRunLine
  ivssEmployerAmount: Decimal; // min(salaryBase, 5 salarios mínimos) por tasa de riesgo
  ivssTotalAmount: Decimal;
}

export interface IvssReportData {
  companyId: string;
  companyName: string;
  year: number;
  month: number;             // 1-12
  utValue: Decimal | null;   // null = no configurado
  // true si el techo de 5 salarios mínimos se pudo aplicar (Reglamento Art. 98).
  // Depende del salario mínimo configurado, no de la UT.
  salaryCapApplied: boolean;
  rows: IvssEmployeeRow[];
  totalWorkerAmount: Decimal;
  totalEmployerAmount: Decimal;
  totalAmount: Decimal;
}

export interface BanavihEmployeeRow extends ReportEmployeeSnap {
  salaryBase: Decimal;
  faovWorkerAmount: Decimal;   // suma FAOV_OBR de PayrollRunLine
  faovEmployerAmount: Decimal; // calculado: salaryBase × 1%
  faovTotalAmount: Decimal;
}

export interface BanavihReportData {
  companyId: string;
  companyName: string;
  year: number;
  month: number;
  rows: BanavihEmployeeRow[];
  totalWorkerAmount: Decimal;
  totalEmployerAmount: Decimal;
  totalAmount: Decimal;
}

export interface IncesEmployeeRow extends ReportEmployeeSnap {
  salaryBase: Decimal;          // suma SAL_BASE del trimestre
  // Ley INCES Art. 50 - 0,5% de las UTILIDADES, retenido al trabajador.
  incesWorkerAmount: Decimal;
  // Ley INCES Art. 49 - 2% del salario normal, a cargo del patrono (INCES_PAT).
  incesEmployerAmount: Decimal;
  profitAmount: Decimal;        // utilidades del año (ProfitSharingRecord)
}

export interface IncesReportData {
  companyId: string;
  companyName: string;
  year: number;
  quarter: number;              // 1-4
  rows: IncesEmployeeRow[];
  totalWorkerAmount: Decimal;   // Art. 50 - retenido a los trabajadores
  totalEmployerAmount: Decimal; // Art. 49 - a cargo del patrono
  totalAmount: Decimal;
}

export interface ArcReportData {
  companyId: string;
  companyName: string;
  year: number;
  employee: ReportEmployeeSnap;
  totalEarnings: Decimal;       // SAL_BASE + HE_DIURNA + HE_NOCTURNA del año
  profitAmount: Decimal;        // utilidades del año (ProfitSharingRecord)
  vacationBonus: Decimal;       // bono vacacional del año (VacationRecord.bonusAmount)
  totalGrossIncome: Decimal;    // earnings + profit + vacationBonus
  desgravamen: Decimal;         // 774 UT × utValue (0 si utValue null)
  taxableIncome: Decimal;       // max(0, totalGrossIncome - desgravamen)
  taxableIncomeUT: Decimal;     // taxableIncome / utValue (0 si utValue null)
  islrAmount: Decimal;          // ISLR calculado con tabla Decreto 1808
  withheldAmount: Decimal;      // retenido efectivamente (ISLR_EMP en PayrollRunLine)
  utValue: Decimal | null;
}

// ─── Helpers internos ──────────────────────────────────────────────────────────

/** Meses del trimestre 1-4: [[1,2,3],[4,5,6],[7,8,9],[10,11,12]] */
function quarterMonths(quarter: number): number[] {
  const base = (quarter - 1) * 3 + 1;
  return [base, base + 1, base + 2];
}

/**
 * Calcula ISLR (en Bs) para una renta gravable en UT.
 * Usa la Tarifa 1 Decreto 1808 con sustraendo.
 * Si utValue es null → no se puede expresar en Bs → retorna Decimal(0).
 */
export function calcularIslr(rentaGravableUT: Decimal, utValue: Decimal | null): Decimal {
  if (utValue === null || rentaGravableUT.lte(0)) return new Decimal(0);

  const bracket = ISLR_BRACKETS.slice().reverse().find(
    (b) => rentaGravableUT.gt(b.fromUT)
  );
  if (!bracket || bracket.rate.isZero()) return new Decimal(0);

  // ISLR en UT = rentaGravable × tasa - sustraendo
  const islrUT = rentaGravableUT.times(bracket.rate).minus(bracket.sustraendoUT);
  // Convertir a Bs
  return Decimal.max(new Decimal(0), islrUT.times(utValue)).toDecimalPlaces(2);
}

/** Días entre dos fechas (inclusive), para calcular semanas cotizadas. */
function daysBetween(start: Date, end: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((end.getTime() - start.getTime()) / msPerDay) + 1;
}

// ─── PayrollReportService ──────────────────────────────────────────────────────

export const PayrollReportService = {
  // ── getIvssReport ────────────────────────────────────────────────────────────
  /**
   * Planilla IVSS Forma 14-02 — mensual.
   * Incluye todos los empleados ACTIVE (con o sin runs) — NOM-E-01.
   */
  async getIvssReport(companyId: string, year: number, month: number): Promise<IvssReportData> {
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { name: true },
    });

    const config = await prisma.payrollConfig.findUnique({
      where: { companyId },
      select: { utValue: true, salaryMinimumVes: true, ivssRiskClass: true },
    });
    const utValue = config?.utValue ? new Decimal(config.utValue.toString()) : null;

    // Todos los empleados ACTIVE de la empresa
    const employees = await prisma.employee.findMany({
      where: { companyId, status: "ACTIVE" },
      select: {
        id: true, firstName: true, lastName: true,
        cedulaType: true, cedulaNumber: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    // Runs APPROVED del mes
    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const periodEnd = new Date(Date.UTC(year, month, 0)); // último día del mes

    const runs = await prisma.payrollRun.findMany({
      where: {
        companyId,
        status: "APPROVED",
        periodStart: { gte: periodStart },
        periodEnd: { lte: periodEnd },
      },
      select: { id: true, periodStart: true, periodEnd: true },
    });

    const runIds = runs.map((r) => r.id);

    // Líneas IVSS y SAL_BASE de esos runs
    const lines = runIds.length > 0
      ? await prisma.payrollRunLine.findMany({
          where: {
            payrollRunId: { in: runIds },
            conceptCode: { in: ["IVSS_OBR", "SAL_BASE"] },
          },
          select: {
            employeeId: true, payrollRunId: true,
            conceptCode: true, amount: true,
          },
        })
      : [];

    // Agrupar líneas y días por empleado
    type EmpAgg = {
      ivssOBR: Decimal;
      salBase: Decimal;
      daysWorked: number;
    };
    const aggByEmp = new Map<string, EmpAgg>();

    for (const line of lines) {
      if (!aggByEmp.has(line.employeeId)) {
        aggByEmp.set(line.employeeId, {
          ivssOBR: new Decimal(0),
          salBase: new Decimal(0),
          daysWorked: 0,
        });
      }
      const agg = aggByEmp.get(line.employeeId)!;
      if (line.conceptCode === "IVSS_OBR") {
        agg.ivssOBR = agg.ivssOBR.plus(new Decimal(line.amount.toString()));
      } else if (line.conceptCode === "SAL_BASE") {
        agg.salBase = agg.salBase.plus(new Decimal(line.amount.toString()));
      }
    }

    // Sumar días trabajados por run (para semanas cotizadas)
    for (const run of runs) {
      const runLines = lines.filter((l) =>
        l.payrollRunId === run.id && l.conceptCode === "SAL_BASE"
      );
      const runEmployeeIds = new Set(runLines.map((l) => l.employeeId));
      const days = daysBetween(new Date(run.periodStart), new Date(run.periodEnd));
      for (const empId of runEmployeeIds) {
        const agg = aggByEmp.get(empId);
        if (agg) agg.daysWorked += days;
      }
    }

    // Reglamento General de la LSS Art. 98: el techo de cotización son CINCO
    // salarios mínimos mensuales. Antes se calculaba como 10 UT — base
    // equivocada (la UT no gobierna este techo) y además congelada hace años.
    const salaryMinVes = config?.salaryMinimumVes
      ? new Decimal(config.salaryMinimumVes.toString())
      : null;
    const salaryCap = salaryMinVes && salaryMinVes.gt(0)
      ? salaryMinVes.times(IVSS_CAP_MULTIPLES)
      : null;

    // LSS Art. 59: la cotización patronal depende de la clase de riesgo que
    // declara la empresa (mínimo 9% / medio 10% / máximo 11%). Estaba fija en 9%.
    const ivssEmployerRate = IVSS_PAT_RATE_BY_RISK[config?.ivssRiskClass ?? "MEDIO"];

    let totalWorkerAmount = new Decimal(0);
    let totalEmployerAmount = new Decimal(0);

    const rows: IvssEmployeeRow[] = employees.map((emp) => {
      const agg = aggByEmp.get(emp.id);
      const salaryBase = agg?.salBase ?? new Decimal(0);
      const ivssWorkerAmount = (agg?.ivssOBR ?? new Decimal(0)).toDecimalPlaces(2);

      // Base patronal: min(salaryBase, cap) — si cap es null usa salaryBase completo
      const basePatronal = salaryCap
        ? Decimal.min(salaryBase, salaryCap)
        : salaryBase;
      const ivssEmployerAmount = basePatronal.times(ivssEmployerRate).toDecimalPlaces(2);

      // Semanas cotizadas: días / 7, redondeado al entero (IVSS cuenta semanas completas)
      const weeksWorked = agg?.daysWorked
        ? Math.ceil(agg.daysWorked / 7)
        : 0;

      totalWorkerAmount = totalWorkerAmount.plus(ivssWorkerAmount);
      totalEmployerAmount = totalEmployerAmount.plus(ivssEmployerAmount);

      return {
        employeeId: emp.id,
        firstName: emp.firstName,
        lastName: emp.lastName,
        cedulaType: emp.cedulaType,
        cedulaNumber: emp.cedulaNumber,
        weeksWorked,
        salaryBase: salaryBase.toDecimalPlaces(2),
        ivssWorkerAmount,
        ivssEmployerAmount,
        ivssTotalAmount: ivssWorkerAmount.plus(ivssEmployerAmount),
      };
    });

    return {
      companyId,
      companyName: company.name,
      year,
      month,
      utValue,
      salaryCapApplied: salaryCap !== null,
      rows,
      totalWorkerAmount: totalWorkerAmount.toDecimalPlaces(2),
      totalEmployerAmount: totalEmployerAmount.toDecimalPlaces(2),
      totalAmount: totalWorkerAmount.plus(totalEmployerAmount).toDecimalPlaces(2),
    };
  },

  // ── getBanavihReport ─────────────────────────────────────────────────────────
  /**
   * Planilla Banavih/FAOV — mensual.
   * Incluye todos los empleados ACTIVE — NOM-E-01.
   */
  async getBanavihReport(companyId: string, year: number, month: number): Promise<BanavihReportData> {
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { name: true },
    });

    const employees = await prisma.employee.findMany({
      where: { companyId, status: "ACTIVE" },
      select: {
        id: true, firstName: true, lastName: true,
        cedulaType: true, cedulaNumber: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const periodEnd = new Date(Date.UTC(year, month, 0));

    const runIds = (await prisma.payrollRun.findMany({
      where: { companyId, status: "APPROVED", periodStart: { gte: periodStart }, periodEnd: { lte: periodEnd } },
      select: { id: true },
    })).map((r) => r.id);

    const lines = runIds.length > 0
      ? await prisma.payrollRunLine.findMany({
          where: {
            payrollRunId: { in: runIds },
            conceptCode: { in: ["FAOV_OBR", "FAOV_PAT", "SAL_BASE"] },
          },
          select: { employeeId: true, conceptCode: true, amount: true },
        })
      : [];

    type EmpAgg = { faovOBR: Decimal; faovPAT: Decimal; salBase: Decimal };
    const agg = new Map<string, EmpAgg>();
    for (const line of lines) {
      if (!agg.has(line.employeeId)) {
        agg.set(line.employeeId, { faovOBR: new Decimal(0), faovPAT: new Decimal(0), salBase: new Decimal(0) });
      }
      const e = agg.get(line.employeeId)!;
      if (line.conceptCode === "FAOV_OBR") e.faovOBR = e.faovOBR.plus(line.amount.toString());
      else if (line.conceptCode === "FAOV_PAT") e.faovPAT = e.faovPAT.plus(line.amount.toString());
      else if (line.conceptCode === "SAL_BASE") e.salBase = e.salBase.plus(line.amount.toString());
    }

    let totalWorker = new Decimal(0);
    let totalEmployer = new Decimal(0);

    const rows: BanavihEmployeeRow[] = employees.map((emp) => {
      const e = agg.get(emp.id);
      const salaryBase = (e?.salBase ?? new Decimal(0)).toDecimalPlaces(2);
      const faovWorkerAmount = (e?.faovOBR ?? new Decimal(0)).toDecimalPlaces(2);
      // Se lee de la linea FAOV_PAT realmente devengada en vez de recalcular
      // sobre SAL_BASE: la base legal es el salario INTEGRAL (LRPVH Art. 33.1),
      // no el normal que suma SAL_BASE, y recalcular aqui volveria a separar lo
      // que se declara de lo que se calculo.
      const faovEmployerAmount = (e?.faovPAT ?? new Decimal(0)).toDecimalPlaces(2);
      totalWorker = totalWorker.plus(faovWorkerAmount);
      totalEmployer = totalEmployer.plus(faovEmployerAmount);
      return {
        employeeId: emp.id, firstName: emp.firstName, lastName: emp.lastName,
        cedulaType: emp.cedulaType, cedulaNumber: emp.cedulaNumber,
        salaryBase, faovWorkerAmount, faovEmployerAmount,
        faovTotalAmount: faovWorkerAmount.plus(faovEmployerAmount),
      };
    });

    return {
      companyId, companyName: company.name, year, month, rows,
      totalWorkerAmount: totalWorker.toDecimalPlaces(2),
      totalEmployerAmount: totalEmployer.toDecimalPlaces(2),
      totalAmount: totalWorker.plus(totalEmployer).toDecimalPlaces(2),
    };
  },

  // ── getIncesReport ───────────────────────────────────────────────────────────
  /**
   * Planilla INCES — trimestral.
   * 2% obrero (ya en INCES_OBR) + 0.5% patrono sobre utilidades anuales.
   * Incluye todos los empleados ACTIVE — NOM-E-01.
   */
  async getIncesReport(companyId: string, year: number, quarter: number): Promise<IncesReportData> {
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { name: true },
    });

    const employees = await prisma.employee.findMany({
      where: { companyId, status: "ACTIVE" },
      select: {
        id: true, firstName: true, lastName: true,
        cedulaType: true, cedulaNumber: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    const months = quarterMonths(quarter);
    const periodStart = new Date(Date.UTC(year, months[0] - 1, 1));
    const periodEnd = new Date(Date.UTC(year, months[2], 0)); // último día del último mes del trimestre

    const runIds = (await prisma.payrollRun.findMany({
      where: { companyId, status: "APPROVED", periodStart: { gte: periodStart }, periodEnd: { lte: periodEnd } },
      select: { id: true },
    })).map((r) => r.id);

    const lines = runIds.length > 0
      ? await prisma.payrollRunLine.findMany({
          where: {
            payrollRunId: { in: runIds },
            conceptCode: { in: ["INCES_OBR", "INCES_PAT", "SAL_BASE"] },
          },
          select: { employeeId: true, conceptCode: true, amount: true },
        })
      : [];

    // Ley INCES Art. 50: el aporte del TRABAJADOR es el 0,5% de las utilidades
    // y se entera en el trimestre en que las utilidades se pagaron — no es una
    // deducción mensual sobre el sueldo. Vive en ProfitSharingRecord.incesRetention.
    //
    // Se filtra por la fecha de pago (createdAt) y NO por isFractional: la
    // fracción de utilidades de una liquidación también causa la retención, y
    // filtrarla dejaba fuera del trimestre a todo el que se liquidó en él.
    const quarterEndExclusive = new Date(Date.UTC(year, months[2], 1));
    const profitRecords = await prisma.profitSharingRecord.findMany({
      where: {
        companyId,
        createdAt: { gte: periodStart, lt: quarterEndExclusive },
      },
      select: { employeeId: true, profitAmount: true, incesRetention: true },
    });
    const profitByEmp = new Map<string, { profit: Decimal; retention: Decimal }>();
    for (const pr of profitRecords) {
      const prev = profitByEmp.get(pr.employeeId);
      profitByEmp.set(pr.employeeId, {
        profit: (prev?.profit ?? new Decimal(0)).plus(pr.profitAmount.toString()),
        retention: (prev?.retention ?? new Decimal(0)).plus(pr.incesRetention.toString()),
      });
    }

    type EmpAgg = { incesOBR: Decimal; incesPAT: Decimal; salBase: Decimal };
    const agg = new Map<string, EmpAgg>();
    for (const line of lines) {
      if (!agg.has(line.employeeId)) {
        agg.set(line.employeeId, { incesOBR: new Decimal(0), incesPAT: new Decimal(0), salBase: new Decimal(0) });
      }
      const e = agg.get(line.employeeId)!;
      if (line.conceptCode === "INCES_OBR") e.incesOBR = e.incesOBR.plus(line.amount.toString());
      else if (line.conceptCode === "INCES_PAT") e.incesPAT = e.incesPAT.plus(line.amount.toString());
      else if (line.conceptCode === "SAL_BASE") e.salBase = e.salBase.plus(line.amount.toString());
    }

    let totalWorker = new Decimal(0);
    let totalEmployer = new Decimal(0);

    const rows: IncesEmployeeRow[] = employees.map((emp) => {
      const e = agg.get(emp.id);
      const p = profitByEmp.get(emp.id);

      // INCES_OBR sólo existe en nóminas anteriores a ADR-045, cuando el 0,5% se
      // retenía mensualmente sobre el sueldo. Se sigue sumando para que los
      // trimestres ya declarados no pasen a mostrar cero al abrir el reporte.
      const incesWorkerAmount = (e?.incesOBR ?? new Decimal(0))
        .plus(p?.retention ?? new Decimal(0))
        .toDecimalPlaces(2);

      // Art. 49: 2% del salario normal, a cargo del patrono. Se lee de la línea
      // realmente devengada (INCES_PAT), no se recalcula, para que el reporte no
      // pueda diferir de la nómina que lo originó.
      const incesEmployerAmount = (e?.incesPAT ?? new Decimal(0)).toDecimalPlaces(2);

      const profitAmount = (p?.profit ?? new Decimal(0)).toDecimalPlaces(2);
      totalWorker = totalWorker.plus(incesWorkerAmount);
      totalEmployer = totalEmployer.plus(incesEmployerAmount);
      return {
        employeeId: emp.id, firstName: emp.firstName, lastName: emp.lastName,
        cedulaType: emp.cedulaType, cedulaNumber: emp.cedulaNumber,
        salaryBase: (e?.salBase ?? new Decimal(0)).toDecimalPlaces(2),
        incesWorkerAmount, incesEmployerAmount, profitAmount,
      };
    });

    return {
      companyId, companyName: company.name, year, quarter, rows,
      totalWorkerAmount: totalWorker.toDecimalPlaces(2),
      totalEmployerAmount: totalEmployer.toDecimalPlaces(2),
      totalAmount: totalWorker.plus(totalEmployer).toDecimalPlaces(2),
    };
  },

  // ── getArcReport ─────────────────────────────────────────────────────────────
  /**
   * Comprobante ARC/ISLR — anual, por empleado.
   * Usa ingresos REALES del año (no proyección) — NOM-E-03.
   * Decreto 1808 Tarifa 1 + desgravamen 774 UT.
   */
  async getArcReport(companyId: string, employeeId: string, year: number): Promise<ArcReportData> {
    const [company, employee] = await Promise.all([
      prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } }),
      prisma.employee.findFirstOrThrow({
        where: { id: employeeId, companyId },
        select: { id: true, firstName: true, lastName: true, cedulaType: true, cedulaNumber: true },
      }),
    ]);

    const config = await prisma.payrollConfig.findUnique({
      where: { companyId },
      select: { utValue: true },
    });
    const utValue = config?.utValue ? new Decimal(config.utValue.toString()) : null;

    // Todos los runs APPROVED del año
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year, 11, 31));

    const runIds = (await prisma.payrollRun.findMany({
      where: { companyId, status: "APPROVED", periodStart: { gte: yearStart }, periodEnd: { lte: yearEnd } },
      select: { id: true },
    })).map((r) => r.id);

    // Líneas de ingresos del empleado en el año
    const earningCodes = ["SAL_BASE", "HE_DIURNA", "HE_NOCTURNA"];
    const lines = runIds.length > 0
      ? await prisma.payrollRunLine.findMany({
          where: {
            payrollRunId: { in: runIds },
            employeeId,
            conceptCode: { in: [...earningCodes, "ISLR_EMP"] },
          },
          select: { conceptCode: true, amount: true },
        })
      : [];

    let totalEarnings = new Decimal(0);
    let withheldAmount = new Decimal(0);
    for (const line of lines) {
      const amt = new Decimal(line.amount.toString());
      if (earningCodes.includes(line.conceptCode)) totalEarnings = totalEarnings.plus(amt);
      else if (line.conceptCode === "ISLR_EMP") withheldAmount = withheldAmount.plus(amt);
    }

    // Utilidades y bono vacacional del año
    const [profitRecord, vacationRecord] = await Promise.all([
      prisma.profitSharingRecord.findFirst({
        where: { companyId, employeeId, fiscalYear: year, isFractional: false },
        select: { profitAmount: true },
      }),
      prisma.vacationRecord.findFirst({
        where: { companyId, employeeId, periodYear: year, isFractional: false },
        select: { bonusAmount: true },
      }),
    ]);

    const profitAmount = profitRecord
      ? new Decimal(profitRecord.profitAmount.toString()).toDecimalPlaces(2)
      : new Decimal(0);
    const vacationBonus = vacationRecord
      ? new Decimal(vacationRecord.bonusAmount.toString()).toDecimalPlaces(2)
      : new Decimal(0);

    const totalGrossIncome = totalEarnings.plus(profitAmount).plus(vacationBonus).toDecimalPlaces(2);

    // Desgravamen: 774 UT × utValue (si utValue es null → 0)
    const desgravamen = utValue
      ? ISLR_DESGRAVAMEN_UT.times(utValue).toDecimalPlaces(2)
      : new Decimal(0);

    const taxableIncome = Decimal.max(new Decimal(0), totalGrossIncome.minus(desgravamen)).toDecimalPlaces(2);

    // Renta gravable en UT (para aplicar tabla Tarifa 1)
    const taxableIncomeUT = utValue && utValue.gt(0)
      ? taxableIncome.dividedBy(utValue).toDecimalPlaces(4)
      : new Decimal(0);

    const islrAmount = calcularIslr(taxableIncomeUT, utValue);

    return {
      companyId, companyName: company.name, year,
      employee: {
        employeeId: employee.id, firstName: employee.firstName,
        lastName: employee.lastName, cedulaType: employee.cedulaType,
        cedulaNumber: employee.cedulaNumber,
      },
      totalEarnings: totalEarnings.toDecimalPlaces(2),
      profitAmount, vacationBonus, totalGrossIncome,
      desgravamen, taxableIncome, taxableIncomeUT,
      islrAmount: islrAmount.toDecimalPlaces(2),
      withheldAmount: withheldAmount.toDecimalPlaces(2),
      utValue,
    };
  },
};
