// src/modules/payroll/services/PayrollBankTxtService.ts
// Ítem 53: Genera archivo TXT de pago masivo para bancos venezolanos.
//
// Formato bancario: pipe-delimited, UTF-8, compatible portales bancarios VEN.
//   Cada fila: CEDULA|NOMBRE|BANCO|CUENTA|MONTO
//
// Formato BANAVIH (FAOV-Web): pipe-delimited específico para declaración FAOV mensual.
//   Encabezado: RIF_PATRONO|NOMBRE_PATRONO|MES|AÑO|TOTAL_TRABAJADORES|TOTAL_APORTE
//   Detalle: CEDULA|NOMBRE|BANCO|CUENTA|SALARIO|APORTE_OBRERO|APORTE_PATRONAL|APORTE_TOTAL

import prisma from "@/lib/prisma";
import Decimal from "decimal.js";

export interface BankPaymentRow {
  cedula: string;
  nombre: string;
  banco: string;
  cuenta: string;
  monto: string;
  missingBankInfo: boolean;
}

export interface BankPaymentFile {
  rows: BankPaymentRow[];
  totalEmployees: number;
  totalAmount: string;
  warningCount: number;
  txt: string;
}

export const PayrollBankTxtService = {
  async generate(companyId: string, runId: string): Promise<BankPaymentFile> {
    const run = await prisma.payrollRun.findFirst({
      where: { id: runId, companyId },
      select: {
        periodStart: true,
        periodEnd: true,
        lines: {
          select: {
            employeeId: true,
            conceptType: true,
            amount: true,
            employee: {
              select: {
                firstName: true,
                lastName: true,
                cedulaType: true,
                cedulaNumber: true,
                bankName: true,
                bankAccount: true,
              },
            },
          },
        },
      },
    });

    if (!run) throw new Error("Proceso de nómina no encontrado");

    // Acumular neto por empleado
    type EmployeeAccum = {
      emp: { firstName: string; lastName: string; cedulaType: string; cedulaNumber: string; bankName: string | null; bankAccount: string | null };
      earnings: Decimal;
      deductions: Decimal;
    };
    const byEmployee = new Map<string, EmployeeAccum>();

    for (const line of run.lines) {
      const amount = new Decimal(line.amount.toString());
      const existing = byEmployee.get(line.employeeId);
      if (existing) {
        if (line.conceptType === "EARNING") existing.earnings = existing.earnings.plus(amount);
        else existing.deductions = existing.deductions.plus(amount);
      } else {
        byEmployee.set(line.employeeId, {
          emp: line.employee,
          earnings: line.conceptType === "EARNING" ? amount : new Decimal(0),
          deductions: line.conceptType === "DEDUCTION" ? amount : new Decimal(0),
        });
      }
    }

    const rows: BankPaymentRow[] = [];
    let totalAmount = new Decimal(0);

    for (const { emp, earnings, deductions } of byEmployee.values()) {
      const net = earnings.minus(deductions);
      totalAmount = totalAmount.plus(net);

      const missingBankInfo = !emp.bankName || !emp.bankAccount;
      rows.push({
        cedula: `${emp.cedulaType}-${emp.cedulaNumber}`,
        nombre: `${emp.firstName} ${emp.lastName}`.toUpperCase(),
        banco: emp.bankName ?? "SIN BANCO",
        cuenta: emp.bankAccount ?? "SIN CUENTA",
        monto: net.toFixed(2),
        missingBankInfo,
      });
    }

    rows.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    const periodStart = run.periodStart.toISOString().slice(0, 10);
    const periodEnd   = run.periodEnd.toISOString().slice(0, 10);
    const generatedAt = new Date().toISOString().slice(0, 10);
    const warningCount = rows.filter((r) => r.missingBankInfo).length;

    const headerLines = [
      `# NOMINA ContaFlow — Periodo: ${periodStart} / ${periodEnd}`,
      `# Generado: ${generatedAt}`,
      `# Total empleados: ${rows.length} | Neto total: ${totalAmount.toFixed(2)}`,
      ...(warningCount > 0
        ? [`# AVISO: ${warningCount} empleado(s) sin datos bancarios — completar en Empleados antes de enviar al banco`]
        : []),
      "CEDULA|NOMBRE|BANCO|CUENTA|MONTO",
    ];

    const dataLines = rows.map(
      (r) => `${r.cedula}|${r.nombre}|${r.banco}|${r.cuenta}|${r.monto}`,
    );

    return {
      rows,
      totalEmployees: rows.length,
      totalAmount: totalAmount.toFixed(2),
      warningCount,
      txt: [...headerLines, ...dataLines].join("\n"),
    };
  },

  // ── generateBanavihTxt — formato FAOV-Web BANAVIH ──────────────────────────
  async generateBanavihTxt(companyId: string, year: number, month: number): Promise<string> {
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { name: true, rif: true },
    });

    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const periodEnd = new Date(Date.UTC(year, month, 0));

    const runIds = (await prisma.payrollRun.findMany({
      where: { companyId, status: "APPROVED", periodStart: { gte: periodStart }, periodEnd: { lte: periodEnd } },
      select: { id: true },
    })).map((r) => r.id);

    const employees = await prisma.employee.findMany({
      where: { companyId, status: "ACTIVE" },
      select: {
        id: true, firstName: true, lastName: true,
        cedulaType: true, cedulaNumber: true,
        bankName: true, bankAccount: true,
        banavihNumber: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    // Salario base y aportes FAOV del período
    const lines = runIds.length > 0
      ? await prisma.payrollRunLine.findMany({
          where: { payrollRunId: { in: runIds }, conceptCode: { in: ["FAOV_OBR", "SAL_BASE"] } },
          select: { employeeId: true, conceptCode: true, amount: true },
        })
      : [];

    type Agg = { faovOBR: Decimal; salBase: Decimal };
    const agg = new Map<string, Agg>();
    for (const l of lines) {
      if (!agg.has(l.employeeId)) agg.set(l.employeeId, { faovOBR: new Decimal(0), salBase: new Decimal(0) });
      const e = agg.get(l.employeeId)!;
      if (l.conceptCode === "FAOV_OBR") e.faovOBR = e.faovOBR.plus(l.amount.toString());
      else e.salBase = e.salBase.plus(l.amount.toString());
    }

    const FAOV_EMPLOYER_RATE = new Decimal("0.01");
    let totalAporte = new Decimal(0);

    const rows = employees.map((emp) => {
      const e = agg.get(emp.id);
      const salBase = (e?.salBase ?? new Decimal(0)).toDecimalPlaces(2);
      const aporteObrero = (e?.faovOBR ?? new Decimal(0)).toDecimalPlaces(2);
      const aportePatronal = salBase.times(FAOV_EMPLOYER_RATE).toDecimalPlaces(2);
      const aporteTotal = aporteObrero.plus(aportePatronal);
      totalAporte = totalAporte.plus(aporteTotal);

      return [
        `${emp.cedulaType}-${emp.cedulaNumber}`,
        `${emp.lastName} ${emp.firstName}`.toUpperCase(),
        emp.bankName ?? "SIN BANCO",
        emp.bankAccount ?? "SIN CUENTA",
        salBase.toFixed(2),
        aporteObrero.toFixed(2),
        aportePatronal.toFixed(2),
        aporteTotal.toFixed(2),
      ].join("|");
    });

    const MONTHS = ["", "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
      "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

    const header = [
      `# BANAVIH FAOV-WEB — ContaFlow`,
      `# Generado: ${new Date().toISOString().slice(0, 10)}`,
      [
        company.rif ?? "SIN_RIF",
        (company.name ?? "").toUpperCase(),
        MONTHS[month],
        String(year),
        String(employees.length),
        totalAporte.toFixed(2),
      ].join("|"),
      "CEDULA|NOMBRE|BANCO|CUENTA|SALARIO|APORTE_OBRERO|APORTE_PATRONAL|APORTE_TOTAL",
    ];

    return [...header, ...rows].join("\n");
  },
};
