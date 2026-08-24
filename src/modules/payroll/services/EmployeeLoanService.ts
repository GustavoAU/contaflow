// src/modules/payroll/services/EmployeeLoanService.ts
// Préstamos patronales con descuento automático en nómina.
//
// Reglas de negocio:
//   - Todo préstamo inicia en PENDING → ADMIN_ONLY aprueba → ACTIVE
//   - Cuota sin interés: ceil(totalAmount / installments, 2 dec)
//   - Cuota con interés: método francés — cuota fija total (principal + interés)
//     Referencia tasa activa BCV ~59% anual. Sin tope legal específico para préstamos patronales.
//     LOTTT Art. 154: cuota ≤ 1/3 del salario neto mensual.
//   - currency: "VES" | "USD" | "MIXED"
//     VES   -> importes en totalAmount / installmentAmount / remainingBalance
//     USD   -> esas tres en 0; el importe vive en los campos *Usd
//     MIXED -> LEGADO. Ya no se ofrece al crear (regla de negocio 2026-08-23:
//              el prestamo es binario, VES o USD). Se sigue soportando para las
//              filas que ya existan.
//   - La moneda es INMUTABLE una vez otorgado el prestamo, y el descuento en
//     nomina va SIEMPRE en la moneda en que se pidio.
//   - Append-only: no se editan montos. Corrección vía cancel + nuevo préstamo.

import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { assertBalancedGLEntries } from "@/lib/gl-assertions";
import type { LoanStatus } from "@prisma/client";

