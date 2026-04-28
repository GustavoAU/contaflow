// src/modules/payroll/services/PayrollBankTxtService.ts
// Ítem 53: Genera archivo TXT de pago masivo para bancos venezolanos.
//
// Formato: pipe-delimited, UTF-8, compatible con la mayoría de portales bancarios VEN.
// Cada fila: CEDULA|NOMBRE|BANCO|CUENTA|MONTO
//
// Si un empleado no tiene datos bancarios configurados, la fila se incluye con
// "SIN BANCO" / "SIN CUENTA" y se eleva warningCount para alertar en la UI.

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
};
