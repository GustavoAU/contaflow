// src/modules/payroll/services/TerminationService.ts
// Fase NOM-D: Liquidación Final LOTTT — wizard DRAFT → FINALIZING → FINALIZED
//
// ADR-014 Dec. 4: Termination desnormalizado — snapshot de todos los componentes.
// ADR-014 Dec. 5: Read Committed — updateMany mutex suficiente (no Serializable).
// ADR-014 Dec. 6: Double-finalization guard = updateMany DRAFT→FINALIZING.
// ADR-014 Dec. 8: Meses fraccionados = 15+ días = mes completo.
//
// Security findings addressed:
//   CRITICAL-IDOR:   companyId en findFirst siempre
//   HIGH:           dailyWage nunca del cliente
//   HIGH:           guard employee.status === 'ACTIVE'
//   HIGH:           guard no FINALIZED termination para el mismo empleado
//   HIGH:           AuditLog dentro del mismo $transaction
//   HIGH:           período contable OPEN guard en finalize
//   MEDIUM-mutex:   updateMany DRAFT→FINALIZING previene doble-finalización

import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { Prisma } from "@prisma/client";
import type { TerminationReason, TerminationStatus } from "@prisma/client";
import { countCompleteMonths, VacationService } from "./VacationService";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface TerminationRow {
  id: string;
  companyId: string;
  employeeId: string;
  reason: TerminationReason;
  status: TerminationStatus;
  terminationDate: string;
  benefitBalanceId: string | null;
  benefitsAccumulatedAmount: string;
  benefitsInterestAmount: string;
  vacationFractionalDays: string;
  vacationFractionalAmount: string;
  vacationBonusFractionalAmount: string;
  profitSharingFractionalDays: string;
  profitSharingFractionalAmount: string;
  profitSharingBaseSalary: string | null;
  indemnificationAmount: string;
  // Preaviso Art. 86 LOTTT (solo DISMISSAL_UNJUSTIFIED — tramos por antigüedad)
  noticePeriodDays: string;
  noticePeriodAmount: string;
  pendingConceptsAmount: string;
  pendingConceptsNotes: string | null;
  totalGrossAmount: string;
  deductionsAmount: string;
  totalNetAmount: string;
  transactionId: string | null;
  idempotencyKey: string;
  createdByUserId: string;
  finalizedByUserId: string | null;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTerminationInput {
  reason: TerminationReason;
  terminationDate: string; // YYYY-MM-DD
  // Conceptos opcionales que el usuario puede ajustar en DRAFT
  pendingConceptsAmount?: string;
  pendingConceptsNotes?: string;
  deductionsAmount?: string;
  idempotencyKey: string; // generado en el cliente (UUID v4)
}

function serializeTermination(t: {
  id: string;
  companyId: string;
  employeeId: string;
  reason: TerminationReason;
  status: TerminationStatus;
  terminationDate: Date;
  benefitBalanceId: string | null;
  benefitsAccumulatedAmount: Decimal;
  benefitsInterestAmount: Decimal;
  vacationFractionalDays: Decimal;
  vacationFractionalAmount: Decimal;
  vacationBonusFractionalAmount: Decimal;
  profitSharingFractionalDays: Decimal;
  profitSharingFractionalAmount: Decimal;
  profitSharingBaseSalary: Decimal | null;
  indemnificationAmount: Decimal;
  noticePeriodDays: Decimal;
  noticePeriodAmount: Decimal;
  pendingConceptsAmount: Decimal;
  pendingConceptsNotes: string | null;
  totalGrossAmount: Decimal;
  deductionsAmount: Decimal;
  totalNetAmount: Decimal;
  transactionId: string | null;
  idempotencyKey: string;
  createdByUserId: string;
  finalizedByUserId: string | null;
  finalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): TerminationRow {
  return {
    id: t.id,
    companyId: t.companyId,
    employeeId: t.employeeId,
    reason: t.reason,
    status: t.status,
    terminationDate: t.terminationDate.toISOString().split("T")[0],
    benefitBalanceId: t.benefitBalanceId,
    benefitsAccumulatedAmount: t.benefitsAccumulatedAmount.toString(),
    benefitsInterestAmount: t.benefitsInterestAmount.toString(),
    vacationFractionalDays: t.vacationFractionalDays.toString(),
    vacationFractionalAmount: t.vacationFractionalAmount.toString(),
    vacationBonusFractionalAmount: t.vacationBonusFractionalAmount.toString(),
    profitSharingFractionalDays: t.profitSharingFractionalDays.toString(),
    profitSharingFractionalAmount: t.profitSharingFractionalAmount.toString(),
    profitSharingBaseSalary: t.profitSharingBaseSalary?.toString() ?? null,
    indemnificationAmount: t.indemnificationAmount.toString(),
    noticePeriodDays: t.noticePeriodDays.toString(),
    noticePeriodAmount: t.noticePeriodAmount.toString(),
    pendingConceptsAmount: t.pendingConceptsAmount.toString(),
    pendingConceptsNotes: t.pendingConceptsNotes,
    totalGrossAmount: t.totalGrossAmount.toString(),
    deductionsAmount: t.deductionsAmount.toString(),
    totalNetAmount: t.totalNetAmount.toString(),
    transactionId: t.transactionId,
    idempotencyKey: t.idempotencyKey,
    createdByUserId: t.createdByUserId,
    finalizedByUserId: t.finalizedByUserId,
    finalizedAt: t.finalizedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

// Preaviso por tramo de antigüedad — LOTTT Art. 86 (solo DISMISSAL_UNJUSTIFIED)
function computeNoticePeriodDays(
  hireDate: Date,
  terminationDate: Date,
  reason: TerminationReason
): Decimal {
  if (reason !== "DISMISSAL_UNJUSTIFIED") return new Decimal(0);
  const seniorityDays = Math.floor(
    (terminationDate.getTime() - hireDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (seniorityDays < 90) return new Decimal(15);   // < 3 meses: 15 días
  if (seniorityDays < 180) return new Decimal(30);  // 3–6 meses: 1 mes
  if (seniorityDays < 365) return new Decimal(45);  // 6–12 meses: 45 días
  return new Decimal(60);                           // > 1 año: 2 meses
}

// ─── TerminationService ───────────────────────────────────────────────────────

export const TerminationService = {
  // ── create — crea Termination en DRAFT con todos los montos calculados ────
  // Todos los montos calculados server-side desde la DB — nunca del cliente.
  // Guard: employee.status === 'ACTIVE'.
  // Guard: idempotencyKey único → P2002 → msg amigable.
  async create(
    companyId: string,
    userId: string,
    employeeId: string,
    input: CreateTerminationInput,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<TerminationRow> {
    // IDOR guard + guard ACTIVE
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      include: {
        salaryHistory: {
          orderBy: { effectiveFrom: "desc" },
          take: 1,
        },
        benefitBalance: true,
      },
    });
    if (!employee) throw new Error("Empleado no encontrado");
    if (employee.status !== "ACTIVE") {
      throw new Error("Solo se puede liquidar a un empleado en estado ACTIVO");
    }

    // Guard: no existe una Termination FINALIZED para este empleado
    const existingFinalized = await prisma.termination.findFirst({
      where: { companyId, employeeId, status: "FINALIZED" },
    });
    if (existingFinalized) {
      throw new Error("Este empleado ya tiene una liquidación final registrada");
    }

    // Config de nómina para días de utilidades y cuentas
    const config = await prisma.payrollConfig.findUnique({ where: { companyId } });
    if (!config) throw new Error("Configure la nómina antes de generar la liquidación");

    const terminationDate = new Date(input.terminationDate);

    // ── 1. Prestaciones acumuladas + intereses ────────────────────────────
    const balance = employee.benefitBalance;
    const benefitsAccumulatedAmount = balance
      ? new Decimal(balance.currentBalance.toString())
      : new Decimal(0);
    const benefitsInterestAmount = balance
      ? new Decimal(balance.interestBalance.toString())
      : new Decimal(0);

    // ── 2. Vacaciones fraccionadas ────────────────────────────────────────
    const yearsOfService = Math.floor(
      (terminationDate.getTime() - employee.hireDate.getTime()) /
        (1000 * 60 * 60 * 24 * 365.25)
    );

    const { vacationDays: vacFracDays, bonusDays: vacBonusFracDays } =
      VacationService.computeFractionalDays(
        employee.hireDate,
        terminationDate,
        yearsOfService
      );

    const salaryRow = employee.salaryHistory[0];
    const dailyNormalWage = salaryRow
      ? new Decimal(salaryRow.amount.toString()).div(30)
      : new Decimal(0);

    const vacationFractionalAmount = vacFracDays.mul(dailyNormalWage).toDecimalPlaces(4);
    const vacationBonusFractionalAmount = vacBonusFracDays.mul(dailyNormalWage).toDecimalPlaces(4);

    // ── 3. Utilidades fraccionadas ────────────────────────────────────────
    const currentFiscalYear = terminationDate.getFullYear();
    const fiscalYearStart = new Date(currentFiscalYear, 0, 1);
    const periodStart = employee.hireDate > fiscalYearStart
      ? employee.hireDate
      : fiscalYearStart;
    const monthsWorkedFiscal = countCompleteMonths(periodStart, terminationDate);

    // Promedio salarial del año fiscal (server-side)
    const salaryRowsFiscal = await prisma.salaryHistory.findMany({
      where: {
        companyId,
        employeeId,
        effectiveFrom: { lte: terminationDate },
      },
      orderBy: { effectiveFrom: "asc" },
    });

    let profitSharingFractionalDays = new Decimal(0);
    let profitSharingFractionalAmount = new Decimal(0);
    let profitSharingBaseSalary: Decimal | null = null;

    if (salaryRowsFiscal.length > 0 && monthsWorkedFiscal > 0) {
      const avgSalary = salaryRowsFiscal
        .reduce((sum, r) => sum.add(new Decimal(r.amount.toString())), new Decimal(0))
        .div(salaryRowsFiscal.length);

      profitSharingBaseSalary = avgSalary.toDecimalPlaces(4);
      const profitDays = new Decimal(config.profitDays);
      profitSharingFractionalDays = profitDays
        .mul(monthsWorkedFiscal)
        .div(12)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      profitSharingFractionalAmount = profitSharingFractionalDays
        .mul(avgSalary.div(30))
        .toDecimalPlaces(4);
    }

    // ── 4. Indemnización (solo DISMISSAL_UNJUSTIFIED — Art. 92 LOTTT) ─────
    // = prestaciones acumuladas completas como indemnización adicional
    const indemnificationAmount =
      input.reason === "DISMISSAL_UNJUSTIFIED"
        ? benefitsAccumulatedAmount.add(benefitsInterestAmount)
        : new Decimal(0);

    // ── 5. Preaviso (solo DISMISSAL_UNJUSTIFIED — Art. 86 LOTTT) ──────────
    // Tramos: <3m=15d, 3-6m=30d, 6-12m=45d, >1a=60d (calculado sobre salario diario)
    const noticePeriodDays = computeNoticePeriodDays(
      employee.hireDate,
      terminationDate,
      input.reason
    );
    const noticePeriodAmount = noticePeriodDays.mul(dailyNormalWage).toDecimalPlaces(4);

    // ── 6. Otros conceptos pendientes (usuario ajusta en DRAFT) ────────────
    const pendingConceptsAmount = input.pendingConceptsAmount
      ? new Decimal(input.pendingConceptsAmount)
      : new Decimal(0);

    // ── 7. Totales ────────────────────────────────────────────────────────
    const deductionsAmount = input.deductionsAmount
      ? new Decimal(input.deductionsAmount)
      : new Decimal(0);

    const totalGrossAmount = benefitsAccumulatedAmount
      .add(benefitsInterestAmount)
      .add(vacationFractionalAmount)
      .add(vacationBonusFractionalAmount)
      .add(profitSharingFractionalAmount)
      .add(indemnificationAmount)
      .add(noticePeriodAmount)
      .add(pendingConceptsAmount);

    const totalNetAmount = totalGrossAmount.sub(deductionsAmount);

    try {
      const termination = await prisma.termination.create({
        data: {
          companyId,
          employeeId,
          reason: input.reason,
          status: "DRAFT",
          terminationDate,
          benefitBalanceId: balance?.id ?? null,
          benefitsAccumulatedAmount: benefitsAccumulatedAmount.toFixed(4),
          benefitsInterestAmount: benefitsInterestAmount.toFixed(4),
          vacationFractionalDays: vacFracDays.toFixed(2),
          vacationFractionalAmount: vacationFractionalAmount.toFixed(4),
          vacationBonusFractionalAmount: vacationBonusFractionalAmount.toFixed(4),
          profitSharingFractionalDays: profitSharingFractionalDays.toFixed(2),
          profitSharingFractionalAmount: profitSharingFractionalAmount.toFixed(4),
          profitSharingBaseSalary: profitSharingBaseSalary?.toFixed(4) ?? null,
          indemnificationAmount: indemnificationAmount.toFixed(4),
          noticePeriodDays: noticePeriodDays.toFixed(2),
          noticePeriodAmount: noticePeriodAmount.toFixed(4),
          pendingConceptsAmount: pendingConceptsAmount.toFixed(4),
          pendingConceptsNotes: input.pendingConceptsNotes ?? null,
          totalGrossAmount: totalGrossAmount.toFixed(4),
          deductionsAmount: deductionsAmount.toFixed(4),
          totalNetAmount: totalNetAmount.toFixed(4),
          idempotencyKey: input.idempotencyKey,
          createdByUserId: userId,
        },
      });

      await prisma.auditLog.create({
        data: {
          companyId,
          entityName: "Termination",
          entityId: termination.id,
          action: "CREATE_TERMINATION_DRAFT",
          userId,
          ipAddress,
          userAgent,
          oldValue: Prisma.JsonNull,
          newValue: {
            employeeId,
            reason: input.reason,
            terminationDate: input.terminationDate,
            totalGrossAmount: totalGrossAmount.toFixed(4),
          },
        },
      });

      return serializeTermination(termination);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new Error(
          "Ya existe una liquidación en proceso para este empleado (clave de idempotencia duplicada)"
        );
      }
      throw err;
    }
  },

  // ── update — actualizar montos en DRAFT (solo conceptos manuales) ─────────
  // Los montos calculados server-side no son actualizables desde el cliente.
  async update(
    companyId: string,
    userId: string,
    terminationId: string,
    input: {
      pendingConceptsAmount?: string;
      pendingConceptsNotes?: string;
      deductionsAmount?: string;
    },
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<TerminationRow> {
    const existing = await prisma.termination.findFirst({
      where: { id: terminationId, companyId },
    });
    if (!existing) throw new Error("Liquidación no encontrada");
    if (existing.status !== "DRAFT") {
      throw new Error("Solo se puede modificar una liquidación en estado BORRADOR");
    }

    const pendingConceptsAmount = input.pendingConceptsAmount !== undefined
      ? new Decimal(input.pendingConceptsAmount)
      : new Decimal(existing.pendingConceptsAmount.toString());

    const deductionsAmount = input.deductionsAmount !== undefined
      ? new Decimal(input.deductionsAmount)
      : new Decimal(existing.deductionsAmount.toString());

    // Recalcular totales con los conceptos actualizados
    // noticePeriodAmount es server-side fixed — no cambia en updates
    const totalGrossAmount = new Decimal(existing.benefitsAccumulatedAmount.toString())
      .add(new Decimal(existing.benefitsInterestAmount.toString()))
      .add(new Decimal(existing.vacationFractionalAmount.toString()))
      .add(new Decimal(existing.vacationBonusFractionalAmount.toString()))
      .add(new Decimal(existing.profitSharingFractionalAmount.toString()))
      .add(new Decimal(existing.indemnificationAmount.toString()))
      .add(new Decimal(existing.noticePeriodAmount.toString()))
      .add(pendingConceptsAmount);

    const totalNetAmount = totalGrossAmount.sub(deductionsAmount);

    const updated = await prisma.termination.update({
      where: { id: terminationId },
      data: {
        pendingConceptsAmount: pendingConceptsAmount.toFixed(4),
        pendingConceptsNotes: input.pendingConceptsNotes ?? existing.pendingConceptsNotes,
        deductionsAmount: deductionsAmount.toFixed(4),
        totalGrossAmount: totalGrossAmount.toFixed(4),
        totalNetAmount: totalNetAmount.toFixed(4),
      },
    });

    await prisma.auditLog.create({
      data: {
        companyId,
        entityName: "Termination",
        entityId: terminationId,
        action: "UPDATE_TERMINATION_DRAFT",
        userId,
        ipAddress,
        userAgent,
        oldValue: {
          pendingConceptsAmount: existing.pendingConceptsAmount.toString(),
          deductionsAmount: existing.deductionsAmount.toString(),
        },
        newValue: {
          pendingConceptsAmount: pendingConceptsAmount.toFixed(4),
          deductionsAmount: deductionsAmount.toFixed(4),
          totalNetAmount: totalNetAmount.toFixed(4),
        },
      },
    });

    return serializeTermination(updated);
  },

  // ── finalize — DRAFT → FINALIZING → FINALIZED (ADR-014 Dec. 6) ───────────
  // Double-finalization guard: updateMany mutex DRAFT→FINALIZING.
  // Crea asiento contable de liquidación + marca BenefitBalance como liquidado.
  // Actualiza employee.status → TERMINATED.
  async finalize(
    companyId: string,
    userId: string,
    terminationId: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<TerminationRow> {
    // IDOR guard
    const termination = await prisma.termination.findFirst({
      where: { id: terminationId, companyId },
    });
    if (!termination) throw new Error("Liquidación no encontrada");
    if (termination.status === "FINALIZED") {
      throw new Error("Esta liquidación ya fue finalizada");
    }
    if (termination.status === "FINALIZING") {
      throw new Error(
        "Esta liquidación está en proceso de finalización. Si persiste más de 5 minutos, contacte a soporte."
      );
    }

    // Guard: período contable del mes de terminación
    const terminationDate = termination.terminationDate;
    const period = await prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        year: terminationDate.getFullYear(),
        month: terminationDate.getMonth() + 1,
        status: "OPEN",
      },
    });
    if (!period) {
      throw new Error(
        `El período contable ${terminationDate.getFullYear()}-${String(terminationDate.getMonth() + 1).padStart(2, "0")} está cerrado o no existe`
      );
    }

    const config = await prisma.payrollConfig.findUnique({ where: { companyId } });
    if (!config) throw new Error("Configuración de nómina no encontrada");

    // Verificar cuentas mínimas (benefitsPayable + payableAccount del config general)
    if (!config.benefitsPayableAccountId || !config.payableAccountId) {
      throw new Error(
        "Configure las cuentas contables de prestaciones y de pago en la configuración de nómina"
      );
    }

    const finalized = await prisma.$transaction(async (tx) => {
      // ── Mutex double-finalization guard (ADR-014 Dec. 6) ──────────────
      const guard = await tx.termination.updateMany({
        where: { id: terminationId, companyId, status: "DRAFT" },
        data: { status: "FINALIZING" },
      });
      if (guard.count === 0) {
        throw new Error("Liquidación ya finalizada o en proceso (race condition detectada)");
      }

      // ── Asiento contable de liquidación (ADR-014 Dec. 7) ──────────────
      // Convención: positivo = Débito (cancela pasivos), negativo = Crédito (pago neto)
      const totalNet = new Decimal(termination.totalNetAmount.toString());
      const deductions = new Decimal(termination.deductionsAmount.toString());
      const benefitsTotal = new Decimal(termination.benefitsAccumulatedAmount.toString())
        .add(new Decimal(termination.benefitsInterestAmount.toString()));
      const vacTotal = new Decimal(termination.vacationFractionalAmount.toString())
        .add(new Decimal(termination.vacationBonusFractionalAmount.toString()));
      const profitTotal = new Decimal(termination.profitSharingFractionalAmount.toString());
      const indemTotal = new Decimal(termination.indemnificationAmount.toString());
      const noticeTotal = new Decimal(termination.noticePeriodAmount.toString());
      const pendingTotal = new Decimal(termination.pendingConceptsAmount.toString());

      // Entradas de débito (eliminación de pasivos) + crédito (pago neto + deducciones)
      const empName = termination.employeeId.slice(-6);
      const liqDate = terminationDate.toISOString().split("T")[0];
      const journalEntries: Array<{ accountId: string; amount: Decimal; description?: string }> = [];

      if (benefitsTotal.gt(0) && config.benefitsPayableAccountId) {
        journalEntries.push({
          accountId: config.benefitsPayableAccountId,
          amount: benefitsTotal.toDecimalPlaces(4), // Débito — cancela el pasivo
          description: `Liquidación final — prestaciones sociales — ${empName} — ${liqDate}`,
        });
      }
      if (vacTotal.gt(0) && config.vacationPayableAccountId) {
        journalEntries.push({
          accountId: config.vacationPayableAccountId,
          amount: vacTotal.toDecimalPlaces(4),
          description: `Liquidación final — vacaciones fraccionadas — ${empName} — ${liqDate}`,
        });
      }
      if (profitTotal.gt(0) && config.profitSharingPayableAccountId) {
        journalEntries.push({
          accountId: config.profitSharingPayableAccountId,
          amount: profitTotal.toDecimalPlaces(4),
          description: `Liquidación final — utilidades fraccionadas — ${empName} — ${liqDate}`,
        });
      }
      if (indemTotal.gt(0) && config.benefitsPayableAccountId) {
        // Indemnización Art. 92 LOTTT — salida adicional de benefitsPayable
        journalEntries.push({
          accountId: config.benefitsPayableAccountId,
          amount: indemTotal.toDecimalPlaces(4),
          description: `Liquidación final — indemnización Art.92 LOTTT — ${empName} — ${liqDate}`,
        });
      }
      if (noticeTotal.gt(0) && config.benefitsExpenseAccountId) {
        // Preaviso Art. 86 LOTTT — gasto laboral (no hay pasivo previo)
        journalEntries.push({
          accountId: config.benefitsExpenseAccountId,
          amount: noticeTotal.toDecimalPlaces(4),
          description: `Liquidación final — preaviso Art.86 LOTTT — ${empName} — ${liqDate}`,
        });
      }
      if (pendingTotal.gt(0) && config.benefitsExpenseAccountId) {
        journalEntries.push({
          accountId: config.benefitsExpenseAccountId,
          amount: pendingTotal.toDecimalPlaces(4),
          description: `Liquidación final — conceptos pendientes — ${empName} — ${liqDate}`,
        });
      }

      // Crédito neto — cuenta por pagar al trabajador (payableAccountId del config)
      if (totalNet.gt(0)) {
        journalEntries.push({
          accountId: config.payableAccountId!,
          amount: totalNet.negated().toDecimalPlaces(4),
          description: `Liquidación final — neto a pagar — ${empName} — ${liqDate}`,
        });
      }

      // Crédito deducciones (IVSS, INCES, etc. por pagar a organismos)
      if (deductions.gt(0) && config.ivssPayableAccountId) {
        journalEntries.push({
          accountId: config.ivssPayableAccountId,
          amount: deductions.negated().toDecimalPlaces(4),
          description: `Liquidación final — retenciones legales — ${empName} — ${liqDate}`,
        });
      }

      const liquidationTx = await tx.transaction.create({
        data: {
          companyId,
          periodId: period.id,
          number: `NOM-D-LIQ-${terminationId.slice(-8)}`,
          date: terminationDate,
          description: `Liquidación final — empleado ${termination.employeeId.slice(-6)}`,
          userId,
          type: "DIARIO",
          entries: { create: journalEntries },
        },
      });

      // ── Marcar BenefitBalance como liquidado ───────────────────────────
      if (termination.benefitBalanceId) {
        await tx.benefitBalance.update({
          where: { id: termination.benefitBalanceId },
          data: { isLiquidated: true, liquidatedAt: new Date() },
        });
      }

      // ── Actualizar empleado → TERMINATED ──────────────────────────────
      await tx.employee.update({
        where: { id: termination.employeeId },
        data: {
          status: "TERMINATED",
          terminationDate,
        },
      });

      // ── FINALIZING → FINALIZED ────────────────────────────────────────
      const result = await tx.termination.update({
        where: { id: terminationId },
        data: {
          status: "FINALIZED",
          transactionId: liquidationTx.id,
          finalizedByUserId: userId,
          finalizedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "Termination",
          entityId: terminationId,
          action: "FINALIZE_TERMINATION",
          userId,
          ipAddress,
          userAgent,
          oldValue: { status: "DRAFT", totalNetAmount: termination.totalNetAmount.toString() },
          newValue: {
            status: "FINALIZED",
            transactionId: liquidationTx.id,
            totalNetAmount: totalNet.toFixed(4),
          },
        },
      });

      return result;
    });

    return serializeTermination(finalized);
  },

  // ── getById — liquidación individual (IDOR guard) ─────────────────────────
  async getById(companyId: string, terminationId: string): Promise<TerminationRow | null> {
    const t = await prisma.termination.findFirst({
      where: { id: terminationId, companyId },
    });
    return t ? serializeTermination(t) : null;
  },

  // ── list — listado de liquidaciones de la empresa ─────────────────────────
  async list(companyId: string, status?: TerminationStatus): Promise<TerminationRow[]> {
    const terminations = await prisma.termination.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(status ? { status } : {}),
      },
      orderBy: { terminationDate: "desc" },
    });
    return terminations.map(serializeTermination);
  },
};