// ─── Tipos ────────────────────────────────────────────────────────────────────

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
  // USD fields (MIXED / USD loans)
  amountUsd: string | null;
  installmentAmountUsd: string | null;
  remainingBalanceUsd: string | null;
  // Interest
  interestRate: string | null;
  // Approval
  status: LoanStatus;
  approvedByUserId: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  description: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface CreateLoanInput {
  employeeId: string;
  currency: "VES" | "USD" | "MIXED";
  // VES / primary amount (VES for MIXED)
  totalAmount: string;
  // USD amount (for USD or MIXED loans)
  amountUsd?: string | null;
  installments: number;
  interestRate?: string | null; // tasa anual decimal ("0.30" = 30%). null = sin interés
  description?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Método francés: cuota fija = P × r(1+r)^n / ((1+r)^n − 1)
 * Si interestRate es null o 0 → cuota = ceil(total / n, 2 dec).
 * Retorna la cuota mensual fija en Decimal.
 */
function calcInstallment(principal: Decimal, installments: number, annualRate: Decimal | null): Decimal {
  if (!annualRate || annualRate.isZero()) {
    return principal.dividedBy(installments).toDecimalPlaces(2, Decimal.ROUND_UP);
  }
  const r = annualRate.dividedBy(12); // tasa mensual
  const rn = r.plus(1).pow(installments); // (1+r)^n
  const cuota = principal.times(r.times(rn)).dividedBy(rn.minus(1));
  return cuota.toDecimalPlaces(2, Decimal.ROUND_UP);
}

function serializeLoan(row: {
  id: string; companyId: string; employeeId: string;
  totalAmount: Decimal; currency: string; installments: number;
  installmentAmount: Decimal; paidInstallments: number; remainingBalance: Decimal;
  amountUsd: Decimal | null; installmentAmountUsd: Decimal | null; remainingBalanceUsd: Decimal | null;
  interestRate: Decimal | null;
  status: LoanStatus; approvedByUserId: string | null; approvedAt: Date | null;
  rejectionReason: string | null; description: string | null;
  createdByUserId: string; createdAt: Date;
  employee: { firstName: string; lastName: string };
}): EmployeeLoanRow {
  return {
    id: row.id, companyId: row.companyId, employeeId: row.employeeId,
    employeeName: `${row.employee.firstName} ${row.employee.lastName}`,
    totalAmount: row.totalAmount.toString(),
    currency: row.currency,
    installments: row.installments,
    installmentAmount: row.installmentAmount.toString(),
    paidInstallments: row.paidInstallments,
    remainingBalance: row.remainingBalance.toString(),
    amountUsd: row.amountUsd?.toString() ?? null,
    installmentAmountUsd: row.installmentAmountUsd?.toString() ?? null,
    remainingBalanceUsd: row.remainingBalanceUsd?.toString() ?? null,
    interestRate: row.interestRate?.toString() ?? null,
    status: row.status,
    approvedByUserId: row.approvedByUserId,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
    description: row.description,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

const INCLUDE_EMP = { employee: { select: { firstName: true, lastName: true } } } as const;

// ─── EmployeeLoanService ──────────────────────────────────────────────────────

export const EmployeeLoanService = {
  // ── create ──────────────────────────────────────────────────────────────────
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

    const principal = new Decimal(input.totalAmount);
    if (principal.lte(0)) throw new Error("El monto total debe ser mayor que cero.");
    if (input.installments < 1) throw new Error("El número de cuotas debe ser al menos 1.");

    const annualRate = input.interestRate ? new Decimal(input.interestRate) : null;
    if (annualRate && annualRate.lt(0)) throw new Error("La tasa de interés no puede ser negativa.");
    if (annualRate && annualRate.gt(2)) throw new Error("La tasa anual no puede superar 200%.");

    const installmentVes = calcInstallment(principal, input.installments, annualRate);

    let installmentUsd: Decimal | null = null;
    let principalUsd: Decimal | null = null;
    if (input.currency === "MIXED" || input.currency === "USD") {
      if (input.currency === "MIXED") {
        if (!input.amountUsd) throw new Error("Préstamo MIXTO requiere un monto en USD.");
        principalUsd = new Decimal(input.amountUsd);
        if (principalUsd.lte(0)) throw new Error("El monto USD debe ser mayor que cero.");
        installmentUsd = calcInstallment(principalUsd, input.installments, annualRate);
      } else {
        // currency=USD — totalAmount ya está en USD; installmentAmount también en USD
        principalUsd = principal;
        installmentUsd = installmentVes;
      }
    }

    const loan = await prisma.$transaction(async (tx) => {
      const created = await tx.employeeLoan.create({
        data: {
          companyId,
          employeeId: input.employeeId,
          totalAmount: input.currency === "USD" ? new Decimal(0) : principal,
          currency: input.currency,
          installments: input.installments,
          installmentAmount: input.currency === "USD" ? new Decimal(0) : installmentVes,
          paidInstallments: 0,
          remainingBalance: input.currency === "USD" ? new Decimal(0) : principal,
          amountUsd: principalUsd,
          installmentAmountUsd: installmentUsd,
          remainingBalanceUsd: principalUsd,
          interestRate: annualRate,
          status: "PENDING",
          description: input.description ?? null,
          createdByUserId: userId,
        },
        include: INCLUDE_EMP,
      });

      await tx.auditLog.create({
        data: {
          companyId, userId,
          action: "LOAN_CREATED",
          entityName: "EmployeeLoan",
          entityId: created.id,
          newValue: {
            totalAmount: principal.toFixed(2),
            currency: input.currency,
            installments: input.installments,
            interestRate: annualRate?.toString() ?? null,
          },
          ipAddress: auditMeta.ipAddress ?? null,
          userAgent: auditMeta.userAgent ?? null,
        },
      });

      return created;
    });

    return serializeLoan(loan);
  },

  // ── approve ─────────────────────────────────────────────────────────────────
  async approve(
    companyId: string,
    loanId: string,
    approverId: string,
    auditMeta: { ipAddress?: string; userAgent?: string },
  ): Promise<EmployeeLoanRow> {
    const loan = await prisma.employeeLoan.findFirst({ where: { id: loanId, companyId } });
    if (!loan) throw new Error("Préstamo no encontrado.");
    if (loan.status !== "PENDING") throw new Error("Solo se pueden aprobar préstamos en estado PENDIENTE.");

    const payrollConfig = await prisma.payrollConfig.findUnique({
      where: { companyId },
      select: { loanReceivableAccountId: true, disbursementBankAccountId: true },
    });
    const canJournalize = !!(payrollConfig?.loanReceivableAccountId && payrollConfig?.disbursementBankAccountId);

    let openPeriod: { id: string } | null = null;
    if (canJournalize) {
      const now = new Date();
      openPeriod = await prisma.accountingPeriod.findFirst({
        where: { companyId, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, status: "OPEN" },
        select: { id: true },
      });
      if (!openPeriod) throw new Error("No hay período contable abierto. Abra el período antes de aprobar el préstamo.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.employeeLoan.update({
        where: { id: loanId },
        data: { status: "ACTIVE", approvedByUserId: approverId, approvedAt: new Date() },
        include: INCLUDE_EMP,
      });

      if (canJournalize && openPeriod) {
        const empName = `${u.employee.firstName} ${u.employee.lastName}`;
        const vesAmount = new Decimal(loan.totalAmount.toString());
        const loanEntries = [
          { accountId: payrollConfig!.loanReceivableAccountId!, amount: vesAmount, description: `Préstamo ${empName}` },
          { accountId: payrollConfig!.disbursementBankAccountId!, amount: vesAmount.negated(), description: `Salida banco — préstamo ${empName}` },
        ];
        assertBalancedGLEntries(loanEntries); // N4: invariante partida doble
        await tx.transaction.create({
          data: {
            companyId,
            number: `PREST-${u.id.slice(-8).toUpperCase()}`,
            date: new Date(),
            description: `Desembolso préstamo — ${empName} — ${loan.installments} cuota(s)`,
            reference: u.id,
            userId: approverId,
            periodId: openPeriod.id,
            type: "DIARIO",
            entries: {
              create: loanEntries,
            },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          companyId, userId: approverId,
          action: "LOAN_APPROVED",
          entityName: "EmployeeLoan",
          entityId: loanId,
          newValue: { status: "ACTIVE", journalized: canJournalize },
          ipAddress: auditMeta.ipAddress ?? null,
          userAgent: auditMeta.userAgent ?? null,
        },
      });

      return u;
    });

    return serializeLoan(updated);
  },

  // ── reject ──────────────────────────────────────────────────────────────────
  async reject(
    companyId: string,
    loanId: string,
    reviewerId: string,
    rejectionReason: string,
    auditMeta: { ipAddress?: string; userAgent?: string },
  ): Promise<EmployeeLoanRow> {
    const loan = await prisma.employeeLoan.findFirst({ where: { id: loanId, companyId } });
    if (!loan) throw new Error("Préstamo no encontrado.");
    if (loan.status !== "PENDING") throw new Error("Solo se pueden rechazar préstamos en estado PENDIENTE.");

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.employeeLoan.update({
        where: { id: loanId },
        data: { status: "REJECTED", rejectionReason, approvedByUserId: reviewerId, approvedAt: new Date() },
        include: INCLUDE_EMP,
      });

      await tx.auditLog.create({
        data: {
          companyId, userId: reviewerId,
          action: "LOAN_REJECTED",
          entityName: "EmployeeLoan",
          entityId: loanId,
          newValue: { status: "REJECTED", rejectionReason },
          ipAddress: auditMeta.ipAddress ?? null,
          userAgent: auditMeta.userAgent ?? null,
        },
      });

      return u;
    });

    return serializeLoan(updated);
  },

  // ── list ─────────────────────────────────────────────────────────────────────
  async list(companyId: string, filters?: { employeeId?: string; status?: LoanStatus }): Promise<EmployeeLoanRow[]> {
    const rows = await prisma.employeeLoan.findMany({
      where: {
        companyId,
        ...(filters?.employeeId ? { employeeId: filters.employeeId } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      include: INCLUDE_EMP,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(serializeLoan);
  },

  // ── cancel ───────────────────────────────────────────────────────────────────
  async cancel(
    companyId: string,
    loanId: string,
    userId: string,
    auditMeta: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const loan = await prisma.employeeLoan.findFirst({ where: { id: loanId, companyId } });
    if (!loan) throw new Error("Préstamo no encontrado.");
    if (loan.status !== "ACTIVE" && loan.status !== "PENDING")
      throw new Error("Solo se pueden cancelar préstamos activos o pendientes.");

    await prisma.$transaction(async (tx) => {
      await tx.employeeLoan.update({ where: { id: loanId }, data: { status: "CANCELLED" } });

      await tx.auditLog.create({
        data: {
          companyId, userId,
          action: "LOAN_CANCELLED",
          entityName: "EmployeeLoan",
          entityId: loanId,
          oldValue: JSON.stringify({ status: loan.status, remainingBalance: loan.remainingBalance.toString() }),
          newValue: JSON.stringify({ status: "CANCELLED" }),
          ipAddress: auditMeta.ipAddress ?? null,
          userAgent: auditMeta.userAgent ?? null,
        },
      });
    });
  },

  // ── (applyInstallments eliminado) ───────────────────────────────────────────
  // Era codigo muerto: 0 llamadores, mientras PayrollRunService.approve() tenia
  // su PROPIA copia en linea que ya habia divergido. Lo reemplaza
  // planLoanInstallments (abajo), que usan los DOS puntos del ciclo de nomina.
};

// ─── Planificador de cuotas ───────────────────────────────────────────────────
// FUENTE UNICA de "que se descuenta de que prestamo en esta nomina".
//
// Existe porque el ciclo lo necesita en DOS momentos —al calcular la nomina,
// para inyectar la linea PRESTAMO_EMP, y al aprobarla, para bajar los saldos— y
// tenerlo escrito dos veces produjo tres bugs medidos (2026-08-23):
//
//   1. Ambos leian SOLO las columnas VES e ignoraban `currency`, asi que un
//      prestamo en USD daba min(0,0)=0 y no se descontaba NUNCA, en silencio.
//   2. El de aprobacion trataba el lado USD solo si currency==="MIXED". Con un
//      prestamo USD calculaba isPaid = 0.isZero() && !undefined = TRUE: quedaba
//      marcado PAID, con una cuota mas contada, sin haber cobrado nada.
//   3. EmployeeLoanService.applyInstallments era una tercera copia, muerta.
//
// Por eso aqui se decide TODO y los dos llamadores solo aplican el resultado.

export type SalaryCurrency = "VES" | "USD" | "MIXED";

/** Forma minima que necesita el planificador (compatible con la fila Prisma). */
export interface LoanForPlanning {
  id: string;
  currency: string;
  installmentAmount: Decimal | string;
  remainingBalance: Decimal | string;
  installmentAmountUsd: Decimal | string | null;
  remainingBalanceUsd: Decimal | string | null;
  paidInstallments: number;
}

export interface LoanInstallmentPlan {
  loanId: string;
  /** Moneda en la que se cobra esta cuota — la del prestamo, siempre. */
  currency: "VES" | "USD";
  /** Monto que va a la linea del recibo, en la moneda del sueldo del empleado. */
  lineAmount: Decimal;
  newBalanceVes: Decimal;
  /** null cuando el prestamo no tiene lado USD. */
  newBalanceUsd: Decimal | null;
  isPaid: boolean;
}

const dec = (v: Decimal | string | null | undefined): Decimal =>
  v == null ? new Decimal(0) : new Decimal(v.toString());

/**
 * Decide la cuota de cada prestamo ACTIVE de UN empleado.
 *
 * Un prestamo solo se descuenta si su moneda cabe en el recibo: la linea de
 * nomina no lleva moneda propia, hereda la del sueldo. Si no cabe, se omite —
 * omitir es correcto; cobrar en la moneda equivocada no.
 *
 * Un prestamo con cuota cero NUNCA entra al plan. Esa es la garantia que impide
 * volver a marcar PAID un prestamo del que no se cobro nada.
 */
export function planLoanInstallments(
  loans: LoanForPlanning[],
  salaryCurrency: SalaryCurrency,
): LoanInstallmentPlan[] {
  const plans: LoanInstallmentPlan[] = [];

  for (const loan of loans) {
    const vesInstallment = dec(loan.installmentAmount);
    const vesBalance = dec(loan.remainingBalance);
    const usdInstallment = dec(loan.installmentAmountUsd);
    const usdBalance = dec(loan.remainingBalanceUsd);

    if (loan.currency === "USD") {
      // El recibo tiene que poder expresar dolares.
      if (salaryCurrency !== "USD" && salaryCurrency !== "MIXED") continue;

      const applied = Decimal.min(usdInstallment, usdBalance);
      if (applied.lte(0)) continue;

      const newUsd = usdBalance.minus(applied);
      plans.push({
        loanId: loan.id,
        currency: "USD",
        lineAmount: applied,
        newBalanceVes: vesBalance,
        newBalanceUsd: newUsd,
        isPaid: newUsd.isZero(),
      });
      continue;
    }

    // VES y MIXED cobran su cuota en bolivares.
    if (salaryCurrency !== "VES" && salaryCurrency !== "MIXED") continue;

    const applied = Decimal.min(vesInstallment, vesBalance);
    if (applied.lte(0)) continue;

    const newVes = vesBalance.minus(applied);

    // MIXED (legado): ademas baja el lado USD por su propia cuota.
    let newUsd: Decimal | null = null;
    if (loan.currency === "MIXED" && loan.remainingBalanceUsd != null && loan.installmentAmountUsd != null) {
      newUsd = Decimal.max(usdBalance.minus(usdInstallment), new Decimal(0));
    }

    plans.push({
      loanId: loan.id,
      currency: "VES",
      lineAmount: applied,
      newBalanceVes: newVes,
      newBalanceUsd: newUsd,
      isPaid: newVes.isZero() && (newUsd === null || newUsd.isZero()),
    });
  }

  return plans;
}
