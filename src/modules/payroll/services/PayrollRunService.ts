// src/modules/payroll/services/PayrollRunService.ts
// Fase NOM-C: CRUD de procesos de nómina + aprobación + cancelación
//
// Seguridad (ADR-013):
//   NOM-C-01: findFirst siempre incluye companyId en where (IDOR guard)
//   NOM-C-02: create() captura P2002 del @@unique como doble-proceso — no Serializable
//   NOM-C-03: approve() usa updateMany mutex (status:'DRAFT') — no Serializable
//   NOM-C-04: cancel() solo desde DRAFT; APPROVED lanza error explícito
//   NOM-C-11: AuditLog en $transaction de create/approve/cancel
//   NOM-C-13: guard de período contable cerrado en create/approve
//   NOM-C-14: totales calculados aquí, nunca del input del cliente

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import type {
  PayrollRunStatus,
  PayrollPaymentCurrency,
  ConceptType,
} from "@prisma/client";
import {
  PayrollCalculatorService,
  type EmployeeCalculationInput,
  type ManualConceptCalculationInput,
  type PayrollCalculatorConfig,
} from "./PayrollCalculatorService";
import { PayrollConceptService } from "./PayrollConceptService";
import { LegalThresholdService } from "./LegalThresholdService";
import type { CreatePayrollRunInput } from "../schemas/payroll-run.schema";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface PayrollRunLineRow {
  id: string;
  employeeId: string;
  employeeName: string;
  conceptCode: string;
  conceptType: ConceptType;
  amount: string;
  hours: string | null;
  rate: string | null;
  salarySnapshotAmount: string | null;
}

export interface PayrollRunRow {
  id: string;
  companyId: string;
  periodStart: string;
  periodEnd: string;
  status: PayrollRunStatus;
  totalEarnings: string;
  totalDeductions: string;
  totalNet: string;
  employeeCount: number;
  transactionId: string | null;
  createdByUserId: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface PayrollRunDetailRow extends PayrollRunRow {
  lines: PayrollRunLineRow[];
}

// ─── Serialización ────────────────────────────────────────────────────────────

function serializeRun(r: {
  id: string;
  companyId: string;
  periodStart: Date;
  periodEnd: Date;
  status: PayrollRunStatus;
  totalEarnings: Decimal;
  totalDeductions: Decimal;
  totalNet: Decimal;
  employeeCount: number;
  transactionId: string | null;
  createdByUserId: string;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}): PayrollRunRow {
  return {
    id: r.id,
    companyId: r.companyId,
    periodStart: r.periodStart.toISOString().split("T")[0],
    periodEnd: r.periodEnd.toISOString().split("T")[0],
    status: r.status,
    totalEarnings: r.totalEarnings.toString(),
    totalDeductions: r.totalDeductions.toString(),
    totalNet: r.totalNet.toString(),
    employeeCount: r.employeeCount,
    transactionId: r.transactionId,
    createdByUserId: r.createdByUserId,
    approvedByUserId: r.approvedByUserId,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

// ─── PayrollRunService ────────────────────────────────────────────────────────

export const PayrollRunService = {
  // ── list — todos los runs de la empresa (sin líneas — NOM-C-17) ───────────
  async list(companyId: string): Promise<PayrollRunRow[]> {
    const runs = await prisma.payrollRun.findMany({
      where: { companyId },
      orderBy: { periodStart: "desc" },
    });
    return runs.map(serializeRun);
  },

  // ── getById — run con líneas detalladas ───────────────────────────────────
  // NOM-C-01: findFirst con companyId (IDOR guard)
  async getById(companyId: string, runId: string): Promise<PayrollRunDetailRow | null> {
    const run = await prisma.payrollRun.findFirst({
      where: { id: runId, companyId },
      include: {
        lines: {
          include: {
            employee: { select: { firstName: true, lastName: true } },
          },
          orderBy: [{ employeeId: "asc" }, { conceptCode: "asc" }],
        },
      },
    });
    if (!run) return null;

    return {
      ...serializeRun(run),
      lines: run.lines.map((l) => ({
        id: l.id,
        employeeId: l.employeeId,
        employeeName: `${l.employee.firstName} ${l.employee.lastName}`,
        conceptCode: l.conceptCode,
        conceptType: l.conceptType,
        amount: l.amount.toString(),
        hours: l.hours?.toString() ?? null,
        rate: l.rate?.toString() ?? null,
        salarySnapshotAmount: l.salarySnapshotAmount?.toString() ?? null,
      })),
    };
  },

  // ── create — calcula y persiste un run en DRAFT ───────────────────────────
  // NOM-C-02: P2002 del @@unique manejado por la action (no Serializable)
  // NOM-C-13: guard de período contable cerrado
  // NOM-C-14: totales calculados aquí — nunca del input
  async create(
    companyId: string,
    userId: string,
    input: CreatePayrollRunInput
  ): Promise<PayrollRunRow> {
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);

    // ── Guard período contable (NOM-C-13) ─────────────────────────────────
    // Usar métodos UTC para evitar desfase de zona horaria (VEN = UTC-4)
    const openPeriod = await prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        year: periodStart.getUTCFullYear(),
        month: periodStart.getUTCMonth() + 1,
        status: "OPEN",
      },
    });
    if (!openPeriod) {
      throw new Error(
        "No existe un período contable abierto que cubra las fechas de nómina"
      );
    }

