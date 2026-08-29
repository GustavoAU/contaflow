// src/modules/payroll/__tests__/PayrollReportService.test.ts
// Fase NOM-E: Tests del servicio de reportes legales (puro — sin DB directa en cálculos)
// Los cálculos de IVSS, Banavih, INCES y ARC son determinísticos; se testean con mocks de Prisma.

import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  default: {
    company: { findUniqueOrThrow: vi.fn() },
    payrollConfig: { findUnique: vi.fn() },
    employee: { findMany: vi.fn(), findFirstOrThrow: vi.fn() },
    payrollRun: { findMany: vi.fn() },
    payrollRunLine: { findMany: vi.fn() },
    profitSharingRecord: { findMany: vi.fn(), findFirst: vi.fn() },
    vacationRecord: { findFirst: vi.fn() },
  },
}));

import prisma from "@/lib/prisma";
import {
  PayrollReportService,
  calcularIslr,
} from "../services/PayrollReportService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_ID = "co-1";
const EMP_ID = "emp-1";
const EMP_ID_2 = "emp-2";

const COMPANY = { name: "Empresa Demo C.A." };

const EMPLOYEES = [
  { id: EMP_ID, firstName: "Ana", lastName: "García", cedulaType: "V", cedulaNumber: "12345678" },
  { id: EMP_ID_2, firstName: "Luis", lastName: "Pérez", cedulaType: "V", cedulaNumber: "87654321" },
];

// Salario mínimo 800 Bs → techo IVSS = 5 × 800 = 4000 Bs (Reglamento LSS Art. 98).
const CONFIG_FULL = {
  utValue: new Decimal("400.00"),
  salaryMinimumVes: new Decimal("800.00"),
  ivssRiskClass: "MEDIO",
};
const CONFIG_EMPTY = { utValue: null, salaryMinimumVes: null, ivssRiskClass: "MEDIO" };

