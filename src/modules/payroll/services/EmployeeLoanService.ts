// src/modules/payroll/services/EmployeeLoanService.ts
// Préstamos otorgados por la empresa al empleado con descuento automático en nómina.
//
// Reglas de negocio:
//   - La cuota fija = ceil(totalAmount / installments, 2 decimales)
//   - En cada PayrollRun APPROVED se descuenta min(installmentAmount, remainingBalance)
//   - Cuando remainingBalance llega a 0 → status = PAID automáticamente
//   - Solo ADMIN_ONLY puede crear / cancelar préstamos
//   - Un empleado puede tener múltiples préstamos ACTIVE simultáneos
//   - Append-only: no se editan montos. Corrección vía cancel + nuevo préstamo.
//
// Security:
//   - companyId siempre filtrado en cada query → aislamiento multi-tenant
//   - employeeId validado contra companyId antes de mutación
//   - Montos en Decimal.js — nunca number nativo (R-5)

import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import type { LoanStatus } from "@prisma/client";

export interface EmployeeLoanRow {
  id: string;
  companyId: string;
  employeeId: string;
  employeeName: string;
  totalAmount: string;
  currency: string;
  installments: number;
  installmentAmount: string;
  paidInstallments: number;
  remainingBalance: string;
  status: LoanStatus;
  description: string | null;
  approvedAt: string;
  createdByUserId: string;
  createdAt: string;
}

export interface CreateLoanInput {
  employeeId: string;
  totalAmount: string; // string → Decimal en service
  currency: "VES" | "USD";
  installments: number;
  description?: string | null;
}

export const EmployeeLoanService = {
  async create(
    companyId: string,
    input: CreateLoanInput,
    userId: string,
    auditMeta: { ipAddress?: string; userAgent?: string },
  ): Promise<EmployeeLoanRow> {
    const employee = await prisma.employee.findFirst({
      where: { id: input.employeeId, companyId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!employee) throw new Error("Empleado no encontrado en esta empresa.");

    const total = new Decimal(input.totalAmount);
    if (total.lte(0)) throw new Error("El monto total debe ser mayor que cero.");
    if (input.installments < 1) throw new Error("El número de cuotas debe ser al menos 1.");

    // Cuota fija = ceil(totalAmount / cuotas, 2 dec)
    const installmentAmount = total.dividedBy(input.installments).toDecimalPlaces(2, Decimal.ROUND_UP);

    const loan = await prisma.$transaction(async (tx) => {
      const created = await tx.employeeLoan.create({
        data: {
          companyId,
          employeeId: input.employeeId,
          totalAmount: total.toFixed(2),
          currency: input.currency,
          installments: input.installments,
          installmentAmount: installmentAmount.toFixed(2),
          paidInstallments: 0,
          remainingBalance: total.toFixed(2),
          status: "ACTIVE",
          description: input.description ?? null,
          createdByUserId: userId,
        },
        include: { employee: { select: { firstName: true, lastName: true } } },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityId: created.id,
          entityName: "EmployeeLoan",
          action: "CREATE",
          userId,
          newValue: JSON.stringify({ totalAmount: total.toFixed(2), currency: input.currency, installments: input.installments }),
          ipAddress: auditMeta.ipAddress ?? null,
          userAgent: auditMeta.userAgent ?? null,
        },
      });

      return created;
    });

    return serializeLoan(loan);
  },

  async list(companyId: string, filters?: { employeeId?: string; status?: LoanStatus }): Promise<EmployeeLoanRow[]> {
    const rows = await prisma.employeeLoan.findMany({
      where: {
        companyId,
        ...(filters?.employeeId ? { employeeId: filters.employeeId } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(serializeLoan);
  },

  async cancel(
    companyId: string,
    loanId: string,
    userId: string,
    auditMeta: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const loan = await prisma.employeeLoan.findFirst({
      where: { id: loanId, companyId },
    });
    if (!loan) throw new Error("Préstamo no encontrado.");
    if (loan.status !== "ACTIVE") throw new Error("Solo se pueden cancelar préstamos activos.");

    await prisma.$transaction(async (tx) => {
      await tx.employeeLoan.update({
        where: { id: loanId },
        data: { status: "CANCELLED" },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityId: loanId,
          entityName: "EmployeeLoan",
          action: "CANCEL",
          userId,
          oldValue: JSON.stringify({ status: "ACTIVE", remainingBalance: loan.remainingBalance.toString() }),
          newValue: JSON.stringify({ status: "CANCELLED" }),
          ipAddress: auditMeta.ipAddress ?? null,
          userAgent: auditMeta.userAgent ?? null,
        },
      });
    });
  },

  // Usado por PayrollRunService.approve() para actualizar balances tras descontar cuotas.
  async applyInstallments(
    companyId: string,
    deductions: Array<{ loanId: string; amount: Decimal }>,
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  ): Promise<void> {
    for (const { loanId, amount } of deductions) {
      const loan = await tx.employeeLoan.findUnique({ where: { id: loanId } });
      if (!loan || loan.companyId !== companyId) continue;

      const remaining = new Decimal(loan.remainingBalance.toString()).minus(amount);
      const newRemaining = remaining.lt(0) ? new Decimal(0) : remaining;
      const newPaid = loan.paidInstallments + 1;
      const isPaid = newRemaining.isZero();

      await tx.employeeLoan.update({
        where: { id: loanId },
        data: {
          remainingBalance: newRemaining.toFixed(2),
          paidInstallments: newPaid,
          status: isPaid ? "PAID" : "ACTIVE",
        },
      });
    }
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function serializeLoan(
  row: {
    id: string;
    companyId: string;
    employeeId: string;
    totalAmount: { toString(): string };
    currency: string;
    installments: number;
    installmentAmount: { toString(): string };
    paidInstallments: number;
    remainingBalance: { toString(): string };
    status: LoanStatus;
    description: string | null;
    approvedAt: Date;
    createdByUserId: string;
    createdAt: Date;
    employee: { firstName: string; lastName: string };
  }
): EmployeeLoanRow {
  return {
    id: row.id,
    companyId: row.companyId,
    employeeId: row.employeeId,
    employeeName: `${row.employee.firstName} ${row.employee.lastName}`,
    totalAmount: row.totalAmount.toString(),
    currency: row.currency,
    installments: row.installments,
    installmentAmount: row.installmentAmount.toString(),
    paidInstallments: row.paidInstallments,
    remainingBalance: row.remainingBalance.toString(),
    status: row.status,
    description: row.description,
    approvedAt: row.approvedAt.toISOString(),
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}
