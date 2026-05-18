// src/modules/payroll/services/VacationService.ts
// Fase NOM-D: Vacaciones y bono vacacional (Art. 190–192 LOTTT)
//
// ADR-014 Dec. 3: dailyNormalWage calculado server-side desde SalaryHistory — NUNCA del cliente.
// ADR-014 Dec. 8: meses completos — 15+ días = mes completo.
// Guard doble-pago: @@unique([companyId, employeeId, periodYear, isFractional]) + P2002.
// Asiento contable: DB vacationPayableAccountId / CR payableAccountId por causación (VEN-NIF).
//
// Security findings addressed:
//   CRITICAL-IDOR: companyId verificado en findFirst siempre
//   HIGH: dailyWage nunca del cliente
//   HIGH: vacationDays max 90 — Zod guard (no en service)
//   HIGH: AuditLog dentro del mismo $transaction
//   HIGH: período contable OPEN guard

import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { Prisma } from "@prisma/client";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface VacationRecordRow {
  id: string;
  companyId: string;
  employeeId: string;
  periodYear: number;
  vacationDays: string;
  bonusDays: string;
  dailyNormalWage: string;
  vacationAmount: string;
  bonusAmount: string;
  startDate: string;
  endDate: string;
  isFractional: boolean;
  transactionId: string | null;
  createdAt: string;
}

export interface CreateVacationInput {
  periodYear: number;
  vacationDays: number;  // max 90 — validado en Zod schema
  bonusDays: number;     // max 90 — validado en Zod schema
  startDate: string;     // YYYY-MM-DD
  endDate: string;       // YYYY-MM-DD
  isFractional?: boolean;
}

function serializeVacation(v: {
  id: string;
  companyId: string;
  employeeId: string;
  periodYear: number;
  vacationDays: Decimal;
  bonusDays: Decimal;
  dailyNormalWage: Decimal;
  vacationAmount: Decimal;
  bonusAmount: Decimal;
  startDate: Date;
  endDate: Date;
  isFractional: boolean;
  transactionId: string | null;
  createdAt: Date;
}): VacationRecordRow {
  return {
    id: v.id,
    companyId: v.companyId,
    employeeId: v.employeeId,
    periodYear: v.periodYear,
    vacationDays: v.vacationDays.toString(),
    bonusDays: v.bonusDays.toString(),
    dailyNormalWage: v.dailyNormalWage.toString(),
    vacationAmount: v.vacationAmount.toString(),
    bonusAmount: v.bonusAmount.toString(),
    startDate: v.startDate.toISOString().split("T")[0],
    endDate: v.endDate.toISOString().split("T")[0],
    isFractional: v.isFractional,
    transactionId: v.transactionId,
    createdAt: v.createdAt.toISOString(),
  };
}

// ─── VacationService ──────────────────────────────────────────────────────────