    // ── Obtener config (con flags de organismos) ───────────────────────────
    const config = await prisma.payrollConfig.findUnique({
      where: { companyId },
    });
    if (!config) throw new Error("Configure la nómina antes de procesar");

    // ── Obtener empleados activos (o seleccionados) ────────────────────────
    const employeeFilter =
      input.employeeIds && input.employeeIds.length > 0
        ? { id: { in: input.employeeIds }, companyId, status: "ACTIVE" as const }
        : { companyId, status: "ACTIVE" as const };

    const employees = await prisma.employee.findMany({
      where: employeeFilter,
      include: {
        salaryHistory: {
          where: { effectiveFrom: { lte: periodStart } },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
        },
      },
    });

    if (employees.length === 0) {
      throw new Error("No hay empleados activos para procesar");
    }

    // ── Garantizar que los conceptos del sistema existen (idempotente) ───────
    // Necesario para empresas que nunca visitaron la página de conceptos
    // y para sincronizar nuevos conceptos del sistema (ej: RPE_OBR — ítem 54)
    await PayrollConceptService.seedDefaults(companyId);

    // ── Obtener conceptos del sistema de la empresa ────────────────────────
    // NOM-C-07: siempre de la DB con companyId — nunca del input del cliente
    const systemConcepts = await prisma.payrollConcept.findMany({
      where: { companyId, isSystem: true, isActive: true },
      select: { id: true, code: true },
    });

    // Tope salario mínimo: LegalThreshold vigente al inicio del período,
    // con fallback a PayrollConfig.salaryMinimumVes para retrocompatibilidad.
    const thresholdSalMin = await LegalThresholdService.getActive(
      companyId,
      "SALARY_MIN_VES",
      new Date(input.periodStart),
    );
    const salaryMinimumVes =
      thresholdSalMin ??
      (config.salaryMinimumVes ? new Decimal(config.salaryMinimumVes.toString()) : new Decimal(0));

    const calcConfig: PayrollCalculatorConfig = {
      frequency: config.frequency,
      ivssEnabled: config.ivssEnabled,
      incesEnabled: config.incesEnabled,
      banavihEnabled: config.banavihEnabled,
      rpeEnabled: config.rpeEnabled,
      salaryMinimumVes,
      systemConcepts: systemConcepts.map((c) => ({ code: c.code, conceptId: c.id })),
    };

    // ── Construir inputs del calculador ────────────────────────────────────
    const empInputs: EmployeeCalculationInput[] = employees
      .filter((e) => e.salaryHistory.length > 0)
      .map((e) => ({
        employeeId: e.id,
        salaryHistoryId: e.salaryHistory[0].id,
        salaryAmount: e.salaryHistory[0].amount,
        salaryCurrency: e.salaryHistory[0].currency,
        overtimeHoursDay: new Decimal(0),
        overtimeHoursNight: new Decimal(0),
        absenceDays: new Decimal(0),
      }));

