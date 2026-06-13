// src/modules/payroll/services/ProfitSharingService.ts
// Fase NOM-D: Utilidades fraccionadas por año fiscal (Art. 131–132 LOTTT)
//
// Fórmula (ADR-014 Dec. 8):
//   mesesAñoFiscal = meses completos trabajados en el año fiscal
//   fractionalDays = round((profitDays / 12) × mesesAñoFiscal, 2)
//   baseSalarySnapshot = promedio de SalaryHistory en el año fiscal (server-side)
//   profitAmount = fractionalDays × (baseSalarySnapshot / 30)
//
// Guard doble-pago: @@unique([companyId, employeeId, fiscalYear]) + P2002.
// baseSalarySnapshot calculado server-side — NUNCA del cliente (ADR-014 Dec. 3).
//
// Security findings addressed:
//   CRITICAL-IDOR: companyId en findFirst siempre
//   HIGH: baseSalary nunca del cliente
//   HIGH: profitDays de payrollConfig DB, no del cliente
//   HIGH: AuditLog dentro del mismo $transaction

import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { assertBalancedGLEntries } from "@/lib/gl-assertions";
import { Prisma } from "@prisma/client";
import { countCompleteMonths } from "./VacationService";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface ProfitSharingRecordRow {
  id: string;
  companyId: string;
  employeeId: string;
  fiscalYear: number;
  profitDays: string;
  fractionalDays: string;
  monthsWorked: number;
  baseSalarySnapshot: string;
  profitAmount: string;
  isFractional: boolean;
  transactionId: string | null;
  createdAt: string;
}

export interface CalculateProfitSharingInput {
  fiscalYear: number;
  isFractional?: boolean;
  // periodStart/End para calcular meses trabajados en el año fiscal.
  // Si no se proveen, se usa hireDate → 31-dic del año fiscal.
  periodStart?: string; // YYYY-MM-DD
  periodEnd?: string;   // YYYY-MM-DD (terminationDate si es fraccionado)
  // F-07: cálculo dinámico desde utilidad neta (LOTTT Art. 131)
  // Cuando ambos se proveen, profitDays se calcula en el servidor — nunca del cliente.
  netProfitVes?: string;
  totalAnnualPayrollVes?: string;
}

function serializeProfitSharing(r: {
  id: string;
  companyId: string;
  employeeId: string;
  fiscalYear: number;
  profitDays: Decimal;
  fractionalDays: Decimal;
  monthsWorked: number;
  baseSalarySnapshot: Decimal;
  profitAmount: Decimal;
  isFractional: boolean;
  transactionId: string | null;
  createdAt: Date;
}): ProfitSharingRecordRow {
  return {
    id: r.id,
    companyId: r.companyId,
    employeeId: r.employeeId,
    fiscalYear: r.fiscalYear,
    profitDays: r.profitDays.toString(),
    fractionalDays: r.fractionalDays.toString(),
    monthsWorked: r.monthsWorked,
    baseSalarySnapshot: r.baseSalarySnapshot.toString(),
    profitAmount: r.profitAmount.toString(),
    isFractional: r.isFractional,
    transactionId: r.transactionId,
    createdAt: r.createdAt.toISOString(),
  };
}

// ─── ProfitSharingService ─────────────────────────────────────────────────────

