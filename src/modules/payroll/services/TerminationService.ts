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
import { assertBalancedGLEntries } from "@/lib/gl-assertions";
import { Prisma } from "@prisma/client";
import type {
  PrestacionesBasis, TerminationReason, TerminationStatus,
} from "@prisma/client";
import { countCompleteMonths, VacationService } from "./VacationService";
import {
  integralDailyWageFrom, LEGAL_MIN_PROFIT_DAYS,
} from "./BenefitAccrualService";

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

/**
 * Monto de prestaciones que entra en la liquidacion, segun la rama que gano por
 * el Art. 142(d). Se lee de la fila persistida para que el recalculo en DRAFT y
 * el asiento contable usen exactamente el mismo numero que el calculo inicial.
 */
function payableBenefitsOf(t: {
  benefitsAccumulatedAmount: { toString(): string };
  benefitsRetroactiveAmount: { toString(): string };
  benefitsBasisApplied: PrestacionesBasis;
}): Decimal {
  return t.benefitsBasisApplied === "GARANTIA_ACUMULADA"
    ? new Decimal(t.benefitsAccumulatedAmount.toString())
    : new Decimal(t.benefitsRetroactiveAmount.toString());
}

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
    // Rama (a)+(b) del Art. 142: lo efectivamente depositado, con los salarios
    // historicos de cada trimestre.
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

    // ── Moneda: la liquidación entera se calcula en BOLÍVARES ──────────────
    //
    // `BenefitBalance.currentBalance` ya viene en VES: BenefitAccrualService
    // convierte el sueldo en divisas con la tasa BCV de cada trimestre. Si aquí
    // se usara el monto crudo, la comparación del Art. 142(d) enfrentaría USD
    // contra Bs. y la rama acumulada ganaría siempre por dos órdenes de
    // magnitud — dejando el literal (d) inoperante justo para los empleados en
    // divisas. Es el mismo error que H-4 corrigió en el calculador.
    //
    // Simplificación consciente: se usa una sola tasa, la vigente a la fecha de
    // egreso, para todos los conceptos de esta liquidación. La garantía se
    // acumuló con las tasas históricas de cada trimestre; convertir cada tramo
    // a su tasa exigiría el historial completo y es trabajo aparte.
    const salaryRow = employee.salaryHistory[0];
    let monthlyWageVes = salaryRow
      ? new Decimal(salaryRow.amount.toString())
      : new Decimal(0);

    if (salaryRow && salaryRow.currency === "USD") {
      const fxRow = await prisma.exchangeRate.findFirst({
        where: { companyId, currency: "USD", date: { lte: terminationDate } },
        orderBy: { date: "desc" },
        select: { rate: true },
      });
      if (!fxRow) {
        throw new Error(
          "El empleado tiene el sueldo en USD y no hay tasa BCV registrada a la " +
          "fecha de egreso. Regístrala en Contabilidad → Tasas de Cambio antes " +
          "de generar la liquidación."
        );
      }
      monthlyWageVes = monthlyWageVes.mul(new Decimal(fxRow.rate.toString()));
    }

    const dailyNormalWage = monthlyWageVes.div(30);

    const vacationFractionalAmount = vacFracDays.mul(dailyNormalWage).toDecimalPlaces(4);
    const vacationBonusFractionalAmount = vacBonusFracDays.mul(dailyNormalWage).toDecimalPlaces(4);

    // ── 3. Utilidades fraccionadas ────────────────────────────────────────
    const currentFiscalYear = terminationDate.getUTCFullYear();
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
      // LOTTT Art. 131: el mínimo son treinta días. El resto del barrido ya lo
      // acotaba; este sitio se había quedado crudo, y el valor de BD es 15.
      const profitDays = Decimal.max(
        new Decimal(LEGAL_MIN_PROFIT_DAYS), new Decimal(config.profitDays),
      );
      profitSharingFractionalDays = profitDays
        .mul(monthsWorkedFiscal)
        .div(12)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      profitSharingFractionalAmount = profitSharingFractionalDays
        .mul(avgSalary.div(30))
        .toDecimalPlaces(4);
    }

    // ── 3-bis. Art. 142(d): el régimen es DUAL y hay que pagar el MAYOR ────
    //
    // (c) treinta días por cada año de servicio "o fracción superior a los seis
    //     meses, calculada al último salario" — y el último salario, por el
    //     Art. 122, es el INTEGRAL: incluye alícuotas de utilidades y bono
    //     vacacional.
    // (d) el trabajador recibe el monto que resulte mayor entre (a+b) y (c).
    // (e) si la relación termina antes de los tres primeros meses, la
    //     liquidación es de cinco días de salario por mes trabajado o fracción,
    //     y sustituye a las dos ramas anteriores.
    //
    // Como (c) aplica el último salario a TODA la antigüedad y la garantía se
    // deposito con los salarios historicos de cada trimestre, en un pais con
    // salarios que suben (c) suele ganar. Calcular solo (a+b) —lo que se hacia
    // hasta ahora— dejaba la liquidacion corta de forma sistematica.
    const integralDailyWage = integralDailyWageFrom(
      dailyNormalWage, config.profitDays, config.vacationBonusDays,
    );
    const monthsOfService = countCompleteMonths(employee.hireDate, terminationDate);
    // "año de servicio o fracción superior a los seis meses"
    const computableYears = Math.floor(monthsOfService / 12)
      + (monthsOfService % 12 > 6 ? 1 : 0);

    let benefitsRetroactiveAmount = integralDailyWage
      .mul(30)
      .mul(computableYears)
      .toDecimalPlaces(4);
    let benefitsBasisApplied: PrestacionesBasis =
      benefitsRetroactiveAmount.greaterThan(benefitsAccumulatedAmount)
        ? "CALCULO_RETROACTIVO"
        : "GARANTIA_ACUMULADA";

    if (monthsOfService < 3) {
      // Literal (e): cinco dias por mes trabajado O FRACCION — un mes empezado
      // cuenta entero, por eso se redondea hacia arriba.
      const monthsOrFraction = Math.max(
        1,
        Math.ceil(
          (terminationDate.getTime() - employee.hireDate.getTime()) /
            (1000 * 60 * 60 * 24 * 30)
        )
      );
      benefitsRetroactiveAmount = integralDailyWage
        .mul(5)
        .mul(monthsOrFraction)
        .toDecimalPlaces(4);
      benefitsBasisApplied = "PRIMEROS_TRES_MESES";
    }

    // El monto que entra en la liquidacion. Los intereses del Art. 143 se pagan
    // aparte en ambos casos: son rendimiento de lo depositado, no una rama.
    const benefitsPayableAmount =
      benefitsBasisApplied === "GARANTIA_ACUMULADA"
        ? benefitsAccumulatedAmount
        : benefitsRetroactiveAmount;

    // ── 4. Indemnización (solo DISMISSAL_UNJUSTIFIED — Art. 92 LOTTT) ─────
    // = prestaciones acumuladas completas como indemnización adicional
    // Art. 92: "una indemnizacion equivalente al monto que le corresponde por
    // las prestaciones sociales" — o sea sobre lo que realmente se paga por
    // prestaciones, que puede ser la rama retroactiva.
    const indemnificationAmount =
      input.reason === "DISMISSAL_UNJUSTIFIED"
        ? benefitsPayableAmount.add(benefitsInterestAmount)
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

    const totalGrossAmount = benefitsPayableAmount
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
          benefitsRetroactiveAmount: benefitsRetroactiveAmount.toFixed(4),
          benefitsBasisApplied,
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
    const totalGrossAmount = payableBenefitsOf(existing)
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
        year: terminationDate.getUTCFullYear(),
        month: terminationDate.getUTCMonth() + 1,
        status: "OPEN",
      },
    });
    if (!period) {
      throw new Error(
        `El período contable ${terminationDate.getUTCFullYear()}-${String(terminationDate.getUTCMonth() + 1).padStart(2, "0")} está cerrado o no existe`
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
      // Art. 142(d): el pasivo que se cancela es el de la rama que gano, no
      // siempre la garantia acumulada. Si el asiento usara otra, no cuadraria
      // con el neto pagado.
      const benefitsTotal = payableBenefitsOf(termination)
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

      // Art. 142(d): el pasivo de prestaciones solo se acredito con la GARANTIA
      // acumulada. Si gana la rama retroactiva, el exceso nunca se provisiono:
      // debitarlo contra el pasivo lo dejaria en saldo DEUDOR y el gasto
      // incremental no se reconoceria nunca. El exceso es gasto del ejercicio,
      // igual que el preaviso mas abajo ("no hay pasivo previo").
      const accruedLiability = new Decimal(termination.benefitsAccumulatedAmount.toString())
        .add(new Decimal(termination.benefitsInterestAmount.toString()));
      const provisionedPart = Decimal.min(benefitsTotal, accruedLiability);
      const unprovisionedPart = benefitsTotal.sub(provisionedPart);

      if (provisionedPart.gt(0) && config.benefitsPayableAccountId) {
        journalEntries.push({
          accountId: config.benefitsPayableAccountId,
          amount: provisionedPart.toDecimalPlaces(4), // Débito — cancela el pasivo
          description: `Liquidación final — prestaciones sociales — ${empName} — ${liqDate}`,
        });
      }
      if (unprovisionedPart.gt(0) && config.benefitsExpenseAccountId) {
        journalEntries.push({
          accountId: config.benefitsExpenseAccountId,
          amount: unprovisionedPart.toDecimalPlaces(4), // Débito — gasto del ejercicio
          description:
            `Liquidación final — diferencia Art.142(c) no provisionada — ${empName} — ${liqDate}`,
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
      if (indemTotal.gt(0) && config.benefitsExpenseAccountId) {
        // Indemnización Art. 92 LOTTT — nace AL despedir, nunca se provisionó:
        // es gasto del ejercicio, no cancelación de un pasivo. Iba contra
        // benefitsPayable y lo dejaba en saldo deudor por su importe completo.
        journalEntries.push({
          accountId: config.benefitsExpenseAccountId,
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

      assertBalancedGLEntries(journalEntries); // N4: invariante partida doble
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
