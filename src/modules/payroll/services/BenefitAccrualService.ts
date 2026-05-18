// src/modules/payroll/services/BenefitAccrualService.ts
// Fase NOM-D: Gestión de prestaciones sociales (garantía trimestral + intereses BCV)
//
// ADR-014 Decisiones clave:
//   Dec. 1: BenefitBalance + BenefitAccrualLine (Opción C — arquitectura de eventos)
//   Dec. 2: Tasa BCV en tabla BcvBenefitRate, NUNCA del cliente
//   Dec. 3: Snapshot de salario integral al momento del evento (inmutable)
//   Dec. 7: Asiento contable por evento (causación periódica — VEN-NIF / NIC 19)
//
// Security findings addressed (NOM-D security audit 2026-04-15):
//   CRITICAL-1: double-accrual guard → @@unique([benefitBalanceId, year, quarter, type]) + P2002
//   CRITICAL-3: tasa BCV nunca del cliente → fetched de BcvBenefitRate
//   HIGH-6a:   período contable OPEN guard antes de any INSERT
//   HIGH-7:    AuditLog dentro del mismo $transaction
//   HIGH-8:    rate limit en action (no en service)

import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { Prisma } from "@prisma/client";

// Días base por LOTTT Art. 142: 5 días/trimestre (15/año)
const BASE_DAYS_PER_QUARTER = 5;

// Días adicionales por antigüedad Art. 142 LOTTT:
// A partir del 2do año: +2 días/año de servicio (máx 30 adicionales/año).
// Se prorratea trimestralmente: additionalAnnual / 4.
// Returns prorated additional days for the quarter.
// Art. 142: after year 1 → 2 days × years_of_service per year, max 30. Prorated /4 per quarter.
function calcAdditionalDays(hireDate: Date, quarterEndDate: Date): Decimal {
  const ms = 365.25 * 24 * 60 * 60 * 1000;
  const yearsOfService = Math.floor((quarterEndDate.getTime() - hireDate.getTime()) / ms);
  if (yearsOfService < 1) return new Decimal(0);
  const additionalAnnual = Math.min(yearsOfService * 2, 30);
  return new Decimal(additionalAnnual).div(4);
}

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface AccrualLineRow {
  id: string;
  type: string;
  year: number;
  quarter: number | null;
  month: number | null;
  accrualAmount: string;
  runningBalance: string;
  integralDailyWage: string | null;
  accrualDays: number | null;
  additionalDays: string | null;
  appliedRate: string | null;
  transactionId: string | null;
  createdAt: string;
}

export interface BenefitBalanceRow {
  id: string;
  employeeId: string;
  currentBalance: string;
  interestBalance: string;
  isLiquidated: boolean;
  lines: AccrualLineRow[];
}

export interface BcvRateRow {
  id: string;
  year: number;
  month: number;
  annualRate: string;
  rateType: string;
  source: string;
}

function serializeLine(l: {
  id: string;
  type: string;
  year: number;
  quarter: number | null;
  month: number | null;
  accrualAmount: Decimal;
  runningBalance: Decimal;
  integralDailyWage: Decimal | null;
  accrualDays: number | null;
  additionalDays: Decimal | null;
  appliedRate: Decimal | null;
  transactionId: string | null;
  createdAt: Date;
}): AccrualLineRow {
  return {
    id: l.id,
    type: l.type,
    year: l.year,
    quarter: l.quarter,
    month: l.month,
    accrualAmount: l.accrualAmount.toString(),
    runningBalance: l.runningBalance.toString(),
    integralDailyWage: l.integralDailyWage?.toString() ?? null,
    accrualDays: l.accrualDays,
    additionalDays: l.additionalDays?.toString() ?? null,
    appliedRate: l.appliedRate?.toString() ?? null,
    transactionId: l.transactionId,
    createdAt: l.createdAt.toISOString(),
  };
}

// ─── BenefitAccrualService ────────────────────────────────────────────────────

