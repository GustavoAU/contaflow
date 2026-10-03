// src/modules/fiscal-close/services/FiscalYearCloseService.ts
import prisma from "@/lib/prisma";
import { withCompanyContext } from "@/lib/prisma-rls";
import { withSerializableRetry } from "@/lib/tx-helpers";
import { PeriodSnapshotService } from "@/modules/accounting/services/PeriodSnapshotService";
import { FiscalYearService } from "@/modules/accounting/services/FiscalYearService";
import { Decimal } from "decimal.js";
import { assertBalancedGLEntries } from "@/lib/gl-assertions";
import type { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";

export type FiscalYearCloseResult = {
  fiscalYearCloseId: string;
  closingTransactionId: string;
  totalRevenue: Decimal;
  totalExpenses: Decimal;
  netResult: Decimal;
  closingEntriesCount: number;
};

export type FiscalYearCloseSummary = {
  id: string;
  year: number;
  closedAt: Date;
  closedBy: string;
  totalRevenue: Decimal;
  totalExpenses: Decimal;
  netResult: Decimal;
  hasAppropriation: boolean;
};

export class FiscalYearCloseService {
  /**
   * Verifica si un ejercicio económico está cerrado para una empresa.
   * Guard rápido para createTransaction, createInvoice, createRetencion.
   */
  static async isFiscalYearClosed(companyId: string, year: number): Promise<boolean> {
    const record = await prisma.fiscalYearClose.findUnique({
      where: { companyId_year: { companyId, year } },
      select: { id: true },
    });
    return record !== null;
  }

  /**
   * Ejecuta el cierre de ejercicio económico (ADR-055).
   *
   * Precondiciones (verificadas dentro de la tx Serializable):
   * - No existe FiscalYearClose para (companyId, year)
   * - Existe un FiscalYear{companyId, year} con status OPEN (ábrelo con
   *   FiscalYearService.openFiscalYear si no existe)
   * - company.resultAccountId está configurado y es AccountType.EQUITY
   *
   * Cierra los 12 AccountingPeriod del ejercicio + genera sus PeriodSnapshot +
   * genera un Transaction type:CIERRE que salda las cuentas REVENUE y EXPENSE
   * contra la cuenta "Resultado del Ejercicio" — todo en la misma transacción.
   * Ya NO es precondición externa cerrar los meses uno a uno antes (D-B).
   */
  static async closeFiscalYear(
    companyId: string,
    year: number,
    closedBy: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<FiscalYearCloseResult> {
    return await Sentry.startSpan(
      {
        name: "fiscal_year.close",
        op: "function.critical",
        attributes: {
          "contaflow.company_id": companyId,
          "contaflow.fiscal_year": year,
        },
      },
      () =>
        withSerializableRetry(
          async (tx) =>
            withCompanyContext(companyId, tx, async (tx) => {
              // ── 1. Idempotencia: no permitir doble cierre ─────────────────────────
              const existing = await tx.fiscalYearClose.findUnique({
                where: { companyId_year: { companyId, year } },
                select: { id: true },
              });
              if (existing) {
                throw new Error(`El ejercicio económico ${year} ya está cerrado.`);
              }

              // ── 2. ADR-055: resolver el FiscalYear y cerrar sus 12 períodos AQUÍ MISMO
              // (ya no es precondición externa cerrarlos uno a uno antes — D-B).
              const fiscalYear = await tx.fiscalYear.findUnique({
                where: { companyId_year: { companyId, year } },
              });

              if (!fiscalYear) {
                throw new Error(
                  `No existe un ejercicio fiscal ${year} para esta empresa. Ábrelo primero en Contabilidad → Ejercicios.`
                );
              }
              if (fiscalYear.status === "CLOSED") {
                throw new Error(`El ejercicio fiscal ${year} ya está cerrado.`);
              }

              const periods = await tx.accountingPeriod.findMany({
                where: { companyId, fiscalYearId: fiscalYear.id },
                select: { id: true, year: true, month: true, status: true },
              });

              if (periods.length === 0) {
                throw new Error(
                  `El ejercicio fiscal ${year} no tiene períodos contables asociados — dato inconsistente, contacta soporte.`
                );
              }

              // ── 3. Cargar configuración de cuentas de cierre ──────────────────────
              const company = await tx.company.findUnique({
                where: { id: companyId },
                select: {
                  resultAccountId: true,
                  retainedEarningsAccountId: true,
                  resultAccount: { select: { id: true, type: true, name: true } },
                },
              });

              if (!company?.resultAccountId || !company.resultAccount) {
                throw new Error(
                  "Cuentas de cierre no configuradas. Ve a Configuración → Configuración Contable y define la cuenta Resultado del Ejercicio."
                );
              }

              if (company.resultAccount.type !== "EQUITY") {
                throw new Error(
                  `La cuenta "${company.resultAccount.name}" no es de tipo Patrimonio (EQUITY). Solo se permiten cuentas EQUITY para el cierre.`
                );
              }

              // ── 4. Calcular saldos netos de REVENUE y EXPENSE para el año ─────────
              // Obtener todos los JournalEntries de transacciones POSTED del año
              const periodIds = periods.map((p) => p.id);

              const revenueEntries = await tx.journalEntry.findMany({
                where: {
                  transaction: {
                    companyId,
                    periodId: { in: periodIds },
                    status: "POSTED",
                  },
                  account: { type: "REVENUE", companyId },
                },
                select: {
                  amount: true,
                  accountId: true,
                  account: { select: { id: true, name: true, code: true } },
                },
              });

              const expenseEntries = await tx.journalEntry.findMany({
                where: {
                  transaction: {
                    companyId,
                    periodId: { in: periodIds },
                    status: "POSTED",
                  },
                  account: { type: "EXPENSE", companyId },
                },
                select: {
                  amount: true,
                  accountId: true,
                  account: { select: { id: true, name: true, code: true } },
                },
              });

              // Sumar saldos por cuenta (positivo = Débito, negativo = Crédito)
              const revenueByAccount = FiscalYearCloseService._sumByAccount(revenueEntries);
              const expenseByAccount = FiscalYearCloseService._sumByAccount(expenseEntries);

              // Total REVENUE: suma de saldos crédito (negativos en nuestro sistema → invertir signo)
              const totalRevenue = Object.values(revenueByAccount).reduce(
                (acc, { balance }) => acc.plus(balance.negated()),
                new Decimal(0)
              );

              // Total EXPENSE: suma de saldos débito (positivos en nuestro sistema)
              const totalExpenses = Object.values(expenseByAccount).reduce(
                (acc, { balance }) => acc.plus(balance),
                new Decimal(0)
              );

              const netResult = totalRevenue.minus(totalExpenses); // positivo = ganancia

              if (totalRevenue.isZero() && totalExpenses.isZero()) {
                throw new Error(
                  `No hay movimientos en cuentas de resultado para el ejercicio ${year}.`
                );
              }

              // ── 5. Generar número correlativo para el asiento de cierre ───────────
              // Fix H-2 (ADR-055): antes asumía diciembre/año-calendario de forma dura.
              // Ahora se calcula por índice cronológico dentro del ejercicio — en régimen
              // regular (startMonth=1) produce exactamente el mismo resultado de siempre
              // (diciembre), byte a byte; en régimen irregular usa el último mes real.
              const lastPeriod = [...periods].sort(
                (a, b) =>
                  FiscalYearService.chronologicalKey(fiscalYear.year, fiscalYear.startMonth, b) -
                  FiscalYearService.chronologicalKey(fiscalYear.year, fiscalYear.startMonth, a)
              )[0];
              const closingDate = new Date(lastPeriod.year, lastPeriod.month, 0); // último día de ese mes
              const prefix = `${lastPeriod.year}-${String(lastPeriod.month).padStart(2, "0")}-`;
              const lastTx = await tx.transaction.findFirst({
                where: { companyId, number: { startsWith: prefix } },
                orderBy: { number: "desc" },
                select: { number: true },
              });
              let seq = 1;
              if (lastTx) {
                seq = parseInt(lastTx.number.replace(prefix, ""), 10) + 1;
              }
              const closingNumber = `${prefix}${String(seq).padStart(6, "0")}`;

              // ── 6. Construir asientos del Transaction de cierre ───────────────────
              // Débito a cuentas REVENUE (saldo era crédito → lo cerramos con débito = montos positivos)
              // Crédito a cuentas EXPENSE (saldo era débito → lo cerramos con crédito = montos negativos)
              // El neto va a la cuenta Resultado del Ejercicio
              const closingEntries: Prisma.JournalEntryCreateManyTransactionInput[] = [];

              for (const { accountId, account, balance } of Object.values(revenueByAccount)) {
                if (!balance.isZero()) {
                  // Débito la cuenta de ingreso por su saldo crédito (invertido)
                  closingEntries.push({
                    accountId,
                    amount: balance.negated().toDecimalPlaces(4),
                    description: `Cierre año ${year} — ${account.name}`,
                  });
                }
              }

              for (const { accountId, account, balance } of Object.values(expenseByAccount)) {
                if (!balance.isZero()) {
                  // Crédito la cuenta de gasto por su saldo débito (invertido)
                  closingEntries.push({
                    accountId,
                    amount: balance.negated().toDecimalPlaces(4),
                    description: `Cierre año ${year} — ${account.name}`,
                  });
                }
              }

              // Contrapartida en Resultado del Ejercicio
              // Si ganancia: Crédito (negativo). Si pérdida: Débito (positivo).
              const resultEntry: Prisma.JournalEntryCreateManyTransactionInput = {
                accountId: company.resultAccountId,
                amount: netResult.negated().toDecimalPlaces(4), // ganancia = crédito (negativo)
                description: `Resultado del ejercicio ${year}`,
              };
              closingEntries.push(resultEntry);

              // ── 7. Persistir el asiento de cierre ─────────────────────────────────
              // N4: invariante partida doble (amount tipado por Prisma → normalizar a Decimal)
              assertBalancedGLEntries(
                closingEntries.map((e) => ({ amount: new Decimal(e.amount.toString()) }))
              );
              const closingTx = await tx.transaction.create({
                data: {
                  number: closingNumber,
                  companyId,
                  userId: closedBy,
                  description: `Cierre de cuentas de resultado — Ejercicio ${year}`,
                  date: closingDate,
                  type: "CIERRE",
                  status: "POSTED",
                  periodId: lastPeriod.id,
                  entries: { createMany: { data: closingEntries } },
                },
                select: { id: true },
              });

              // ── 8. ADR-055 D-B: cerrar los 12 períodos del ejercicio + generar sus
              // snapshots de saldo, en la misma transacción Serializable (ya no es un
              // paso previo separado hecho mes a mes).
              const closeTimestamp = new Date();
              await tx.accountingPeriod.updateMany({
                where: { companyId, fiscalYearId: fiscalYear.id },
                data: { status: "CLOSED", closedAt: closeTimestamp, closedBy },
              });
              for (const period of periods) {
                await PeriodSnapshotService.upsertAllSnapshotsForPeriod(companyId, period.id, tx);
              }
              await tx.fiscalYear.update({
                where: { id: fiscalYear.id },
                data: { status: "CLOSED", closedAt: closeTimestamp, closedBy },
              });

              // ── 9. Insertar FiscalYearClose ───────────────────────────────────────
              const fiscalClose = await tx.fiscalYearClose.create({
                data: {
                  companyId,
                  year,
                  fiscalYearId: fiscalYear.id,
                  closedBy,
                  closingTransactionId: closingTx.id,
                  totalRevenue: totalRevenue.toDecimalPlaces(4),
                  totalExpenses: totalExpenses.toDecimalPlaces(4),
                  netResult: netResult.toDecimalPlaces(4),
                },
                select: { id: true },
              });

              // ── 10. AuditLog ──────────────────────────────────────────────────────
              await tx.auditLog.create({
                data: {
                  companyId,
                  entityId: fiscalClose.id,
                  entityName: "FiscalYearClose",
                  action: "CLOSE",
                  userId: closedBy,
                  ipAddress,
                  userAgent,
                  newValue: {
                    fiscalYearCloseId: fiscalClose.id,
                    companyId,
                    year,
                    periodsClosedCount: periods.length,
                    totalRevenue: totalRevenue.toString(),
                    totalExpenses: totalExpenses.toString(),
                    netResult: netResult.toString(),
                    closingTransactionId: closingTx.id,
                  },
                },
              });

              return {
                fiscalYearCloseId: fiscalClose.id,
                closingTransactionId: closingTx.id,
                totalRevenue,
                totalExpenses,
                netResult,
                closingEntriesCount: closingEntries.length,
              };
            })
          // ADR-055 (MEDIUM security-agent): antes usaba prisma.$transaction(fn,
          // SERIALIZABLE_TX_OPTIONS) directo, sin reintento — un cierre real bajo
          // contención (un asiento posteado el instante antes del commit) salía con un
          // P2034 crudo en vez de reintentar. withSerializableRetry aplica
          // SERIALIZABLE_TX_OPTIONS internamente (mismo timeout/maxWait ampliados para
          // cubrir cold start Neon + cerrar hasta 12 períodos y generar sus snapshots).
        )
    );
  }

  /**
   * Genera el asiento de apropiación del resultado del ejercicio a patrimonio.
   * Diferible post-AGO (Asamblea General Ordinaria).
   */
  static async appropriateFiscalYearResult(
    companyId: string,
    year: number,
    approvedBy: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<{ appropriationTransactionId: string }> {
    return await Sentry.startSpan(
      {
        name: "fiscal_year.appropriate",
        op: "function.critical",
        attributes: {
          "contaflow.company_id": companyId,
          "contaflow.fiscal_year": year,
        },
      },
      () =>
        withSerializableRetry(
          async (tx) =>
            withCompanyContext(companyId, tx, async (tx) => {
              // ── 1. Cargar el cierre del ejercicio ──────────────────────────────────
              const fiscalClose = await tx.fiscalYearClose.findUnique({
                where: { companyId_year: { companyId, year } },
              });

              if (!fiscalClose) {
                throw new Error(
                  `El ejercicio ${year} no ha sido cerrado. Ejecuta el cierre de ejercicio primero.`
                );
              }

              if (fiscalClose.appropriationTransactionId) {
                throw new Error(`El ejercicio ${year} ya tiene asiento de apropiación registrado.`);
              }

              // ── 2. Cargar cuentas de cierre ────────────────────────────────────────
              const company = await tx.company.findUnique({
                where: { id: companyId },
                select: {
                  resultAccountId: true,
                  retainedEarningsAccountId: true,
                  retainedEarningsAccount: { select: { id: true, type: true, name: true } },
                },
              });

              if (!company?.resultAccountId || !company.retainedEarningsAccountId) {
                throw new Error(
                  "Cuenta de Utilidades Retenidas no configurada. Ve a Configuración → Configuración Contable."
                );
              }

              if (company.retainedEarningsAccount?.type !== "EQUITY") {
                throw new Error(
                  `La cuenta "${company.retainedEarningsAccount?.name}" no es de tipo Patrimonio (EQUITY).`
                );
              }

              const netResult = new Decimal(fiscalClose.netResult.toString());

              // ── 3. Generar número correlativo ──────────────────────────────────────
              // Fix H-2 (mismo hallazgo que closeFiscalYear, no cubierto ahí): antes
              // asumía diciembre/año-calendario de forma dura — no válido para régimen
              // irregular (Company.fiscalYearStartMonth != 1). Reutiliza la fecha real
              // del asiento de cierre en vez de recalcularla.
              const closingTransaction = await tx.transaction.findUnique({
                where: { id: fiscalClose.closingTransactionId },
                select: { date: true },
              });
              if (!closingTransaction) {
                throw new Error(
                  `No se encontró el asiento de cierre del ejercicio ${year}. Datos inconsistentes.`
                );
              }
              const appDate = closingTransaction.date;
              const prefix = `${appDate.getFullYear()}-${String(appDate.getMonth() + 1).padStart(2, "0")}-`;
              const lastTx = await tx.transaction.findFirst({
                where: { companyId, number: { startsWith: prefix } },
                orderBy: { number: "desc" },
                select: { number: true },
              });
              let seq = 1;
              if (lastTx) {
                seq = parseInt(lastTx.number.replace(prefix, ""), 10) + 1;
              }
              const appNumber = `${prefix}${String(seq).padStart(6, "0")}`;

              // ── 4. Asiento de apropiación ──────────────────────────────────────────
              // Débito: Resultado del Ejercicio (cierra la cuenta resultado)
              // Crédito: Utilidades Retenidas (si ganancia) o Pérdidas Acumuladas (si pérdida)
              // En nuestro sistema: Débito = positivo, Crédito = negativo
              const appEntries: Prisma.JournalEntryCreateManyTransactionInput[] = [
                {
                  accountId: company.resultAccountId,
                  amount: netResult.toDecimalPlaces(4), // débito si ganancia, crédito si pérdida
                  description: `Apropiación resultado — año ${year}`,
                },
                {
                  accountId: company.retainedEarningsAccountId,
                  amount: netResult.negated().toDecimalPlaces(4), // contrapartida
                  description: `Traslado a utilidades retenidas — año ${year}`,
                },
              ];

              // N4: invariante partida doble (amount tipado por Prisma → normalizar a Decimal)
              assertBalancedGLEntries(
                appEntries.map((e) => ({ amount: new Decimal(e.amount.toString()) }))
              );
              const appTx = await tx.transaction.create({
                data: {
                  number: appNumber,
                  companyId,
                  userId: approvedBy,
                  description: `Apropiación del resultado del ejercicio ${year}`,
                  date: appDate,
                  type: "CIERRE",
                  status: "POSTED",
                  entries: { createMany: { data: appEntries } },
                },
                select: { id: true },
              });

              // ── 5. Actualizar FiscalYearClose ──────────────────────────────────────
              await tx.fiscalYearClose.update({
                where: { id: fiscalClose.id },
                data: { appropriationTransactionId: appTx.id },
              });

              // ── 6. AuditLog ───────────────────────────────────────────────────────
              await tx.auditLog.create({
                data: {
                  companyId,
                  entityId: fiscalClose.id,
                  entityName: "FiscalYearClose",
                  action: "APPROPRIATE",
                  userId: approvedBy,
                  ipAddress,
                  userAgent,
                  oldValue: { appropriationTransactionId: null },
                  newValue: { appropriationTransactionId: appTx.id },
                },
              });

              return { appropriationTransactionId: appTx.id };
            })
          // ADR-055 (MEDIUM security-agent): antes usaba { isolationLevel: "Serializable" }
          // directo, sin reintento P2034 ni el timeout/maxWait ampliados.
        )
    );
  }

  /**
   * Retorna el historial de cierres de ejercicio de una empresa.
   */
  static async getFiscalYearCloseHistory(companyId: string): Promise<FiscalYearCloseSummary[]> {
    const records = await prisma.fiscalYearClose.findMany({
      where: { companyId },
      orderBy: { year: "desc" },
      select: {
        id: true,
        year: true,
        closedAt: true,
        closedBy: true,
        totalRevenue: true,
        totalExpenses: true,
        netResult: true,
        appropriationTransactionId: true,
      },
    });

    return records.map((r) => ({
      id: r.id,
      year: r.year,
      closedAt: r.closedAt,
      closedBy: r.closedBy,
      totalRevenue: new Decimal(r.totalRevenue.toString()),
      totalExpenses: new Decimal(r.totalExpenses.toString()),
      netResult: new Decimal(r.netResult.toString()),
      hasAppropriation: r.appropriationTransactionId !== null,
    }));
  }

  // ─── helpers ────────────────────────────────────────────────────────────────

  private static _sumByAccount(
    entries: {
      amount: Prisma.Decimal;
      accountId: string;
      account: { id: string; name: string; code: string };
    }[]
  ): Record<
    string,
    { accountId: string; account: { id: string; name: string; code: string }; balance: Decimal }
  > {
    const map: Record<
      string,
      { accountId: string; account: { id: string; name: string; code: string }; balance: Decimal }
    > = {};
    for (const e of entries) {
      if (!map[e.accountId]) {
        map[e.accountId] = { accountId: e.accountId, account: e.account, balance: new Decimal(0) };
      }
      map[e.accountId].balance = map[e.accountId].balance.plus(e.amount.toString());
    }
    return map;
  }
}