    // ── Conceptos manuales (NOM-C-07: validar ownership) ──────────────────
    const manualInputs: ManualConceptCalculationInput[] = [];
    if (input.manualConcepts && input.manualConcepts.length > 0) {
      const manualConceptIds = [...new Set(input.manualConcepts.map((m) => m.conceptId))];
      const validConcepts = await prisma.payrollConcept.findMany({
        where: { id: { in: manualConceptIds }, companyId },
        select: { id: true, code: true, type: true },
      });
      if (validConcepts.length !== manualConceptIds.length) {
        throw new Error("Uno o más conceptos manuales no pertenecen a esta empresa");
      }
      const conceptMap = new Map(validConcepts.map((c) => [c.id, c]));
      for (const m of input.manualConcepts) {
        const concept = conceptMap.get(m.conceptId)!;
        manualInputs.push({
          conceptId: m.conceptId,
          conceptCode: concept.code,
          conceptType: concept.type,
          employeeId: m.employeeId,
          amount: new Decimal(m.amount),
        });
      }
    }

    // ── Cuotas de préstamos activos (PRESTAMO_EMP) ────────────────────────
    // Inyectadas como deducciones automáticas antes del cálculo.
    // La cuota = min(installmentAmount, remainingBalance) por préstamo.
    const employeeIds = empInputs.map((e) => e.employeeId);
    const activeLoans = await prisma.employeeLoan.findMany({
      where: { companyId, status: "ACTIVE", employeeId: { in: employeeIds } },
      orderBy: { createdAt: "asc" }, // más antiguo primero
    });
    if (activeLoans.length > 0) {
      const loanConcept = systemConcepts.find((c) => c.code === "PRESTAMO_EMP");
      if (loanConcept) {
        for (const loan of activeLoans) {
          const installment = Decimal.min(
            new Decimal(loan.installmentAmount.toString()),
            new Decimal(loan.remainingBalance.toString()),
          );
          if (installment.greaterThan(0)) {
            manualInputs.push({
              conceptId: loanConcept.id,
              conceptCode: "PRESTAMO_EMP",
              conceptType: "DEDUCTION",
              employeeId: loan.employeeId,
              amount: installment,
            });
          }
        }
      }
    }

    // ── Calcular (servicio puro — lanza si netPayable < 0) ────────────────
    const result = PayrollCalculatorService.calculate(empInputs, manualInputs, calcConfig);

    // ── Persistir en $transaction ──────────────────────────────────────────
    return prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.create({
        data: {
          companyId,
          periodStart,
          periodEnd,
          status: "DRAFT",
          totalEarnings: result.totalEarnings,
          totalDeductions: result.totalDeductions,
          totalNet: result.totalNet,
          employeeCount: empInputs.length,
          createdByUserId: userId,
          idempotencyKey: input.idempotencyKey,
        },
      });

      if (result.lines.length > 0) {
        await tx.payrollRunLine.createMany({
          data: result.lines.map((l) => ({
            companyId,
            payrollRunId: run.id,
            employeeId: l.employeeId,
            conceptId: l.conceptId,
            conceptCode: l.conceptCode,
            conceptType: l.conceptType,
            amount: l.amount,
            basis: l.basis ?? null,
            hours: l.hours ?? null,
            rate: l.rate ?? null,
            salaryHistoryId: l.salaryHistoryId,
            salarySnapshotAmount: l.salarySnapshotAmount,
            salarySnapshotCurrency: l.salarySnapshotCurrency,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "PayrollRun",
          entityId: run.id,
          action: "CREATE_PAYROLL_RUN",
          userId,
          ipAddress: null,
          userAgent: null,
          oldValue: Prisma.JsonNull,
          newValue: {
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            employeeCount: empInputs.length,
            totalNet: result.totalNet.toString(),
          },
        },
      });

      return serializeRun(run);
    });
  },