const RUN_APR = { id: "run-apr", periodStart: new Date("2026-04-01"), periodEnd: new Date("2026-04-30") };
const RUN_Q1_JAN = { id: "run-jan", periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") };

// ─── calcularIslr (Decreto 1808 Tarifa 1) ────────────────────────────────────

describe("calcularIslr", () => {
  const UT = new Decimal("400"); // 1 UT = 400 Bs

  it("renta = 0 → ISLR = 0", () => {
    expect(calcularIslr(new Decimal(0), UT).toNumber()).toBe(0);
  });

  it("renta ≤ 1000 UT → tasa 0% → ISLR = 0", () => {
    expect(calcularIslr(new Decimal(999), UT).toNumber()).toBe(0);
    expect(calcularIslr(new Decimal(1000), UT).toNumber()).toBe(0);
  });

  it("renta 1200 UT → tramo 6%, sustraendo 60 UT → ISLR = (1200×0.06 − 60) × 400", () => {
    // ISLR_UT = 1200 × 0.06 - 60 = 72 - 60 = 12 UT → en Bs = 12 × 400 = 4800
    const result = calcularIslr(new Decimal(1200), UT);
    expect(result.toNumber()).toBe(4800);
  });

  it("renta 2000 UT → tramo 9%, sustraendo 105 UT → ISLR = (2000×0.09 − 105) × 400", () => {
    // ISLR_UT = 180 - 105 = 75 UT → 75 × 400 = 30000 Bs
    const result = calcularIslr(new Decimal(2000), UT);
    expect(result.toNumber()).toBe(30000);
  });

  it("renta 5000 UT → tramo 34%, sustraendo 925 UT → ISLR = (5000×0.34 − 925) × 400", () => {
    // ISLR_UT = 1700 - 925 = 775 UT → 775 × 400 = 310000 Bs
    const result = calcularIslr(new Decimal(5000), UT);
    expect(result.toNumber()).toBe(310000);
  });

  it("utValue null → ISLR = 0", () => {
    expect(calcularIslr(new Decimal(2000), null).toNumber()).toBe(0);
  });

  it("renta negativa → ISLR = 0", () => {
    expect(calcularIslr(new Decimal(-100), UT).toNumber()).toBe(0);
  });
});

// ─── getIvssReport ────────────────────────────────────────────────────────────

describe("PayrollReportService.getIvssReport", () => {
  beforeEach(() => {
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValue(COMPANY as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue(EMPLOYEES as never);
  });

  it("declara el patronal devengado, no lo recalcula", async () => {
    // Salario 3000 Bs, techo = 5 × 800 = 4000 Bs → salario ≤ techo
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(CONFIG_FULL as never);
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([RUN_APR] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { employeeId: EMP_ID, payrollRunId: "run-apr", conceptCode: "SAL_BASE", amount: new Decimal("3000") },
      { employeeId: EMP_ID, payrollRunId: "run-apr", conceptCode: "IVSS_OBR", amount: new Decimal("120") },
      { employeeId: EMP_ID, payrollRunId: "run-apr", conceptCode: "IVSS_PAT", amount: new Decimal("300") },
      { employeeId: EMP_ID_2, payrollRunId: "run-apr", conceptCode: "SAL_BASE", amount: new Decimal("2000") },
      { employeeId: EMP_ID_2, payrollRunId: "run-apr", conceptCode: "IVSS_OBR", amount: new Decimal("80") },
    ] as never);

    const report = await PayrollReportService.getIvssReport(COMPANY_ID, 2026, 4);

    const row1 = report.rows.find((r) => r.employeeId === EMP_ID)!;
    // El patronal sale de la línea IVSS_PAT que dejó la nómina, donde ya se
    // aplicaron el techo (Art. 98), la tasa por clase de riesgo (Art. 109) y la
    // base semanal (Art. 99). Recalcularlo aquí sobre SAL_BASE —el sueldo del
    // MES— declararía una cifra distinta de la que se retuvo y se contabilizó.
    expect(row1.ivssEmployerAmount.toNumber()).toBe(300);
    expect(row1.ivssWorkerAmount.toNumber()).toBe(120);
    expect(row1.ivssTotalAmount.toNumber()).toBe(420);
  });

  it("con salario mínimo configurado marca salaryCapApplied", async () => {
    // Salario 5000 Bs, techo = 5 × 800 = 4000 Bs → patronal sobre 4000
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(CONFIG_FULL as never);
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([RUN_APR] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { employeeId: EMP_ID, payrollRunId: "run-apr", conceptCode: "SAL_BASE", amount: new Decimal("5000") },
      { employeeId: EMP_ID, payrollRunId: "run-apr", conceptCode: "IVSS_OBR", amount: new Decimal("200") },
      { employeeId: EMP_ID, payrollRunId: "run-apr", conceptCode: "IVSS_PAT", amount: new Decimal("400") },
      { employeeId: EMP_ID_2, payrollRunId: "run-apr", conceptCode: "SAL_BASE", amount: new Decimal("5000") },
      { employeeId: EMP_ID_2, payrollRunId: "run-apr", conceptCode: "IVSS_OBR", amount: new Decimal("200") },
    ] as never);

    const report = await PayrollReportService.getIvssReport(COMPANY_ID, 2026, 4);

    const row1 = report.rows.find((r) => r.employeeId === EMP_ID)!;
    // La linea IVSS_PAT ya viene topada por el calculador.
    expect(row1.ivssEmployerAmount.toNumber()).toBe(400);
    expect(report.salaryCapApplied).toBe(true);
  });

  it("no vuelve a aplicar la tasa de riesgo sobre lo ya devengado", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(
      { ...CONFIG_FULL, ivssRiskClass: "MAXIMO" } as never,
    );
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([RUN_APR] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { employeeId: EMP_ID, payrollRunId: "run-apr", conceptCode: "SAL_BASE", amount: new Decimal("2000") },
      { employeeId: EMP_ID, payrollRunId: "run-apr", conceptCode: "IVSS_PAT", amount: new Decimal("220") },
    ] as never);

    const report = await PayrollReportService.getIvssReport(COMPANY_ID, 2026, 4);
    const row1 = report.rows.find((r) => r.employeeId === EMP_ID)!;
    // La clase de riesgo la aplica el calculador; el reporte declara su resultado
    // en vez de volver a multiplicar por una tasa que podria no ser la misma.
    expect(row1.ivssEmployerAmount.toNumber()).toBe(220);
  });

  it("sin salario mínimo configurado → salaryCapApplied = false, patronal sobre salario completo", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(CONFIG_EMPTY as never);
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([RUN_APR] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { employeeId: EMP_ID, payrollRunId: "run-apr", conceptCode: "SAL_BASE", amount: new Decimal("6000") },
      { employeeId: EMP_ID, payrollRunId: "run-apr", conceptCode: "IVSS_OBR", amount: new Decimal("240") },
      { employeeId: EMP_ID, payrollRunId: "run-apr", conceptCode: "IVSS_PAT", amount: new Decimal("600") },
      { employeeId: EMP_ID_2, payrollRunId: "run-apr", conceptCode: "SAL_BASE", amount: new Decimal("6000") },
      { employeeId: EMP_ID_2, payrollRunId: "run-apr", conceptCode: "IVSS_OBR", amount: new Decimal("240") },
    ] as never);

    const report = await PayrollReportService.getIvssReport(COMPANY_ID, 2026, 4);
    expect(report.salaryCapApplied).toBe(false);
    expect(report.utValue).toBeNull();
    // salaryCapApplied avisa en la UI de que los runs se calcularon SIN techo.
    const row1 = report.rows.find((r) => r.employeeId === EMP_ID)!;
    expect(row1.ivssEmployerAmount.toNumber()).toBe(600);
  });

  it("empleado ACTIVE sin runs en el mes → incluido con monto 0 (NOM-E-01)", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(CONFIG_FULL as never);
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([] as never); // sin runs
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([] as never);

    const report = await PayrollReportService.getIvssReport(COMPANY_ID, 2026, 4);
    expect(report.rows).toHaveLength(2);
    for (const row of report.rows) {
      expect(row.weeksWorked).toBe(0);
      expect(row.ivssWorkerAmount.toNumber()).toBe(0);
      expect(row.ivssEmployerAmount.toNumber()).toBe(0);
    }
  });

  it("múltiples runs en el mismo mes → suma todos (quincenal)", async () => {
    const run1 = { id: "run-q1", periodStart: new Date("2026-04-01"), periodEnd: new Date("2026-04-15") };
    const run2 = { id: "run-q2", periodStart: new Date("2026-04-16"), periodEnd: new Date("2026-04-30") };
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(CONFIG_FULL as never);
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([run1, run2] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      // run1
      { employeeId: EMP_ID, payrollRunId: "run-q1", conceptCode: "SAL_BASE", amount: new Decimal("1500") },
      { employeeId: EMP_ID, payrollRunId: "run-q1", conceptCode: "IVSS_OBR", amount: new Decimal("60") },
      // run2
      { employeeId: EMP_ID, payrollRunId: "run-q2", conceptCode: "SAL_BASE", amount: new Decimal("1500") },
      { employeeId: EMP_ID, payrollRunId: "run-q2", conceptCode: "IVSS_OBR", amount: new Decimal("60") },
      // emp2 solo en run1
      { employeeId: EMP_ID_2, payrollRunId: "run-q1", conceptCode: "SAL_BASE", amount: new Decimal("1500") },
      { employeeId: EMP_ID_2, payrollRunId: "run-q1", conceptCode: "IVSS_OBR", amount: new Decimal("60") },
    ] as never);

    const report = await PayrollReportService.getIvssReport(COMPANY_ID, 2026, 4);
    const row = report.rows.find((r) => r.employeeId === EMP_ID)!;
    // Suma: 1500 + 1500 = 3000 SAL_BASE
    expect(row.salaryBase.toNumber()).toBe(3000);
    expect(row.ivssWorkerAmount.toNumber()).toBe(120);
  });

  it("semanas cotizadas se calculan como Math.ceil(días / 7)", async () => {
    // 30 días → Math.ceil(30/7) = 5 semanas
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(CONFIG_FULL as never);
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([RUN_APR] as never); // 30 días
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { employeeId: EMP_ID, payrollRunId: "run-apr", conceptCode: "SAL_BASE", amount: new Decimal("3000") },
      { employeeId: EMP_ID, payrollRunId: "run-apr", conceptCode: "IVSS_OBR", amount: new Decimal("120") },
      { employeeId: EMP_ID_2, payrollRunId: "run-apr", conceptCode: "SAL_BASE", amount: new Decimal("3000") },
      { employeeId: EMP_ID_2, payrollRunId: "run-apr", conceptCode: "IVSS_OBR", amount: new Decimal("120") },
    ] as never);

    const report = await PayrollReportService.getIvssReport(COMPANY_ID, 2026, 4);
    const row = report.rows.find((r) => r.employeeId === EMP_ID)!;
    expect(row.weeksWorked).toBe(5); // Math.ceil(30/7) = 5
  });
});