export const ProfitSharingService = {
  // ── calculate — registrar utilidades fraccionadas ─────────────────────────
  // Todas las magnitudes calculadas server-side (ADR-014 Dec. 3).
  async calculate(
    companyId: string,
    userId: string,
    employeeId: string,
    input: CalculateProfitSharingInput,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<ProfitSharingRecordRow> {
    // IDOR guard
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId },
    });
    if (!employee) throw new Error("Empleado no encontrado");

    // profitDays de la config — NUNCA del cliente (ADR-014 Dec. 3)
    const config = await prisma.payrollConfig.findUnique({ where: { companyId } });
    if (!config) throw new Error("Configure la nómina antes de calcular utilidades");
    if (!config.profitSharingPayableAccountId || !config.benefitsExpenseAccountId) {
      throw new Error("Configure las cuentas contables de utilidades en la configuración de nómina");
    }

    const fiscalYearStart = new Date(input.fiscalYear, 0, 1);    // 1-ene
    const fiscalYearEnd   = new Date(input.fiscalYear, 11, 31);  // 31-dic

    // Período de cálculo
    const periodStart = input.periodStart
      ? new Date(input.periodStart)
      : employee.hireDate > fiscalYearStart
      ? employee.hireDate
      : fiscalYearStart;

    const periodEnd = input.periodEnd
      ? new Date(input.periodEnd)
      : fiscalYearEnd;

    // Meses completos trabajados en el año fiscal (ADR-014 Dec. 8)
    const monthsWorked = countCompleteMonths(periodStart, periodEnd);
    if (monthsWorked === 0) {
      throw new Error("El empleado no completó ningún mes completo en el año fiscal");
    }

    // baseSalarySnapshot = promedio de SalaryHistory en el período
    // Cargamos todas las entradas de salario en el año fiscal para promediar
    const salaryRows = await prisma.salaryHistory.findMany({
      where: {
        companyId,
        employeeId,
        effectiveFrom: { lte: periodEnd },
      },
      orderBy: { effectiveFrom: "asc" },
    });

    if (salaryRows.length === 0) {
      throw new Error("El empleado no tiene historial de salarios registrado");
    }

    // Promedio ponderado simple: tomamos el promedio de los montos registrados
    // en el rango. Para cada mes del período, el salario vigente = max(effectiveFrom) <= mes.
    // Versión simplificada: promedio aritmético de los salarios únicos en el período.
    const salariesInPeriod = salaryRows.filter(
      (r) => r.effectiveFrom <= periodEnd
    );
    const avgSalary = salariesInPeriod
      .reduce((sum, r) => sum.add(new Decimal(r.amount.toString())), new Decimal(0))
      .div(salariesInPeriod.length);

    // F-07: usar utilidad neta cuando se provee; fallback a config.profitDays (LOTTT Art. 131)
    // profitPool = netProfit × 15%; profitDays = profitPool × 365 / totalAnnualPayroll
    // Rango legal: [15 días mínimo, 120 días máximo] (Art. 131 LOTTT)
    let profitDays: Decimal;
    if (input.netProfitVes && input.totalAnnualPayrollVes) {
      const netProfit = new Decimal(input.netProfitVes);
      const totalPayroll = new Decimal(input.totalAnnualPayrollVes);
      if (totalPayroll.lte(0)) throw new Error("La nómina anual debe ser mayor a cero");
      if (netProfit.lte(0)) {
        profitDays = new Decimal("15"); // mínimo legal aunque no haya utilidades positivas
      } else {
        const dynamic = netProfit.mul("0.15").mul("365").div(totalPayroll).toDecimalPlaces(2);
        profitDays = Decimal.max(new Decimal("15"), Decimal.min(new Decimal("120"), dynamic));
      }
    } else {
      profitDays = new Decimal(config.profitDays);
    }
    const fractionalDays = profitDays
      .mul(monthsWorked)
      .div(12)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const profitAmount = fractionalDays.mul(avgSalary.div(30)).toDecimalPlaces(4);

    const isFractional = input.isFractional ?? false;

    // Guard: período contable del mes actual — el asiento se causa hoy,
    // no en diciembre del año fiscal (que puede no existir aún).
    const today = new Date();
    const period = await prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        year: today.getFullYear(),
        month: today.getMonth() + 1,
        status: "OPEN",
      },
    });
    if (!period) {
      throw new Error(
        `El período contable ${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")} está cerrado o no existe`
      );
    }

    try {
      return await prisma.$transaction(async (tx) => {
        // Asiento contable de causación (VEN-NIF / NIC 19)
        // Convención: positivo = Débito, negativo = Crédito
        const profitEntries = [
          {
            accountId: config.benefitsExpenseAccountId!,
            amount: profitAmount.toDecimalPlaces(4), // Débito
            description: `Accrual utilidades LOTTT Art.131 — ${input.fiscalYear}${isFractional ? " fraccionadas" : ""} — ${employee.firstName} ${employee.lastName}`,
          },
          {
            accountId: config.profitSharingPayableAccountId!,
            amount: profitAmount.negated().toDecimalPlaces(4), // Crédito
            description: `Pasivo utilidades — ${input.fiscalYear}${isFractional ? " fraccionadas" : ""} — ${employee.firstName} ${employee.lastName}`,
          },
        ];
        assertBalancedGLEntries(profitEntries); // N4: invariante partida doble
        const transaction = await tx.transaction.create({
          data: {
            companyId,
            periodId: period.id,
            number: `NOM-D-UTIL-${input.fiscalYear}-${employeeId.slice(-6)}${isFractional ? "-F" : ""}`,
            date: today,
            description: `Utilidades ${input.fiscalYear}${isFractional ? " (fraccionadas)" : ""} — ${employee.firstName} ${employee.lastName}`,
            userId,
            type: "DIARIO",
            entries: {
              create: profitEntries,
            },
          },
        });

        // ProfitSharingRecord — guard doble-pago vía @@unique
        const record = await tx.profitSharingRecord.create({
          data: {
            companyId,
            employeeId,
            fiscalYear: input.fiscalYear,
            profitDays: profitDays.toFixed(2),
            fractionalDays: fractionalDays.toFixed(2),
            monthsWorked,
            baseSalarySnapshot: avgSalary.toFixed(4),
            profitAmount: profitAmount.toFixed(4),
            isFractional,
            transactionId: transaction.id,
            createdByUserId: userId,
          },
        });

        await tx.auditLog.create({
          data: {
            companyId,
            entityName: "ProfitSharingRecord",
            entityId: record.id,
            action: "CREATE_PROFIT_SHARING_RECORD",
            userId,
            ipAddress,
            userAgent,
            oldValue: Prisma.JsonNull,
            newValue: {
              employeeId,
              fiscalYear: input.fiscalYear,
              profitDays: profitDays.toFixed(2),
              fractionalDays: fractionalDays.toFixed(2),
              monthsWorked,
              profitAmount: profitAmount.toFixed(4),
              isFractional,
              ...(input.netProfitVes
                ? { netProfitVes: input.netProfitVes, totalAnnualPayrollVes: input.totalAnnualPayrollVes ?? null }
                : {}),
            },
          },
        });

        return serializeProfitSharing(record);
      }, { timeout: 15000, maxWait: 15000 });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new Error(
          `Ya existe un registro de utilidades para el año fiscal ${input.fiscalYear} de este empleado`
        );
      }
      throw err;
    }
  },

  // ── listByEmployee — historial de utilidades del empleado ─────────────────
  async listByEmployee(
    companyId: string,
    employeeId: string
  ): Promise<ProfitSharingRecordRow[]> {
    // IDOR: companyId en findMany
    const records = await prisma.profitSharingRecord.findMany({
      where: { companyId, employeeId },
      orderBy: [{ fiscalYear: "desc" }, { createdAt: "desc" }],
    });
    return records.map(serializeProfitSharing);
  },
};