  // ── approve — DRAFT → APPROVED + asiento de causación ────────────────────
  // NOM-C-03: updateMany mutex (status:'DRAFT') previene aprobación doble
  // NOM-C-11: AuditLog dentro del $transaction
  // ADR-013 Decisión 5: Read Committed suficiente (single-row state transition)
  // ADR-013 Decisión 4: asiento consolidado por run (no por empleado)
  async approve(
    companyId: string,
    userId: string,
    runId: string
  ): Promise<PayrollRunRow> {
    // ── Guard período contable (NOM-C-13) ─────────────────────────────────
    // Se verifica antes del $transaction para mensajes de error claros
    const run = await prisma.payrollRun.findFirst({
      where: { id: runId, companyId },
    });
    if (!run) throw new Error("Proceso de nómina no encontrado");
    if (run.status !== "DRAFT") {
      throw new Error(
        run.status === "APPROVED"
          ? "Este proceso ya fue aprobado"
          : "No se puede aprobar un proceso cancelado"
      );
    }

    const openPeriod = await prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        year: run.periodStart.getUTCFullYear(),
        month: run.periodStart.getUTCMonth() + 1,
        status: "OPEN",
      },
    });
    if (!openPeriod) {
      throw new Error("El período contable correspondiente está cerrado");
    }

    // ── Verificar cuentas contables configuradas ───────────────────────────
    const config = await prisma.payrollConfig.findUnique({
      where: { companyId },
      select: {
        expenseAccountId: true,
        payableAccountId: true,
        ivssPayableAccountId: true,
        faovPayableAccountId: true,
        incesPayableAccountId: true,
        rpePayableAccountId: true,
        loanReceivableAccountId: true,
        ivssEnabled: true,
        incesEnabled: true,
        banavihEnabled: true,
        rpeEnabled: true,
      },
    });
    if (!config) throw new Error("Configure la nómina antes de aprobar");
    if (!config.expenseAccountId || !config.payableAccountId) {
      throw new Error(
        "Configure las cuentas contables de nómina antes de aprobar (Gastos de Personal y Sueldos por Pagar)"
      );
    }

    return prisma.$transaction(async (tx) => {
      // ── Mutex atómico: solo actualiza si status === 'DRAFT' (NOM-C-03) ──
      const updated = await tx.payrollRun.updateMany({
        where: { id: runId, companyId, status: "DRAFT" },
        data: {
          status: "APPROVED",
          approvedByUserId: userId,
          approvedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        throw new Error("Este proceso ya fue aprobado o cancelado por otro usuario");
      }

      // ── Calcular montos por concepto para el asiento ───────────────────
      const lines = await tx.payrollRunLine.findMany({
        where: { payrollRunId: runId, companyId },
      });

      const ivssTotal = config.ivssEnabled
        ? lines
            .filter((l) => l.conceptCode === "IVSS_OBR" && l.conceptType === "DEDUCTION")
            .reduce((s, l) => s.plus(l.amount), new Decimal(0))
        : new Decimal(0);

      const incesTotal = config.incesEnabled
        ? lines
            .filter((l) => l.conceptCode === "INCES_OBR" && l.conceptType === "DEDUCTION")
            .reduce((s, l) => s.plus(l.amount), new Decimal(0))
        : new Decimal(0);

      const faovTotal = config.banavihEnabled
        ? lines
            .filter((l) => l.conceptCode === "FAOV_OBR" && l.conceptType === "DEDUCTION")
            .reduce((s, l) => s.plus(l.amount), new Decimal(0))
        : new Decimal(0);

      const rpeTotal = config.rpeEnabled
        ? lines
            .filter((l) => l.conceptCode === "RPE_OBR" && l.conceptType === "DEDUCTION")
            .reduce((s, l) => s.plus(l.amount), new Decimal(0))
        : new Decimal(0);

      // ── Asiento de causación (ADR-013 Decisión 4) ─────────────────────
      // Convención JournalEntry: amount positivo = Débito, negativo = Crédito
      // DÉBITO: Gastos de Personal (totalEarnings — solo componentes salariales, sin cuotas de préstamo)
      // CRÉDITO: Sueldos por Pagar (neto sin préstamos) + retenciones separadas + recuperación préstamos
      //
      // Invariante de cuadre: Σ entries = 0 independientemente de cuántas cuentas estén configuradas.
      // Las cuotas de préstamo (PRESTAMO_EMP) NO son un gasto de nómina — son recuperación de un activo
      // (Préstamos a Empleados). Por eso se excluyen de totalEarnings y se creditean contra la cuenta
      // del activo si está configurada, o se incluyen en "Sueldos por Pagar" si no lo está.
      const expenseAccountId = config.expenseAccountId!;
      const payableAccountId = config.payableAccountId!;
      const nomPeriod = `${run.periodStart.toISOString().split("T")[0]}/${run.periodEnd.toISOString().split("T")[0]}`;

      // Total de cuotas de préstamo descontadas en esta nómina
      const loanTotal = lines
        .filter((l) => l.conceptCode === "PRESTAMO_EMP" && l.conceptType === "DEDUCTION")
        .reduce((s, l) => s.plus(new Decimal(l.amount.toString())), new Decimal(0));

      // Gasto salarial real = bruto total − cuotas de préstamo (estas no son gasto, son recuperación de activo)
      const salaryExpense = new Decimal(run.totalEarnings.toString()).minus(loanTotal);

      // Deducciones que SÍ tienen cuenta separada configurada (retenciones)
      const configuredDeductions = [
        config.ivssPayableAccountId ? ivssTotal : new Decimal(0),
        config.faovPayableAccountId ? faovTotal : new Decimal(0),
        config.incesPayableAccountId ? incesTotal : new Decimal(0),
        config.rpePayableAccountId ? rpeTotal : new Decimal(0),
        // Loan recovery: solo si está configurada la cuenta del activo
        config.loanReceivableAccountId ? loanTotal : new Decimal(0),
      ].reduce((s, v) => s.plus(v), new Decimal(0));

      // Crédito consolidado a "Sueldos por Pagar" = gasto salarial − retenciones con cuenta propia
      const payableCredit = salaryExpense.minus(configuredDeductions).negated();

      const asiento = await tx.transaction.create({
        data: {
          companyId,
          number: `NOM-${run.periodStart.toISOString().split("T")[0]}-${runId.slice(-6)}`,
          date: new Date(),
          description: `Causación nómina ${run.periodStart.toISOString().split("T")[0]} — ${run.periodEnd.toISOString().split("T")[0]} (${run.employeeCount} empleados)`,
          reference: runId,
          userId,
          periodId: openPeriod.id,
          type: "DIARIO",
          entries: {
            create: [
              // DÉBITO — Gastos de Personal (solo componente salarial, sin cuotas de préstamo)
              { accountId: expenseAccountId, amount: salaryExpense, description: `Nómina ${nomPeriod} — salario bruto — ${run.employeeCount} empleados` },
              // CRÉDITO — Sueldos por Pagar (neto después de deducir lo que tiene cuenta propia)
              { accountId: payableAccountId, amount: payableCredit, description: `Nómina ${nomPeriod} — neto + retenciones sin cuenta separada` },
              // CRÉDITO — IVSS Obrero por Pagar (si aplica)
              ...(config.ivssPayableAccountId && ivssTotal.greaterThan(0)
                ? [{ accountId: config.ivssPayableAccountId, amount: ivssTotal.negated(), description: `Nómina ${nomPeriod} — retención IVSS obrero` }]
                : []),
              // CRÉDITO — FAOV / BANAVIH por Pagar (si aplica)
              ...(config.faovPayableAccountId && faovTotal.greaterThan(0)
                ? [{ accountId: config.faovPayableAccountId, amount: faovTotal.negated(), description: `Nómina ${nomPeriod} — retención FAOV obrero` }]
                : []),
              // CRÉDITO — INCES por Pagar (si aplica)
              ...(config.incesPayableAccountId && incesTotal.greaterThan(0)
                ? [{ accountId: config.incesPayableAccountId, amount: incesTotal.negated(), description: `Nómina ${nomPeriod} — retención INCES obrero` }]
                : []),
              // CRÉDITO — Paro Forzoso RPE por Pagar (si aplica)
              ...(config.rpePayableAccountId && rpeTotal.greaterThan(0)
                ? [{ accountId: config.rpePayableAccountId, amount: rpeTotal.negated(), description: `Nómina ${nomPeriod} — retención paro forzoso obrero` }]
                : []),
              // CRÉDITO — Préstamos a Empleados (recuperación del activo: cuota cobrada vía nómina)
              ...(config.loanReceivableAccountId && loanTotal.greaterThan(0)
                ? [{ accountId: config.loanReceivableAccountId, amount: loanTotal.negated(), description: `Nómina ${nomPeriod} — recuperación cuotas préstamos empleados` }]
                : []),
            ],
          },
        },
      });

      // ── Vincular asiento al run ────────────────────────────────────────
      const approvedRun = await tx.payrollRun.update({
        where: { id: runId },
        data: { transactionId: asiento.id },
      });

      // ── Actualizar saldos de préstamos (PRESTAMO_EMP) ─────────────────
      // Fetch PRESTAMO_EMP lines grouped by employeeId, apply oldest-loan-first.
      const loanLines = lines.filter((l) => l.conceptCode === "PRESTAMO_EMP" && l.conceptType === "DEDUCTION");
      if (loanLines.length > 0) {
        // Sum deducted per employee
        const deductedByEmployee = new Map<string, Decimal>();
        for (const l of loanLines) {
          const prev = deductedByEmployee.get(l.employeeId) ?? new Decimal(0);
          deductedByEmployee.set(l.employeeId, prev.plus(new Decimal(l.amount.toString())));
        }
        for (const [empId, deducted] of deductedByEmployee.entries()) {
          // Fetch ACTIVE loans for this employee, oldest first
          const empLoans = await tx.employeeLoan.findMany({
            where: { companyId, employeeId: empId, status: "ACTIVE" },
            orderBy: { createdAt: "asc" },
          });
          let remaining = deducted;
          for (const loan of empLoans) {
            if (remaining.isZero()) break;
            const balance = new Decimal(loan.remainingBalance.toString());
            const applied = Decimal.min(remaining, balance);
            const newBalance = balance.minus(applied);
            remaining = remaining.minus(applied);
            await tx.employeeLoan.update({
              where: { id: loan.id },
              data: {
                remainingBalance: newBalance.toFixed(2),
                paidInstallments: loan.paidInstallments + 1,
                status: newBalance.isZero() ? "PAID" : "ACTIVE",
              },
            });
          }
        }
      }

      // ── AuditLog (NOM-C-11) ────────────────────────────────────────────
      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "PayrollRun",
          entityId: runId,
          action: "APPROVE_PAYROLL_RUN",
          userId,
          ipAddress: null,
          userAgent: null,
          oldValue: { status: "DRAFT" },
          newValue: {
            status: "APPROVED",
            transactionId: asiento.id,
            approvedAt: new Date().toISOString(),
          },
        },
      });

      return serializeRun(approvedRun);
    });
  },

  // ── cancel — DRAFT → CANCELLED ────────────────────────────────────────────
  // NOM-C-04: solo DRAFT es cancelable directamente
  async cancel(
    companyId: string,
    userId: string,
    runId: string,
    reason: string
  ): Promise<PayrollRunRow> {
    return prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { id: runId, companyId },
      });
      if (!run) throw new Error("Proceso de nómina no encontrado");

      if (run.status === "APPROVED") {
        throw new Error(
          "No se puede cancelar un proceso aprobado. Un proceso aprobado genera asiento contable — contacte al administrador para reversarlo."
        );
      }
      if (run.status === "CANCELLED") {
        throw new Error("Este proceso ya está cancelado");
      }

      const cancelled = await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: "CANCELLED",
          cancelledByUserId: userId,
          cancelledAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "PayrollRun",
          entityId: runId,
          action: "CANCEL_PAYROLL_RUN",
          userId,
          ipAddress: null,
          userAgent: null,
          oldValue: { status: "DRAFT" },
          newValue: { status: "CANCELLED", reason, cancelledAt: new Date().toISOString() },
        },
      });

      return serializeRun(cancelled);
    });
  },
};