// ─── getBanavihReport ─────────────────────────────────────────────────────────

describe("PayrollReportService.getBanavihReport", () => {
  beforeEach(() => {
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValue(COMPANY as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue(EMPLOYEES as never);
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([RUN_APR] as never);
  });

  it("FAOV: 1% obrero + 2% patronal (LRPVH, G.O. 6.805 Extr. 01-05-2024)", async () => {
    // Salario normal 4000 → integral 4500 (LRPVH Art. 33.1 + Art. 122 LOTTT):
    // obrero 1% = 45, patrono 2% = 90.
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { employeeId: EMP_ID, conceptCode: "SAL_BASE", amount: new Decimal("4000") },
      { employeeId: EMP_ID, conceptCode: "FAOV_OBR", amount: new Decimal("45") },
      { employeeId: EMP_ID, conceptCode: "FAOV_PAT", amount: new Decimal("90") },
      { employeeId: EMP_ID_2, conceptCode: "SAL_BASE", amount: new Decimal("4000") },
      { employeeId: EMP_ID_2, conceptCode: "FAOV_OBR", amount: new Decimal("45") },
      { employeeId: EMP_ID_2, conceptCode: "FAOV_PAT", amount: new Decimal("90") },
    ] as never);

    const report = await PayrollReportService.getBanavihReport(COMPANY_ID, 2026, 4);
    const row = report.rows.find((r) => r.employeeId === EMP_ID)!;
    // El patronal se lee de la línea FAOV_PAT devengada. Antes se recalculaba
    // como SAL_BASE × 1%: mal la tasa (el 1% es el del trabajador) y mal la base
    // (SAL_BASE es el salario normal, no el integral) — se declaraba 40 donde la
    // ley pide 90, menos de la mitad.
    expect(row.faovWorkerAmount.toNumber()).toBe(45);
    expect(row.faovEmployerAmount.toNumber()).toBe(90);
    expect(row.faovTotalAmount.toNumber()).toBe(135);
    expect(report.totalAmount.toNumber()).toBe(270); // 2 empleados × 135
  });

  it("empleado sin runs → incluido con montos 0 (NOM-E-01)", async () => {
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([] as never);

    const report = await PayrollReportService.getBanavihReport(COMPANY_ID, 2026, 4);
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0].faovWorkerAmount.toNumber()).toBe(0);
  });
});

