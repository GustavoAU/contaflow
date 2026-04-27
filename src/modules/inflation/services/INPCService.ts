// src/modules/inflation/services/INPCService.ts
//
// Fase 22 — Ajuste por Inflación Fiscal (INPC / VEN-NIF 3)
// ADR-008: transactionId NON-NULLABLE, Serializable, withCompanyContext
// Sección 36: filtro isMonetary + REPOMO (Resultado por Posición Monetaria Neta)

import { Decimal } from "decimal.js";
import type { PrismaClient, AccountType } from "@prisma/client";
import type { UpsertINPCRateInput, RunInflationAdjustmentInput, SetInflationBaseInput } from "../schemas/inpc.schema";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

// ─── Tipos de salida ────────────────────────────────────────────────────────────

export type INPCRateRow = {
  id: string;
  year: number;
  month: number;
  indexValue: Decimal;
  source: string | null;
  createdAt: Date;
};

export type AdjustmentPreviewRow = {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  originalBalance: Decimal;   // saldo actual de la cuenta
  cumulativeIndex: Decimal;   // factor = currentIndex / baseIndex
  adjustmentAmount: Decimal;  // originalBalance × (factor − 1)
};

// VEN-NIF 3 §36.4: resultado por posición monetaria neta
export type RepomoPreview = {
  netMonetaryPosition: Decimal; // Σ activos monetarios + Σ pasivos monetarios (con signos naturales)
  factor: Decimal;
  repomoAmount: Decimal; // PMN × (factor − 1); positivo = pérdida (gasto), negativo = ganancia (ingreso)
};

export type AdjustmentPreviewResult = {
  rows: AdjustmentPreviewRow[];   // cuentas no monetarias
  repomo: RepomoPreview | null;   // null si no hay cuentas monetarias o PMN = 0
};

export type InflationAdjustmentSummary = {
  adjustedAccounts: number;
  totalAdjustment: Decimal;   // suma de abs(adjustmentAmount) de cuentas no monetarias
  transactionId: string;
  factor: Decimal;
  repomo: Decimal | null;     // monto REPOMO registrado; null si no aplica
};

// ─── Pure functions (testables sin BD) ────────────────────────────────────────

/**
 * Calcula el factor de inflación acumulado.
 * factor = currentIndex / baseIndex
 */
export function calcInflationFactor(baseIndex: Decimal, currentIndex: Decimal): Decimal {
  if (baseIndex.lessThanOrEqualTo(0)) throw new Error("El índice base debe ser mayor a cero");
  return currentIndex.dividedBy(baseIndex).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}

/**
 * Calcula el monto del ajuste de inflación para una cuenta no monetaria.
 * adjustmentAmount = balance × (factor − 1)
 *
 * Convención de signos (consistente con JournalEntry):
 *   - Positivo = Débito
 *   - Negativo = Crédito
 */
