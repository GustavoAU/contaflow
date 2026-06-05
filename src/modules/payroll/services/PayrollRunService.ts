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
import * as Sentry from "@sentry/nextjs";
import { sendEmail } from "@/lib/email";
import { signEmployeeToken } from "@/lib/employee-portal-jwt";
import type {
  PayrollRunStatus,
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
  // U-02: base imponible y tasa para mostrar "4% sobre 130,00 = 5,20"
  basis: string | null;
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
  totalEmployerCosts: string; // F-03: aportes patronales
  employeeCount: number;
  bcvRateAtRun: string | null; // C-05: tasa BCV activa del período
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
  totalEmployerCosts: Decimal;
  employeeCount: number;
  bcvRateAtRun: Decimal | null;
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
    totalEmployerCosts: r.totalEmployerCosts.toString(),
    employeeCount: r.employeeCount,
    bcvRateAtRun: r.bcvRateAtRun?.toString() ?? null,
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
        basis: l.basis?.toString() ?? null,
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
    input: CreatePayrollRunInput,
    ipAddress: string | null = null,
    userAgent: string | null = null
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

    // Topes y alícuotas legales: LegalThreshold vigente al inicio del período.
    // Las alícuotas tienen fallback a los defaults del calculador si no hay registro.
    const periodDate = new Date(input.periodStart);
    const [
      thresholdSalMin,
      ivssObrPct, ivssPatPct,
      incesObrPct, incesPatPct,
      faovObrPct, faovPatPct,
      rpeObrPct, rpePatPct,
    ] = await Promise.all([
      LegalThresholdService.getActive(companyId, "SALARY_MIN_VES",  periodDate),
      LegalThresholdService.getActive(companyId, "IVSS_OBR_RATE",  periodDate),
      LegalThresholdService.getActive(companyId, "IVSS_PAT_RATE",  periodDate),
      LegalThresholdService.getActive(companyId, "INCES_OBR_RATE", periodDate),
      LegalThresholdService.getActive(companyId, "INCES_PAT_RATE", periodDate),
      LegalThresholdService.getActive(companyId, "FAOV_OBR_RATE",  periodDate),
      LegalThresholdService.getActive(companyId, "FAOV_PAT_RATE",  periodDate),
      LegalThresholdService.getActive(companyId, "RPE_OBR_RATE",   periodDate),
      LegalThresholdService.getActive(companyId, "RPE_PAT_RATE",   periodDate),
    ]);

    const salaryMinimumVes =
      thresholdSalMin ??
      (config.salaryMinimumVes ? new Decimal(config.salaryMinimumVes.toString()) : new Decimal(0));

    // LegalThreshold almacena alícuotas como porcentaje (ej: 4.00 = 4%) → dividir /100
    const toRate = (pct: Decimal | null) => pct ? pct.dividedBy(100) : undefined;

    const calcConfig: PayrollCalculatorConfig = {
      frequency: config.frequency,
      ivssEnabled: config.ivssEnabled,
      incesEnabled: config.incesEnabled,
      banavihEnabled: config.banavihEnabled,
      rpeEnabled: config.rpeEnabled,
      salaryMinimumVes,
      systemConcepts: systemConcepts.map((c) => ({ code: c.code, conceptId: c.id })),
      ivssObrRate:  toRate(ivssObrPct),
      ivssPatRate:  toRate(ivssPatPct),
      incesObrRate: toRate(incesObrPct),
      incesPatRate: toRate(incesPatPct),
      faovObrRate:  toRate(faovObrPct),
      faovPatRate:  toRate(faovPatPct),
      rpeObrRate:   toRate(rpeObrPct),
      rpePatRate:   toRate(rpePatPct),
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

    // C-05: lookup tasa BCV activa del período para snapshot de auditoría
    const bcvRate = await prisma.bcvBenefitRate.findFirst({
      where: {
        companyId,
        year: periodStart.getUTCFullYear(),
        month: periodStart.getUTCMonth() + 1,
      },
      orderBy: { createdAt: "desc" },
      select: { annualRate: true },
    });

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
          totalEmployerCosts: result.totalEmployerCosts,
          employeeCount: empInputs.length,
          bcvRateAtRun: bcvRate ? new Decimal(bcvRate.annualRate.toString()) : null,
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
          ipAddress,
          userAgent,
          oldValue: Prisma.JsonNull,
          newValue: {
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            employeeCount: empInputs.length,
            totalEarnings: result.totalEarnings.toString(),
            totalDeductions: result.totalDeductions.toString(),
            totalNet: result.totalNet.toString(),
            // VI: conceptos manuales para trazabilidad de fiscalización
            manualConcepts: (input.manualConcepts ?? []).map((m) => ({
              conceptId: m.conceptId,
              employeeId: m.employeeId,
              amount: m.amount,
            })),
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
    runId: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
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
        // F-02/F-03: cuentas aportes patronales
        ivssPatronalAccountId: true,
        incesPatronalAccountId: true,
        faovPatronalAccountId: true,
        rpePatronalAccountId: true,
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

    const result = await Sentry.startSpan(
      {
        name: "payroll_run.approve",
        op: "db.transaction",
        attributes: {
          "contaflow.company_id": companyId,
          "contaflow.payroll_run_id": runId,
        },
      },
      () => prisma.$transaction(async (tx) => {
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

      // F-03: Aportes patronales (EMPLOYER_COST — no afectan neto del empleado)
      const ivssPatTotal = config.ivssEnabled
        ? lines
            .filter((l) => l.conceptCode === "IVSS_PAT" && l.conceptType === "EMPLOYER_COST")
            .reduce((s, l) => s.plus(new Decimal(l.amount.toString())), new Decimal(0))
        : new Decimal(0);
      const incesPatTotal = config.incesEnabled
        ? lines
            .filter((l) => l.conceptCode === "INCES_PAT" && l.conceptType === "EMPLOYER_COST")
            .reduce((s, l) => s.plus(new Decimal(l.amount.toString())), new Decimal(0))
        : new Decimal(0);
      const faovPatTotal = config.banavihEnabled
        ? lines
            .filter((l) => l.conceptCode === "FAOV_PAT" && l.conceptType === "EMPLOYER_COST")
            .reduce((s, l) => s.plus(new Decimal(l.amount.toString())), new Decimal(0))
        : new Decimal(0);
      const rpePatTotal = config.rpeEnabled
        ? lines
            .filter((l) => l.conceptCode === "RPE_PAT" && l.conceptType === "EMPLOYER_COST")
            .reduce((s, l) => s.plus(new Decimal(l.amount.toString())), new Decimal(0))
        : new Decimal(0);
      const totalPatronal = ivssPatTotal.plus(incesPatTotal).plus(faovPatTotal).plus(rpePatTotal);

      // V-1: debit patronal = SOLO los organismos con cuenta GL configurada — garantiza cuadre del asiento.
      // Si ivssPatronalAccountId=null pero incesPatronalAccountId≠null, el debit debe ser solo INCES.
      const configuredPatronal = [
        config.ivssPatronalAccountId ? ivssPatTotal : new Decimal(0),
        config.incesPatronalAccountId ? incesPatTotal : new Decimal(0),
        config.faovPatronalAccountId ? faovPatTotal : new Decimal(0),
        config.rpePatronalAccountId ? rpePatTotal : new Decimal(0),
      ].reduce((s, v) => s.plus(v), new Decimal(0));

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

      // V-2: si la nómina fue procesada en USD, convertir a VES antes de generar el asiento
      const firstLine = lines[0];
      const payCurrency = firstLine?.salarySnapshotCurrency ?? "VES";
      let glMultiplier = new Decimal(1);
      let fxNote = "";

      if (payCurrency === "USD") {
        const fxRow = await tx.exchangeRate.findFirst({
          where: { companyId, currency: "USD", date: { lte: run.periodEnd } },
          orderBy: { date: "desc" },
          select: { rate: true },
        });
        if (!fxRow) {
          throw new Error(
            "Nómina en USD: registra la tasa BCV USD/VES en Contabilidad → Tasas de Cambio antes de aprobar esta nómina."
          );
        }
        glMultiplier = new Decimal(fxRow.rate.toString());
        fxNote = ` (USD → Bs. ${glMultiplier.toFixed(2)}/USD)`;
      }

      // Montos GL en VES (glMultiplier=1 para nóminas VES — no cambia valores)
      const glSalaryExpense     = salaryExpense.mul(glMultiplier);
      const glPayableCredit     = payableCredit.mul(glMultiplier);
      const glIvssTotal         = ivssTotal.mul(glMultiplier);
      const glFaovTotal         = faovTotal.mul(glMultiplier);
      const glIncesTotal        = incesTotal.mul(glMultiplier);
      const glRpeTotal          = rpeTotal.mul(glMultiplier);
      const glLoanTotal         = loanTotal.mul(glMultiplier);
      const glConfiguredPatronal = configuredPatronal.mul(glMultiplier);
      const glIvssPatTotal      = ivssPatTotal.mul(glMultiplier);
      const glIncesPatTotal     = incesPatTotal.mul(glMultiplier);
      const glFaovPatTotal      = faovPatTotal.mul(glMultiplier);
      const glRpePatTotal       = rpePatTotal.mul(glMultiplier);

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
              { accountId: expenseAccountId, amount: glSalaryExpense, description: `Nómina ${nomPeriod} — salario bruto — ${run.employeeCount} empleados${fxNote}` },
              // CRÉDITO — Sueldos por Pagar (neto después de deducir lo que tiene cuenta propia)
              { accountId: payableAccountId, amount: glPayableCredit, description: `Nómina ${nomPeriod} — neto + retenciones sin cuenta separada${fxNote}` },
              // CRÉDITO — IVSS Obrero por Pagar (si aplica)
              ...(config.ivssPayableAccountId && glIvssTotal.greaterThan(0)
                ? [{ accountId: config.ivssPayableAccountId, amount: glIvssTotal.negated(), description: `Nómina ${nomPeriod} — retención IVSS obrero${fxNote}` }]
                : []),
              // CRÉDITO — FAOV / BANAVIH por Pagar (si aplica)
              ...(config.faovPayableAccountId && glFaovTotal.greaterThan(0)
                ? [{ accountId: config.faovPayableAccountId, amount: glFaovTotal.negated(), description: `Nómina ${nomPeriod} — retención FAOV obrero${fxNote}` }]
                : []),
              // CRÉDITO — INCES por Pagar (si aplica)
              ...(config.incesPayableAccountId && glIncesTotal.greaterThan(0)
                ? [{ accountId: config.incesPayableAccountId, amount: glIncesTotal.negated(), description: `Nómina ${nomPeriod} — retención INCES obrero${fxNote}` }]
                : []),
              // CRÉDITO — Paro Forzoso RPE por Pagar (si aplica)
              ...(config.rpePayableAccountId && glRpeTotal.greaterThan(0)
                ? [{ accountId: config.rpePayableAccountId, amount: glRpeTotal.negated(), description: `Nómina ${nomPeriod} — retención paro forzoso obrero${fxNote}` }]
                : []),
              // CRÉDITO — Préstamos a Empleados (recuperación del activo: cuota cobrada vía nómina)
              ...(config.loanReceivableAccountId && glLoanTotal.greaterThan(0)
                ? [{ accountId: config.loanReceivableAccountId, amount: glLoanTotal.negated(), description: `Nómina ${nomPeriod} — recuperación cuotas préstamos empleados${fxNote}` }]
                : []),
              // V-1 + F-03: Aportes patronales — Dr Gastos de Personal / Cr CxP organismos
              // Debit = SOLO organismos con cuenta configurada (configuredPatronal) — garantiza cuadre.
              ...(glConfiguredPatronal.greaterThan(0)
                ? [{ accountId: expenseAccountId, amount: glConfiguredPatronal, description: `Nómina ${nomPeriod} — aportes patronales IVSS/INCES/FAOV/RPE${fxNote}` }]
                : []),
              ...(config.ivssPatronalAccountId && glIvssPatTotal.greaterThan(0)
                ? [{ accountId: config.ivssPatronalAccountId, amount: glIvssPatTotal.negated(), description: `Nómina ${nomPeriod} — IVSS patronal 9%${fxNote}` }]
                : []),
              ...(config.incesPatronalAccountId && glIncesPatTotal.greaterThan(0)
                ? [{ accountId: config.incesPatronalAccountId, amount: glIncesPatTotal.negated(), description: `Nómina ${nomPeriod} — INCES patronal 2%${fxNote}` }]
                : []),
              ...(config.faovPatronalAccountId && glFaovPatTotal.greaterThan(0)
                ? [{ accountId: config.faovPatronalAccountId, amount: glFaovPatTotal.negated(), description: `Nómina ${nomPeriod} — FAOV patronal 2%${fxNote}` }]
                : []),
              ...(config.rpePatronalAccountId && glRpePatTotal.greaterThan(0)
                ? [{ accountId: config.rpePatronalAccountId, amount: glRpePatTotal.negated(), description: `Nómina ${nomPeriod} — RPE patronal 2%${fxNote}` }]
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
          ipAddress,
          userAgent,
          oldValue: { status: "DRAFT" },
          newValue: {
            status: "APPROVED",
            transactionId: asiento.id,
            approvedAt: new Date().toISOString(),
            approvedByUserId: userId,
            employeeCount: approvedRun.employeeCount,
            totalEarnings: approvedRun.totalEarnings.toString(),
            totalDeductions: approvedRun.totalDeductions.toString(),
            totalNet: approvedRun.totalNet.toString(),
            bcvRateAtRun: approvedRun.bcvRateAtRun?.toString() ?? null,
            // V-2: tasa de cambio usada para GL si la nómina fue en USD
            ...(payCurrency !== "VES" && { fxRateAtApproval: glMultiplier.toString(), payCurrency }),
          },
        },
      });

      return serializeRun(approvedRun);
    }));

    // Feature 7: enviar recibos por email a empleados (fire-and-forget post-commit)
    // Degradación graceful: si email no configurado o empleado sin email, no lanza error.
    void this._sendPayslipEmails(companyId, runId).catch((err) => {
      console.warn("[PayrollRunService] Error al enviar recibos por email:", err);
    });

    return result;
  },

  async _sendPayslipEmails(companyId: string, runId: string): Promise<void> {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    if (!appUrl) return; // no configurado — silencioso

    const employees = await prisma.payrollRunLine.findMany({
      where: { payrollRunId: runId, companyId },
      select: {
        employee: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      distinct: ["employeeId"],
    });

    const periodLabel = runId; // usamos el runId como ref en el subject; overwritten below
    const run = await prisma.payrollRun.findFirst({
      where: { id: runId, companyId },
      select: { periodStart: true, periodEnd: true },
    });
    const period = run
      ? `${run.periodStart.toISOString().slice(0, 10)} — ${run.periodEnd.toISOString().slice(0, 10)}`
      : periodLabel;

    const seen = new Set<string>();
    for (const line of employees) {
      const emp = line.employee;
      if (!emp?.email || seen.has(emp.id)) continue;
      seen.add(emp.id);

      const token = signEmployeeToken(emp.id, companyId);
      const portalUrl = `${appUrl}/employee/${token}`;

      await sendEmail({
        to: emp.email,
        subject: `Tu recibo de nómina — ${period}`,
        html: `
          <p>Hola ${emp.firstName},</p>
          <p>Tu proceso de nómina del período <strong>${period}</strong> ha sido aprobado.</p>
          <p>Puedes consultar tu recibo de pago en el siguiente enlace (válido 30 días):</p>
          <p><a href="${portalUrl}" style="color:#2563eb">Ver mi recibo</a></p>
          <p style="color:#6b7280;font-size:12px">ContaFlow — Sistema de Gestión Contable</p>
        `.trim(),
      });
    }
  },

  // ── cancel — DRAFT → CANCELLED ────────────────────────────────────────────
  // NOM-C-04: solo DRAFT es cancelable directamente
  async cancel(
    companyId: string,
    userId: string,
    runId: string,
    reason: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
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
          ipAddress,
          userAgent,
          oldValue: { status: "DRAFT" },
          newValue: { status: "CANCELLED", reason, cancelledAt: new Date().toISOString() },
        },
      });

      return serializeRun(cancelled);
    });
  },
};