// ─── getIncesReport ───────────────────────────────────────────────────────────

describe("PayrollReportService.getIncesReport", () => {
  beforeEach(() => {
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValue(COMPANY as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue(EMPLOYEES as never);
    vi.mocked(prisma.profitSharingRecord.findMany).mockResolvedValue([] as never);
  });

  it("Q1 abarca enero-marzo (meses 1-3)", async () => {
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([RUN_Q1_JAN] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { employeeId: EMP_ID, conceptCode: "INCES_OBR", amount: new Decimal("60") },
      { employeeId: EMP_ID, conceptCode: "SAL_BASE", amount: new Decimal("3000") },
      { employeeId: EMP_ID_2, conceptCode: "INCES_OBR", amount: new Decimal("60") },
      { employeeId: EMP_ID_2, conceptCode: "SAL_BASE", amount: new Decimal("3000") },
    ] as never);

    const report = await PayrollReportService.getIncesReport(COMPANY_ID, 2026, 1);
    expect(report.quarter).toBe(1);
    // Verificar que Q1 agrupa correctamente — runs del mes enero incluidos
    expect(report.totalWorkerAmount.toNumber()).toBe(120);
  });

  it("aporte patronal = 2% del salario normal, leído de INCES_PAT (Art. 49)", async () => {
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([RUN_Q1_JAN] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { employeeId: EMP_ID, conceptCode: "SAL_BASE", amount: new Decimal("3000") },
      { employeeId: EMP_ID, conceptCode: "INCES_PAT", amount: new Decimal("60") },
      { employeeId: EMP_ID_2, conceptCode: "SAL_BASE", amount: new Decimal("3000") },
      { employeeId: EMP_ID_2, conceptCode: "INCES_PAT", amount: new Decimal("60") },
    ] as never);
    vi.mocked(prisma.profitSharingRecord.findMany).mockResolvedValue([] as never);

    const report = await PayrollReportService.getIncesReport(COMPANY_ID, 2026, 1);
    expect(report.totalEmployerAmount.toNumber()).toBe(120);
    // Sin utilidades pagadas en el trimestre no hay nada retenido al trabajador.
    expect(report.totalWorkerAmount.toNumber()).toBe(0);
    expect(report.totalAmount.toNumber()).toBe(120);
  });

  it("retención del trabajador sale de ProfitSharingRecord.incesRetention (Art. 50)", async () => {
    // Antes esto se leía de las líneas INCES_OBR de la nómina mensual, que ya no
    // se generan: el reporte declaraba 0 de aporte obrero para siempre.
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([RUN_Q1_JAN] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { employeeId: EMP_ID, conceptCode: "SAL_BASE", amount: new Decimal("3000") },
      { employeeId: EMP_ID, conceptCode: "INCES_PAT", amount: new Decimal("60") },
    ] as never);
    vi.mocked(prisma.profitSharingRecord.findMany).mockResolvedValue([
      { employeeId: EMP_ID, profitAmount: new Decimal("10000"), incesRetention: new Decimal("50") },
    ] as never);

    const report = await PayrollReportService.getIncesReport(COMPANY_ID, 2026, 1);
    const row = report.rows.find((r) => r.employeeId === EMP_ID)!;
    expect(row.incesWorkerAmount.toNumber()).toBe(50);   // 10000 × 0,5%
    expect(row.profitAmount.toNumber()).toBe(10000);
    expect(report.totalWorkerAmount.toNumber()).toBe(50);
    // El 0,5% de las utilidades NO se duplica como aporte patronal.
    expect(report.totalEmployerAmount.toNumber()).toBe(60);
    expect(report.totalAmount.toNumber()).toBe(110);
  });

  it("utilidades fraccionadas de una liquidación también causan la retención", async () => {
    // El filtro isFractional: false dejaba fuera del trimestre a todo el que se
    // liquidó en él, y su retención nunca se enteraba.
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.profitSharingRecord.findMany).mockResolvedValue([
      { employeeId: EMP_ID, profitAmount: new Decimal("4000"), incesRetention: new Decimal("20") },
    ] as never);

    const report = await PayrollReportService.getIncesReport(COMPANY_ID, 2026, 1);
    expect(report.totalWorkerAmount.toNumber()).toBe(20);
    const where = vi.mocked(prisma.profitSharingRecord.findMany).mock.calls.at(-1)![0] as {
      where: Record<string, unknown>;
    };
    expect(where.where).not.toHaveProperty("isFractional");
  });

  it("las líneas INCES_OBR históricas siguen sumando al aporte del trabajador", async () => {
    // Trimestres anteriores a ADR-045 retenían el 0,5% mes a mes: no pueden
    // pasar a mostrar cero al reabrir el reporte ya declarado.
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([RUN_Q1_JAN] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { employeeId: EMP_ID, conceptCode: "INCES_OBR", amount: new Decimal("15") },
      { employeeId: EMP_ID, conceptCode: "SAL_BASE", amount: new Decimal("3000") },
    ] as never);
    vi.mocked(prisma.profitSharingRecord.findMany).mockResolvedValue([] as never);

    const report = await PayrollReportService.getIncesReport(COMPANY_ID, 2026, 1);
    expect(report.totalWorkerAmount.toNumber()).toBe(15);
  });

  it("empleado sin runs en el trimestre → incluido con montos 0 (NOM-E-01)", async () => {
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([] as never);

    const report = await PayrollReportService.getIncesReport(COMPANY_ID, 2026, 1);
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0].incesWorkerAmount.toNumber()).toBe(0);
  });
});