export function calcAdjustmentAmount(balance: Decimal, factor: Decimal): Decimal {
  return balance.times(factor.minus(1)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/**
 * Calcula la Posición Monetaria Neta (PMN).
 * PMN = Σ saldos de cuentas monetarias (con signo natural del sistema).
 * ASSET monetario: saldo positivo. LIABILITY monetario: saldo negativo.
 * PMN > 0 → más activos monetarios → pérdida por inflación (REPOMO > 0 si factor > 1).
 */
export function calcNetMonetaryPosition(monetaryBalances: Decimal[]): Decimal {
  return monetaryBalances.reduce((acc, b) => acc.plus(b), new Decimal(0));
}

/**
 * Calcula el REPOMO (Resultado por Posición Monetaria Neta).
 * repomoAmount = PMN × (factor − 1)
 * Positivo = pérdida monetaria (débito a gasto REPOMO).
 * Negativo = ganancia monetaria (crédito a ingreso REPOMO).
 */
export function calcRepomo(netMonetaryPosition: Decimal, factor: Decimal): Decimal {
  return netMonetaryPosition.times(factor.minus(1)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/**
 * Devuelve el último día del mes dado (para filtrar saldos del período).
 */
export function lastDayOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)); // day 0 del mes siguiente = último día del mes
}

// ─── INPCService ───────────────────────────────────────────────────────────────

export class INPCService {
  /**
   * Upsert de un índice INPC mensual.
   * Idempotente: si ya existe el registro (companyId, year, month), lo actualiza.
   */
  static async upsertRate(input: UpsertINPCRateInput, userId: string, tx: Tx): Promise<{ id: string }> {
    const rate = await tx.iNPCRate.upsert({
      where: {
        companyId_year_month: {
          companyId: input.companyId,
          year: input.year,
          month: input.month,
        },
      },
      update: {
        indexValue: new Decimal(input.indexValue),
        source: input.source ?? "BCV",
      },
      create: {
        companyId: input.companyId,
        year: input.year,
        month: input.month,
        indexValue: new Decimal(input.indexValue),
        source: input.source ?? "BCV",
      },
    });

    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        entityId: rate.id,
        entityName: "INPCRate",
        action: "UPSERT",
        userId,
        newValue: {
          companyId: input.companyId,
          year: input.year,
          month: input.month,
          indexValue: input.indexValue,
        },
      },
    });

    return { id: rate.id };
  }

  /**
   * Lista todos los índices INPC de la empresa, ordenados por año/mes desc.
   */
  static async getRates(companyId: string, tx: Tx): Promise<INPCRateRow[]> {
    const rates = await tx.iNPCRate.findMany({
      where: { companyId },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    return rates.map((r) => ({
      id: r.id,
      year: r.year,
      month: r.month,
      indexValue: new Decimal(r.indexValue.toString()),
      source: r.source,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Obtiene el valor del índice INPC para un período dado.
   * Retorna null si no existe.
   */
  static async getRate(companyId: string, year: number, month: number, tx: Tx): Promise<Decimal | null> {
    const rate = await tx.iNPCRate.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
    });
    return rate ? new Decimal(rate.indexValue.toString()) : null;
  }

  /**
   * Configura el período base de reexpresión para la empresa.
   */
  static async setInflationBase(input: SetInflationBaseInput, userId: string, tx: Tx): Promise<void> {
    await tx.company.update({
      where: { id: input.companyId },
      data: {
        inflationBaseYear: input.inflationBaseYear,
        inflationBaseMonth: input.inflationBaseMonth,
      },
    });

    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        entityId: input.companyId,
        entityName: "Company",
        action: "SET_INFLATION_BASE",
        userId,
        newValue: {
          inflationBaseYear: input.inflationBaseYear,
          inflationBaseMonth: input.inflationBaseMonth,
        },
      },
    });
  }

  /**
   * Calcula los saldos de cuentas al cierre del período dado.
   * Suma JournalEntry.amount de transacciones POSTED hasta el último día del mes.
   * Excluye cuentas con saldo cero.
   */
  static async getAccountBalances(
    companyId: string,
    year: number,
    month: number,
    tx: Tx,
  ): Promise<{ accountId: string; balance: Decimal }[]> {
    const endOfPeriod = lastDayOfMonth(year, month);

    const grouped = await tx.journalEntry.groupBy({
      by: ["accountId"],
      where: {
        transaction: {
          companyId,
          date: { lte: endOfPeriod },
          status: "POSTED",
        },
      },
      _sum: { amount: true },
    });

    return grouped
      .filter((g) => g._sum.amount !== null && !new Decimal(g._sum.amount.toString()).isZero())
      .map((g) => ({
        accountId: g.accountId,
        balance: new Decimal(g._sum.amount!.toString()),
      }));
  }

  /**
   * Genera el preview del ajuste por inflación SIN escribir en BD.
   *
   * Sección 36 VEN-NIF 3:
   * - Cuentas monetarias (isMonetary=true): excluidas de reexpresión → contribuyen al REPOMO.
   * - Cuentas no monetarias (isMonetary=false): reexpresadas con factor = currentIndex / baseIndex.
   * - REPOMO = PMN × (factor − 1); se muestra en el preview, se registra en runAdjustment.
   */
  static async previewAdjustment(
    companyId: string,
    periodYear: number,
    periodMonth: number,
    adjustmentAccountId: string,
    tx: Tx,
  ): Promise<AdjustmentPreviewResult> {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });

    if (!company.inflationBaseYear || !company.inflationBaseMonth) {
      throw new Error(
        "La empresa no tiene configurado el período base de inflación. Configure inflationBaseYear e inflationBaseMonth primero.",
      );
    }

    const baseIndex = await INPCService.getRate(companyId, company.inflationBaseYear, company.inflationBaseMonth, tx);
    if (!baseIndex) {
      throw new Error(
        `No existe el índice INPC para el período base (${company.inflationBaseYear}/${String(company.inflationBaseMonth).padStart(2, "0")}). Cárguelo primero.`,
      );
    }

    const currentIndex = await INPCService.getRate(companyId, periodYear, periodMonth, tx);
    if (!currentIndex) {
      throw new Error(
        `No existe el índice INPC para el período ${periodYear}/${String(periodMonth).padStart(2, "0")}. Cárguelo primero.`,
      );
    }

    const factor = calcInflationFactor(baseIndex, currentIndex);

    const balances = await INPCService.getAccountBalances(companyId, periodYear, periodMonth, tx);
    if (balances.length === 0) return { rows: [], repomo: null };

    // Excluir la cuenta actualizadora de ambos grupos
    const relevantBalances = balances.filter((b) => b.accountId !== adjustmentAccountId);
    const accountIds = relevantBalances.map((b) => b.accountId);

    const accounts = await tx.account.findMany({
      where: { id: { in: accountIds }, companyId },
      select: { id: true, code: true, name: true, type: true, isMonetary: true },
    });
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    const rows: AdjustmentPreviewRow[] = [];
    const monetaryBalances: Decimal[] = [];

    for (const b of relevantBalances) {
      const acct = accountMap.get(b.accountId);
      if (!acct) continue;

      if (acct.isMonetary) {
        // VEN-NIF 3: no reexpresar — acumular para REPOMO
        monetaryBalances.push(b.balance);
        continue;
      }

      const adjustmentAmount = calcAdjustmentAmount(b.balance, factor);
      if (adjustmentAmount.isZero()) continue;

      rows.push({
        accountId: acct.id,
        accountCode: acct.code,
        accountName: acct.name,
        accountType: acct.type,
        originalBalance: b.balance,
        cumulativeIndex: factor,
        adjustmentAmount,
      });
    }

    // Calcular REPOMO si hay cuentas monetarias
    let repomo: RepomoPreview | null = null;
    if (monetaryBalances.length > 0) {
      const netMonetaryPosition = calcNetMonetaryPosition(monetaryBalances);
      const repomoAmount = calcRepomo(netMonetaryPosition, factor);
      if (!repomoAmount.isZero()) {
        repomo = { netMonetaryPosition, factor, repomoAmount };
      }
    }

    return { rows, repomo };
  }

  /**
   * Ejecuta el ajuste por inflación para un período.
   * Crea Transaction (tipo AJUSTE) + JournalEntry[] + InflationAdjustment[].
   * Si hay cuentas monetarias y se provee repomoAccountId, agrega asiento REPOMO.
   * ADR-008 D-6: llamar desde $transaction con isolationLevel: Serializable.
   */
  static async runAdjustment(
    input: RunInflationAdjustmentInput,
    userId: string,
    tx: Tx,
  ): Promise<InflationAdjustmentSummary> {
    const { companyId, periodYear, periodMonth, adjustmentAccountId, repomoAccountId } = input;

    // Guard: verificar que no existan ajustes ya registrados para este período
    const existingCount = await tx.inflationAdjustment.count({
      where: { companyId, periodYear, periodMonth },
    });
    if (existingCount > 0) {
      throw new Error(
        `El ajuste por inflación para ${periodYear}/${String(periodMonth).padStart(2, "0")} ya fue registrado. Para re-ejecutar, anule el asiento previo primero.`,
      );
    }

    const { rows: preview, repomo } = await INPCService.previewAdjustment(
      companyId, periodYear, periodMonth, adjustmentAccountId, tx,
    );
    if (preview.length === 0 && !repomo) {
      throw new Error("No existen cuentas con saldo en el período especificado para ajustar.");
    }

    // Número de transacción
    const txCount = await tx.transaction.count({ where: { companyId } });
    const txNumber = `INF-${periodYear}${String(periodMonth).padStart(2, "0")}-${String(txCount + 1).padStart(4, "0")}`;
    const periodDate = new Date(Date.UTC(periodYear, periodMonth - 1, 1));

    // Suma neta de ajustes de cuentas no monetarias
    const totalNet = preview.reduce((acc, r) => acc.plus(r.adjustmentAmount), new Decimal(0));
    const totalAbsolute = preview.reduce((acc, r) => acc.plus(r.adjustmentAmount.abs()), new Decimal(0));

    const factor = preview[0]?.cumulativeIndex ?? repomo?.factor ?? new Decimal(1);

    const periodLabel = `${periodYear}/${String(periodMonth).padStart(2, "0")}`;

    // Construir entradas: reexpresión de cuentas no monetarias
    const journalEntries: { accountId: string; amount: Decimal; description?: string }[] = [
      ...preview.map((r) => ({
        accountId: r.accountId,
        amount: r.adjustmentAmount,
        description: `Reexpresión INPC — ${r.accountName} — factor ${factor.toFixed(4)} — ${periodLabel}`,
      })),
      { accountId: adjustmentAccountId, amount: totalNet.negated(), description: `Diferencial reexpresión INPC — ${periodLabel}` },
    ];

    // Asiento REPOMO si aplica (VEN-NIF 3 §36.4)
    let repomoRegistered: Decimal | null = null;
    if (repomo && !repomo.repomoAmount.isZero() && repomoAccountId) {
      journalEntries.push(
        { accountId: repomoAccountId, amount: repomo.repomoAmount, description: `REPOMO — posición monetaria neta — ${periodLabel}` },
        { accountId: adjustmentAccountId, amount: repomo.repomoAmount.negated(), description: `REPOMO contrapartida — ${periodLabel}` },
      );
      repomoRegistered = repomo.repomoAmount;
    }

    // Obtener baseYear/Month para registros InflationAdjustment
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });

    const journalTx = await tx.transaction.create({
      data: {
        companyId,
        number: txNumber,
        date: periodDate,
        description: `Ajuste por Inflación INPC: ${periodYear}/${String(periodMonth).padStart(2, "0")} (factor ${factor.toFixed(4)})`,
        type: "AJUSTE",
        userId,
        entries: {
          create: journalEntries.map((e) => ({
            accountId: e.accountId,
            amount: e.amount,
            description: e.description,
          })),
        },
      },
    });

    // Registrar InflationAdjustment solo para cuentas no monetarias
    if (preview.length > 0) {
      await tx.inflationAdjustment.createMany({
        data: preview.map((r) => ({
          companyId,
          periodYear,
          periodMonth,
          baseYear: company.inflationBaseYear!,
          baseMonth: company.inflationBaseMonth!,
          accountId: r.accountId,
          originalAmount: r.originalBalance,
          adjustmentAmount: r.adjustmentAmount,
          cumulativeIndex: r.cumulativeIndex,
          transactionId: journalTx.id,
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        companyId,
        entityId: journalTx.id,
        entityName: "InflationAdjustment",
        action: "RUN_ADJUSTMENT",
        userId,
        newValue: {
          companyId,
          periodYear,
          periodMonth,
          adjustedAccounts: preview.length,
          totalAdjustment: totalAbsolute.toFixed(4),
          factor: factor.toFixed(6),
          repomo: repomoRegistered?.toFixed(4) ?? null,
        },
      },
    });

    return {
      adjustedAccounts: preview.length,
      totalAdjustment: totalAbsolute,
      transactionId: journalTx.id,
      factor,
      repomo: repomoRegistered,
    };
  }
}