export const BenefitAccrualService = {
  // ── getOrCreateBalance — obtiene o crea el BenefitBalance de un empleado ───
  async getOrCreateBalance(companyId: string, employeeId: string) {
    const existing = await prisma.benefitBalance.findUnique({
      where: { employeeId },
    });
    if (existing) return existing;
    return prisma.benefitBalance.create({
      data: { companyId, employeeId } as Parameters<typeof prisma.benefitBalance.create>[0]["data"],
    });
  },

  // ── getBalance — saldo con líneas de un empleado ──────────────────────────
  async getBalance(companyId: string, employeeId: string): Promise<BenefitBalanceRow | null> {
    const b = await prisma.benefitBalance.findFirst({
      where: { companyId, employeeId },
      include: {
        accrualLines: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!b) return null;
    return {
      id: b.id,
      employeeId: b.employeeId,
      currentBalance: b.currentBalance.toString(),
      interestBalance: b.interestBalance.toString(),
      isLiquidated: b.isLiquidated,
      lines: b.accrualLines.map(serializeLine),
    };
  },

  // ── accrueQuarter — accrual trimestral (Art. 142 LOTTT) ──────────────────
  // Crea BenefitAccrualLine de tipo QUARTERLY_ACCRUAL para todos los empleados activos.
  // Guard doble-accrual: @@unique([benefitBalanceId, year, quarter, type]) → P2002 → skip.
  // Guard período contable: verifica que el período del último mes del trimestre esté OPEN.
  async accrueQuarter(
    companyId: string,
    userId: string,
    year: number,
    quarter: number, // 1–4
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<{ employeesProcessed: number; totalAccrued: string }> {
    if (quarter < 1 || quarter > 4) throw new Error("El trimestre debe ser entre 1 y 4");

    // Guard: busca un período OPEN en cualquier mes del trimestre (el procesamiento
    // puede hacerse antes de que cierre el trimestre — se registra en el período activo)
    const quarterEndMonth = quarter * 3;   // Q1→3, Q2→6, Q3→9, Q4→12
    const quarterStartMonth = (quarter - 1) * 3 + 1; // Q1→1, Q2→4, Q3→7, Q4→10
    const period = await prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        year,
        month: { gte: quarterStartMonth, lte: quarterEndMonth },
        status: "OPEN",
      },
      orderBy: { month: "desc" },
    });
    if (!period) {
      throw new Error(
        `No hay período contable abierto para el ${year} Q${quarter} (meses ${quarterStartMonth}–${quarterEndMonth})`
      );
    }

    // Config de nómina para alícuotas de salario integral
    const config = await prisma.payrollConfig.findUnique({
      where: { companyId },
    });
    if (!config) throw new Error("Configure la nómina antes de calcular prestaciones");
    if (!config.benefitsExpenseAccountId || !config.benefitsPayableAccountId) {
      throw new Error("Configure las cuentas contables de prestaciones en la configuración de nómina");
    }

    // Empleados activos con salario vigente
    const quarterStartDate = new Date(year, quarterStartMonth - 1, 1);
    const quarterEndDate = new Date(year, quarterEndMonth - 1 + 1, 0); // último día del trimestre
    const employees = await prisma.employee.findMany({
      where: { companyId, status: "ACTIVE" },
      include: {
        salaryHistory: {
          where: { effectiveFrom: { lte: quarterEndDate } },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
        },
        benefitBalance: true,
      },
    });

    if (employees.length === 0) throw new Error("No hay empleados activos para acumular prestaciones");

    // Conceptos salariales con affectsSalaryIntegral=true de nóminas APPROVED del trimestre.
    // Se promedian por 3 meses para obtener el componente mensual del salario integral (LOTTT Art. 142).
    const integralLines = await prisma.payrollRunLine.findMany({
      where: {
        companyId,
        conceptType: "EARNING",
        payrollRun: {
          status: "APPROVED",
          periodStart: { gte: quarterStartDate },
          periodEnd: { lte: quarterEndDate },
        },
        concept: { affectsSalaryIntegral: true },
      },
      select: { employeeId: true, amount: true },
    });

    const integralByEmployee = new Map<string, Decimal>();
    for (const line of integralLines) {
      const prev = integralByEmployee.get(line.employeeId) ?? new Decimal(0);
      integralByEmployee.set(line.employeeId, prev.plus(new Decimal(line.amount.toString())));
    }

    let totalAccrued = new Decimal(0);
    let processed = 0;

    for (const emp of employees) {
      const salaryRow = emp.salaryHistory[0];
      if (!salaryRow) continue; // sin salario registrado — saltar

      const monthlyWage = new Decimal(salaryRow.amount.toString());
      // Promedio mensual de conceptos salariales del trimestre (affectsSalaryIntegral=true)
      const avgMonthlyIntegralConcepts = (integralByEmployee.get(emp.id) ?? new Decimal(0)).div(3);
      const dailyNormalWage = monthlyWage.plus(avgMonthlyIntegralConcepts).div(30);

      // Salario integral = dailyNormal + alícuota utilidades + alícuota bono vacacional (ADR-014 Dec. 3)
      const profitDaysAliquot = dailyNormalWage.mul(config.profitDays).div(360);
      const vacationBonusDaysAliquot = dailyNormalWage.mul(config.vacationBonusDays).div(360);
      const integralDailyWage = dailyNormalWage.add(profitDaysAliquot).add(vacationBonusDaysAliquot);

      // Días adicionales por antigüedad Art. 142 LOTTT (prorrateados trimestre)
      const additionalDays = calcAdditionalDays(emp.hireDate, quarterEndDate);
      const totalDays = new Decimal(BASE_DAYS_PER_QUARTER).add(additionalDays);
      const accrualAmount = integralDailyWage.mul(totalDays);

      // Ensure BenefitBalance exists
      let balance = emp.benefitBalance;
      if (!balance) {
        balance = await prisma.benefitBalance.create({
          data: { companyId, employeeId: emp.id } as Parameters<typeof prisma.benefitBalance.create>[0]["data"],
        });
      }

      const runningBalance = new Decimal(balance.currentBalance.toString()).add(accrualAmount);

      try {
        await prisma.$transaction(async (tx) => {
          // Asiento contable de causación (ADR-014 Dec. 7)
          // Convención: positivo = Débito, negativo = Crédito
          const transaction = await tx.transaction.create({
            data: {
              companyId,
              periodId: period.id,
              number: `NOM-D-Q${quarter}-${year}-${emp.id.slice(-6)}`,
              date: quarterEndDate,
              description: `Acumulación prestaciones Q${quarter}/${year} — ${emp.firstName} ${emp.lastName} (${BASE_DAYS_PER_QUARTER}d base${additionalDays.gt(0) ? `+${additionalDays.toFixed(2)}d antig.` : ""})`,
              userId,
              type: "DIARIO",
              entries: {
                create: [
                  {
                    accountId: config.benefitsExpenseAccountId!,
                    amount: accrualAmount.toDecimalPlaces(4), // Débito
                    description: `Accrual prestaciones LOTTT Art.142 — Q${quarter}/${year} — ${emp.firstName} ${emp.lastName}`,
                  },
                  {
                    accountId: config.benefitsPayableAccountId!,
                    amount: accrualAmount.negated().toDecimalPlaces(4), // Crédito
                    description: `Pasivo prestaciones — Q${quarter}/${year} — ${emp.firstName} ${emp.lastName}`,
                  },
                ],
              },
            },
          });

          // Línea de accrual — @@unique previene doble-accrual (ADR-014 Dec. 1)
          await tx.benefitAccrualLine.create({
            data: {
              companyId,
              benefitBalanceId: balance!.id,
              type: "QUARTERLY_ACCRUAL",
              year,
              quarter,
              dailyNormalWage: dailyNormalWage.toFixed(4),
              profitDaysAliquot: profitDaysAliquot.toFixed(4),
              vacationBonusDaysAliquot: vacationBonusDaysAliquot.toFixed(4),
              integralDailyWage: integralDailyWage.toFixed(4),
              accrualDays: BASE_DAYS_PER_QUARTER,
              additionalDays: additionalDays.toFixed(2),
              accrualAmount: accrualAmount.toFixed(4),
              runningBalance: runningBalance.toFixed(4),
              transactionId: transaction.id,
              createdByUserId: userId,
            },
          });

          // Actualizar saldo corriente
          await tx.benefitBalance.update({
            where: { id: balance!.id },
            data: {
              currentBalance: runningBalance.toFixed(4),
              updatedAt: new Date(),
            },
          });

          await tx.auditLog.create({
            data: {
              companyId,
              entityName: "BenefitAccrualLine",
              entityId: balance!.id,
              action: "ACCRUE_QUARTERLY_BENEFITS",
              userId,
              ipAddress,
              userAgent,
              oldValue: { balance: balance!.currentBalance.toString() },
              newValue: {
                employeeId: emp.id,
                year,
                quarter,
                accrualAmount: accrualAmount.toFixed(4),
                runningBalance: runningBalance.toFixed(4),
              },
            },
          });
        });

        totalAccrued = totalAccrued.add(accrualAmount);
        processed++;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          // Doble-accrual — saltar empleado sin fallar el batch
          continue;
        }
        throw err;
      }
    }

    if (processed === 0) {
      throw new Error(
        "Ya existe una acumulación de prestaciones para este trimestre en todos los empleados"
      );
    }

    return { employeesProcessed: processed, totalAccrued: totalAccrued.toFixed(4) };
  },

  // ── postBenefitInterest — intereses BCV (Art. 143 LOTTT) ─────────────────
  // La tasa BCV se obtiene de la tabla BcvBenefitRate — NUNCA del cliente (ADR-014 Dec. 2).
  async postBenefitInterest(
    companyId: string,
    userId: string,
    year: number,
    month: number, // 1–12
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<{ employeesProcessed: number; totalInterest: string }> {
    if (month < 1 || month > 12) throw new Error("El mes debe ser entre 1 y 12");

    // Guard: período contable OPEN
    const period = await prisma.accountingPeriod.findFirst({
      where: { companyId, year, month, status: "OPEN" },
    });
    if (!period) {
      throw new Error(`El período contable ${year}-${String(month).padStart(2, "0")} está cerrado o no existe`);
    }

    // Tasa BCV — NUNCA del cliente (ADR-014 Dec. 2 / security CRITICAL-3)
    const bcvRate = await prisma.bcvBenefitRate.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
    });
    if (!bcvRate) {
      throw new Error(
        `No existe tasa BCV registrada para ${year}-${String(month).padStart(2, "0")}. ` +
        "Registre la tasa activa promedio BCV antes de calcular intereses."
      );
    }

    const config = await prisma.payrollConfig.findUnique({ where: { companyId } });
    if (!config?.benefitsExpenseAccountId || !config?.benefitsPayableAccountId) {
      throw new Error("Configure las cuentas contables de prestaciones en la configuración de nómina");
    }

    // monthlyFactor = annualRate / 100 / 12
    const monthlyFactor = new Decimal(bcvRate.annualRate.toString()).div(100).div(12);

    const balances = await prisma.benefitBalance.findMany({
      where: { companyId, isLiquidated: false },
    });

    let totalInterest = new Decimal(0);
    let processed = 0;

    for (const balance of balances) {
      const totalBalance = new Decimal(balance.currentBalance.toString())
        .add(new Decimal(balance.interestBalance.toString()));

      if (totalBalance.lte(0)) continue;

      const interestAmount = totalBalance.mul(monthlyFactor);
      const newInterestBalance = new Decimal(balance.interestBalance.toString()).add(interestAmount);

      const lastLine = await prisma.benefitAccrualLine.findFirst({
        where: { benefitBalanceId: balance.id },
        orderBy: { createdAt: "desc" },
      });
      const prevRunningBalance = lastLine
        ? new Decimal(lastLine.runningBalance.toString())
        : new Decimal(balance.currentBalance.toString());
      const newRunningBalance = prevRunningBalance.add(interestAmount);

      const monthDate = new Date(year, month - 1, 1);

      await prisma.$transaction(async (tx) => {
        const transaction = await tx.transaction.create({
          data: {
            companyId,
            periodId: period.id,
            number: `NOM-D-INT-${year}-${String(month).padStart(2, "0")}-${balance.id.slice(-6)}`,
            date: monthDate,
            description: `Intereses BCV prestaciones ${year}-${String(month).padStart(2, "0")} — emp ${balance.employeeId.slice(-6)}`,
            userId,
            type: "DIARIO",
            entries: {
              create: [
                {
                  accountId: config.benefitsExpenseAccountId!,
                  amount: interestAmount.toDecimalPlaces(4), // Débito
                  description: `Intereses BCV sobre prestaciones — ${year}-${String(month).padStart(2, "0")} — emp ${balance.employeeId.slice(-6)}`,
                },
                {
                  accountId: config.benefitsPayableAccountId!,
                  amount: interestAmount.negated().toDecimalPlaces(4), // Crédito
                  description: `Pasivo intereses prestaciones — ${year}-${String(month).padStart(2, "0")} — emp ${balance.employeeId.slice(-6)}`,
                },
              ],
            },
          },
        });

        await tx.benefitAccrualLine.create({
          data: {
            companyId,
            benefitBalanceId: balance.id,
            type: "BCV_INTEREST",
            year,
            month,
            accrualAmount: interestAmount.toFixed(4),
            runningBalance: newRunningBalance.toFixed(4),
            bcvRateId: bcvRate.id,
            appliedRate: monthlyFactor.mul(100).toFixed(6),
            transactionId: transaction.id,
            createdByUserId: userId,
          },
        });

        await tx.benefitBalance.update({
          where: { id: balance.id },
          data: {
            interestBalance: newInterestBalance.toFixed(4),
            updatedAt: new Date(),
          },
        });

        await tx.auditLog.create({
          data: {
            companyId,
            entityName: "BenefitAccrualLine",
            entityId: balance.id,
            action: "POST_BENEFIT_INTEREST",
            userId,
            ipAddress,
            userAgent,
            oldValue: { interestBalance: balance.interestBalance.toString() },
            newValue: {
              year,
              month,
              annualRate: bcvRate.annualRate.toString(),
              interestAmount: interestAmount.toFixed(4),
              newInterestBalance: newInterestBalance.toFixed(4),
            },
          },
        });
      });

      totalInterest = totalInterest.add(interestAmount);
      processed++;
    }

    return { employeesProcessed: processed, totalInterest: totalInterest.toFixed(4) };
  },

  // ── createBcvRate — registrar tasa BCV mensual (ADMIN-only) ──────────────
  async createBcvRate(
    companyId: string,
    userId: string,
    year: number,
    month: number,
    annualRate: number,
    rateType: "ACTIVA" | "PROMEDIO" = "ACTIVA"
  ): Promise<BcvRateRow> {
    const rate = await prisma.bcvBenefitRate.create({
      data: {
        companyId,
        year,
        month,
        annualRate: new Decimal(annualRate).toFixed(2),
        rateType,
        createdByUserId: userId,
      },
    });
    return {
      id: rate.id,
      year: rate.year,
      month: rate.month,
      annualRate: rate.annualRate.toString(),
      rateType: rate.rateType,
      source: rate.source,
    };
  },

  // ── listBcvRates — tasas registradas de la empresa ────────────────────────
  async listBcvRates(companyId: string): Promise<BcvRateRow[]> {
    const rates = await prisma.bcvBenefitRate.findMany({
      where: { companyId },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    return rates.map((r) => ({
      id: r.id,
      year: r.year,
      month: r.month,
      annualRate: r.annualRate.toString(),
      rateType: r.rateType,
      source: r.source,
    }));
  },
};