// ─── getArcReport ─────────────────────────────────────────────────────────────

describe("PayrollReportService.getArcReport", () => {
  const EMPLOYEE_FULL = { id: EMP_ID, firstName: "Ana", lastName: "García", cedulaType: "V", cedulaNumber: "12345678" };

  beforeEach(() => {
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValue(COMPANY as never);
    vi.mocked(prisma.employee.findFirstOrThrow).mockResolvedValue(EMPLOYEE_FULL as never);
    vi.mocked(prisma.profitSharingRecord.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.vacationRecord.findFirst).mockResolvedValue(null as never);
  });

  it("ingresos anuales = SAL_BASE + HE del año", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(CONFIG_FULL as never);
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([{ id: "run-1" }] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { conceptCode: "SAL_BASE", amount: new Decimal("36000") },
      { conceptCode: "HE_DIURNA", amount: new Decimal("2000") },
      { conceptCode: "HE_NOCTURNA", amount: new Decimal("1000") },
    ] as never);

    const report = await PayrollReportService.getArcReport(COMPANY_ID, EMP_ID, 2026);
    expect(report.totalEarnings.toNumber()).toBe(39000);
    expect(report.profitAmount.toNumber()).toBe(0);
    expect(report.vacationBonus.toNumber()).toBe(0);
    expect(report.totalGrossIncome.toNumber()).toBe(39000);
  });

  it("desgravamen 774 UT aplicado: renta gravable = ingresos − desgravamen", async () => {
    // utValue = 400, desgravamen = 774 × 400 = 309600
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(CONFIG_FULL as never);
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([{ id: "run-1" }] as never);
    // Ingresos 500000 Bs → renta gravable = 500000 - 309600 = 190400
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { conceptCode: "SAL_BASE", amount: new Decimal("500000") },
    ] as never);

    const report = await PayrollReportService.getArcReport(COMPANY_ID, EMP_ID, 2026);
    expect(report.desgravamen.toNumber()).toBe(309600); // 774 × 400
    expect(report.taxableIncome.toNumber()).toBe(190400);
  });

  it("renta gravable negativa → taxableIncome = 0 (desgravamen > ingresos)", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(CONFIG_FULL as never);
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([{ id: "run-1" }] as never);
    // Ingresos 10000 < desgravamen 309600
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { conceptCode: "SAL_BASE", amount: new Decimal("10000") },
    ] as never);

    const report = await PayrollReportService.getArcReport(COMPANY_ID, EMP_ID, 2026);
    expect(report.taxableIncome.toNumber()).toBe(0);
    expect(report.islrAmount.toNumber()).toBe(0);
  });

  it("ISLR retenido = suma de ISLR_EMP en PayrollRunLine", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(CONFIG_FULL as never);
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([{ id: "run-1" }] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { conceptCode: "SAL_BASE", amount: new Decimal("36000") },
      { conceptCode: "ISLR_EMP", amount: new Decimal("1500") },
    ] as never);

    const report = await PayrollReportService.getArcReport(COMPANY_ID, EMP_ID, 2026);
    expect(report.withheldAmount.toNumber()).toBe(1500);
  });

  it("utValue null → desgravamen = 0, ISLR = 0, taxableIncome = ingresos", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(CONFIG_EMPTY as never);
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([{ id: "run-1" }] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { conceptCode: "SAL_BASE", amount: new Decimal("100000") },
    ] as never);

    const report = await PayrollReportService.getArcReport(COMPANY_ID, EMP_ID, 2026);
    expect(report.utValue).toBeNull();
    expect(report.desgravamen.toNumber()).toBe(0);
    expect(report.islrAmount.toNumber()).toBe(0);
  });

  it("utilidades y bono vacacional incluidos en totalGrossIncome", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(CONFIG_FULL as never);
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([{ id: "run-1" }] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { conceptCode: "SAL_BASE", amount: new Decimal("36000") },
    ] as never);
    vi.mocked(prisma.profitSharingRecord.findFirst).mockResolvedValue(
      { profitAmount: new Decimal("5400") } as never
    );
    vi.mocked(prisma.vacationRecord.findFirst).mockResolvedValue(
      { bonusAmount: new Decimal("2100") } as never
    );

    const report = await PayrollReportService.getArcReport(COMPANY_ID, EMP_ID, 2026);
    expect(report.profitAmount.toNumber()).toBe(5400);
    expect(report.vacationBonus.toNumber()).toBe(2100);
    expect(report.totalGrossIncome.toNumber()).toBe(43500);
  });

  it("empleado sin runs en el año → totalEarnings = 0", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(CONFIG_FULL as never);
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([] as never);

    const report = await PayrollReportService.getArcReport(COMPANY_ID, EMP_ID, 2026);
    expect(report.totalEarnings.toNumber()).toBe(0);
    expect(report.taxableIncome.toNumber()).toBe(0);
  });
});