export const VacationService = {
  // ── create — registrar vacaciones o bono vacacional ───────────────────────
  // dailyNormalWage calculado server-side desde SalaryHistory (ADR-014 Dec. 3).
  // Guard doble-pago: @@unique([companyId, employeeId, periodYear, isFractional]) → P2002.
  async create(
    companyId: string,
    userId: string,
    employeeId: string,
    input: CreateVacationInput,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<VacationRecordRow> {
    // IDOR guard
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      include: {
        salaryHistory: {
          where: { effectiveFrom: { lte: new Date(input.startDate) } },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
        },
      },
    });
    if (!employee) throw new Error("Empleado no encontrado");

    // dailyNormalWage — NUNCA del cliente (ADR-014 Dec. 3)
    const salaryRow = employee.salaryHistory[0];
    if (!salaryRow) {
      throw new Error("El empleado no tiene salario registrado vigente a la fecha de inicio de vacaciones");
    }
    const monthlyWage = new Decimal(salaryRow.amount.toString());
    const dailyNormalWage = monthlyWage.div(30);

    const vacationDays = new Decimal(input.vacationDays);
    const bonusDays = new Decimal(input.bonusDays);
    const vacationAmount = dailyNormalWage.mul(vacationDays);
    const bonusAmount = dailyNormalWage.mul(bonusDays);

    // Guard: período contable del mes de inicio de vacaciones
    const startDateObj = new Date(input.startDate);
    const period = await prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        year: startDateObj.getFullYear(),
        month: startDateObj.getMonth() + 1,
        status: "OPEN",
      },
    });
    if (!period) {
      throw new Error(
        `El período contable ${startDateObj.getFullYear()}-${String(startDateObj.getMonth() + 1).padStart(2, "0")} está cerrado o no existe`
      );
    }

    // Config para cuentas contables
    const config = await prisma.payrollConfig.findUnique({ where: { companyId } });
    if (!config?.vacationPayableAccountId || !config?.benefitsExpenseAccountId) {
      throw new Error("Configure las cuentas contables de vacaciones en la configuración de nómina");
    }

    const totalAmount = vacationAmount.add(bonusAmount);
    const isFractional = input.isFractional ?? false;

    try {
      return await prisma.$transaction(async (tx) => {
        // Asiento contable de causación (VEN-NIF / NIC 19)
        // Convención: positivo = Débito, negativo = Crédito
        const transaction = await tx.transaction.create({
          data: {
            companyId,
            periodId: period.id,
            number: `NOM-D-VAC-${input.periodYear}-${employeeId.slice(-6)}${isFractional ? "-F" : ""}`,
            date: startDateObj,
            description: `Vacaciones ${input.periodYear}${isFractional ? " (fraccionadas)" : ""} — ${employee.firstName} ${employee.lastName}`,
            userId,
            type: "DIARIO",
            entries: {
              create: [
                {
                  accountId: config.benefitsExpenseAccountId!,
                  amount: totalAmount.toDecimalPlaces(4), // Débito
                  description: `Accrual vacaciones LOTTT Art.190 — ${input.periodYear}${isFractional ? " fraccionadas" : ""} — ${employee.firstName} ${employee.lastName}`,
                },
                {
                  accountId: config.vacationPayableAccountId!,
                  amount: totalAmount.negated().toDecimalPlaces(4), // Crédito
                  description: `Pasivo vacaciones — ${input.periodYear}${isFractional ? " fraccionadas" : ""} — ${employee.firstName} ${employee.lastName}`,
                },
              ],
            },
          },
        });

        // VacationRecord — guard doble-pago vía @@unique
        const record = await tx.vacationRecord.create({
          data: {
            companyId,
            employeeId,
            periodYear: input.periodYear,
            vacationDays: vacationDays.toFixed(2),
            bonusDays: bonusDays.toFixed(2),
            dailyNormalWage: dailyNormalWage.toFixed(4),
            vacationAmount: vacationAmount.toFixed(4),
            bonusAmount: bonusAmount.toFixed(4),
            startDate: new Date(input.startDate),
            endDate: new Date(input.endDate),
            isFractional,
            transactionId: transaction.id,
            createdByUserId: userId,
          },
        });

        await tx.auditLog.create({
          data: {
            companyId,
            entityName: "VacationRecord",
            entityId: record.id,
            action: "CREATE_VACATION_RECORD",
            userId,
            ipAddress,
            userAgent,
            oldValue: Prisma.JsonNull,
            newValue: {
              employeeId,
              periodYear: input.periodYear,
              vacationDays: input.vacationDays,
              bonusDays: input.bonusDays,
              vacationAmount: vacationAmount.toFixed(4),
              bonusAmount: bonusAmount.toFixed(4),
              isFractional,
            },
          },
        });

        return serializeVacation(record);
      }, { timeout: 15000, maxWait: 15000 });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new Error(
          `Ya existe un registro de vacaciones ${isFractional ? "fraccionadas" : ""} para el período ${input.periodYear} de este empleado`
        );
      }
      throw err;
    }
  },

  // ── listByEmployee — historial de vacaciones del empleado ─────────────────
  async listByEmployee(
    companyId: string,
    employeeId: string
  ): Promise<VacationRecordRow[]> {
    // IDOR: companyId en findMany
    const records = await prisma.vacationRecord.findMany({
      where: { companyId, employeeId },
      orderBy: [{ periodYear: "desc" }, { createdAt: "desc" }],
    });
    return records.map(serializeVacation);
  },

  // ── getEmployeesWithLowVacationBalance — empleados con ≤1 día restante ─────
  // Usado por el dashboard para mostrar alerta de vacaciones por agotar.
  async getEmployeesWithLowVacationBalance(
    companyId: string,
    threshold = 1
  ): Promise<{ employeeId: string; fullName: string; remaining: number; entitlement: number }[]> {
    const today = new Date();
    const currentYear = today.getFullYear();

    const employees = await prisma.employee.findMany({
      where: { companyId, status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, hireDate: true },
    });

    const records = await prisma.vacationRecord.findMany({
      where: { companyId, periodYear: currentYear },
      select: { employeeId: true, vacationDays: true },
    });

    const usedByEmployee = new Map<string, number>();
    for (const r of records) {
      const prev = usedByEmployee.get(r.employeeId) ?? 0;
      usedByEmployee.set(r.employeeId, prev + Number(r.vacationDays));
    }

    const alerts: { employeeId: string; fullName: string; remaining: number; entitlement: number }[] = [];
    for (const emp of employees) {
      const msPerYear = 1000 * 60 * 60 * 24 * 365.25;
      const yearsOfService = Math.floor((today.getTime() - emp.hireDate.getTime()) / msPerYear);
      const entitlement = Math.max(15, 14 + yearsOfService);
      const used = usedByEmployee.get(emp.id) ?? 0;
      const remaining = entitlement - used;
      if (remaining <= threshold && remaining >= 0) {
        alerts.push({
          employeeId: emp.id,
          fullName: `${emp.firstName} ${emp.lastName}`,
          remaining,
          entitlement,
        });
      }
    }
    return alerts;
  },

  // ── computeFractional — calcula días fraccionados sin persistir ───────────
  // Usado internamente por TerminationService.
  computeFractionalDays(
    hireDate: Date,
    terminationDate: Date,
    yearsOfService: number
  ): { vacationDays: Decimal; bonusDays: Decimal } {
    // Días de vacaciones anuales = 15 + (años antigüedad - 1), mínimo 15 (Art. 190 LOTTT)
    const annualVacDays = Math.max(15, 14 + yearsOfService);
    // Bono vacacional = 7 + (años - 1), mínimo 7 (Art. 192 LOTTT)
    const annualBonusDays = Math.max(7, 6 + yearsOfService);

    // Meses completos en el año de servicio actual (ADR-014 Dec. 8)
    const yearStart = new Date(terminationDate.getFullYear(), 0, 1);
    const referenceStart = terminationDate > yearStart ? yearStart : hireDate;
    const monthsInYear = countCompleteMonths(referenceStart, terminationDate);

    const vacDaysFrac = new Decimal(annualVacDays).mul(monthsInYear).div(12).toDecimalPlaces(2);
    const bonusDaysFrac = new Decimal(annualBonusDays).mul(monthsInYear).div(12).toDecimalPlaces(2);

    return { vacationDays: vacDaysFrac, bonusDays: bonusDaysFrac };
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Cuenta meses completos entre dos fechas (ADR-014 Dec. 8: 15+ días = mes completo).
// Usa UTC para evitar discrepancias de timezone al construir Date desde string YYYY-MM-DD.
export function countCompleteMonths(from: Date, to: Date): number {
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());

  const remainderDays = to.getUTCDate() - from.getUTCDate();
  if (remainderDays >= 15) {
    months += 1;
  }

  return Math.max(0, months);
}
