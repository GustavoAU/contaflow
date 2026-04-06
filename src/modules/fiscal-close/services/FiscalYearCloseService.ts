// src/modules/fiscal-close/services/FiscalYearCloseService.ts
import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import type { Prisma } from "@prisma/client";

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
   * Ejecuta el cierre de ejercicio económico.
   *
   * Precondiciones (verificadas dentro de la tx Serializable):
   * - No existe FiscalYearClose para (companyId, year)
   * - Todos los períodos existentes del año tienen status CLOSED
   * - company.resultAccountId está configurado y es AccountType.EQUITY
   *
   * Genera un Transaction type:CIERRE que salda las cuentas REVENUE y EXPENSE
   * contra la cuenta "Resultado del Ejercicio".
   */
  static async closeFiscalYear(
    companyId: string,
    year: number,
    closedBy: string
  ): Promise<FiscalYearCloseResult> {
    return await prisma.$transaction(
      async (tx) => {
        // ── 1. Idempotencia: no permitir doble cierre ─────────────────────────
        const existing = await tx.fiscalYearClose.findUnique({
          where: { companyId_year: { companyId, year } },
          select: { id: true },
        });
        if (existing) {
          throw new Error(`El ejercicio económico ${year} ya está cerrado.`);
        }

        // ── 2. Verificar que todos los períodos existentes del año están CLOSED ─
        const periods = await tx.accountingPeriod.findMany({
          where: { companyId, year },
          select: { id: true, month: true, status: true },
        });

        if (periods.length === 0) {
          throw new Error(
            `No existen períodos contables registrados para el año ${year}.`
          );
        }

        const openPeriods = periods.filter((p) => p.status === "OPEN");
        if (openPeriods.length > 0) {
          const months = openPeriods.map((p) => p.month).join(", ");
          throw new Error(
            `Existen períodos abiertos en el ejercicio ${year}: meses ${months}. Ciérralos antes de continuar.`
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
          select: { amount: true, accountId: true, account: { select: { id: true, name: true, code: true } } },
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
          select: { amount: true, accountId: true, account: { select: { id: true, name: true, code: true } } },
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
        const closingDate = new Date(year, 11, 31); // 31 de diciembre del año
        const prefix = `${year}-12-`;
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

        for (const { accountId, balance } of Object.values(revenueByAccount)) {
          if (!balance.isZero()) {
            // Débito la cuenta de ingreso por su saldo crédito (invertido)
            closingEntries.push({ accountId, amount: balance.negated().toDecimalPlaces(4) });
          }
        }

        for (const { accountId, balance } of Object.values(expenseByAccount)) {
          if (!balance.isZero()) {
            // Crédito la cuenta de gasto por su saldo débito (invertido)
            closingEntries.push({ accountId, amount: balance.negated().toDecimalPlaces(4) });
          }
        }

        // Contrapartida en Resultado del Ejercicio
        // Si ganancia: Crédito (negativo). Si pérdida: Débito (positivo).
        const resultEntry: Prisma.JournalEntryCreateManyTransactionInput = {
          accountId: company.resultAccountId,
          amount: netResult.negated().toDecimalPlaces(4), // ganancia = crédito (negativo)
        };
        closingEntries.push(resultEntry);

        // ── 7. Persistir el asiento de cierre ─────────────────────────────────
        const decemberPeriod = periods.find((p) => p.month === 12);
        const lastPeriod = periods.sort((a, b) => b.month - a.month)[0];

        const closingTx = await tx.transaction.create({
          data: {
            number: closingNumber,
            companyId,
            userId: closedBy,
            description: `Cierre de cuentas de resultado — Ejercicio ${year}`,
            date: closingDate,
            type: "CIERRE",
            status: "POSTED",
            periodId: decemberPeriod?.id ?? lastPeriod.id,
            entries: { createMany: { data: closingEntries } },
          },
          select: { id: true },
        });

        // ── 8. Insertar FiscalYearClose ───────────────────────────────────────
        const fiscalClose = await tx.fiscalYearClose.create({
          data: {
            companyId,
            year,
            closedBy,
            closingTransactionId: closingTx.id,
            totalRevenue: totalRevenue.toDecimalPlaces(4),
            totalExpenses: totalExpenses.toDecimalPlaces(4),
            netResult: netResult.toDecimalPlaces(4),
          },
          select: { id: true },
        });

        // ── 9. AuditLog ───────────────────────────────────────────────────────
        await tx.auditLog.create({
          data: {
            entityId: fiscalClose.id,
            entityName: "FiscalYearClose",
            action: "CLOSE",
            userId: closedBy,
            newValue: {
              fiscalYearCloseId: fiscalClose.id,
              companyId,
              year,
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
      },
      { isolationLevel: "Serializable" }
    );
  }

  /**
   * Genera el asiento de apropiación del resultado del ejercicio a patrimonio.
   * Diferible post-AGO (Asamblea General Ordinaria).
   */
  static async appropriateFiscalYearResult(
    companyId: string,
    year: number,
    approvedBy: string
  ): Promise<{ appropriationTransactionId: string }> {
    return await prisma.$transaction(
      async (tx) => {
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
          throw new Error(
            `El ejercicio ${year} ya tiene asiento de apropiación registrado.`
          );
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
        const appDate = new Date(year, 11, 31);
        const prefix = `${year}-12-`;
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
          },
          {
            accountId: company.retainedEarningsAccountId,
            amount: netResult.negated().toDecimalPlaces(4), // contrapartida
          },
        ];

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
            entityId: fiscalClose.id,
            entityName: "FiscalYearClose",
            action: "APPROPRIATE",
            userId: approvedBy,
            oldValue: { appropriationTransactionId: null },
            newValue: { appropriationTransactionId: appTx.id },
          },
        });

        return { appropriationTransactionId: appTx.id };
      },
      { isolationLevel: "Serializable" }
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
    entries: { amount: Prisma.Decimal; accountId: string; account: { id: string; name: string; code: string } }[]
  ): Record<string, { accountId: string; account: { id: string; name: string; code: string }; balance: Decimal }> {
    const map: Record<string, { accountId: string; account: { id: string; name: string; code: string }; balance: Decimal }> = {};
    for (const e of entries) {
      if (!map[e.accountId]) {
        map[e.accountId] = { accountId: e.accountId, account: e.account, balance: new Decimal(0) };
      }
      map[e.accountId].balance = map[e.accountId].balance.plus(e.amount.toString());
    }
    return map;
  }
}
