// src/modules/accounting/services/PeriodSnapshotService.ts
import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import type { PrismaClient } from "@prisma/client";
import type { PeriodSnapshot } from "@prisma/client";

// Tipo del cliente dentro de $transaction (equivalente a Prisma.TransactionClient)
type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export class PeriodSnapshotService {
  /**
   * Calcula el saldo de una cuenta en VES al cierre de un período
   * y lo guarda/actualiza en PeriodSnapshot (upsert).
   *
   * Balance = suma de JournalEntry.amount para esa cuenta en ese período,
   * excluyendo transacciones con status VOIDED.
   * Convención schema: positivo = Débito, negativo = Crédito.
   *
   * DEBE llamarse dentro de un $transaction (ADR-005, best-practices §6.3).
   */
  static async upsertSnapshot(
    companyId: string,
    periodId: string,
    accountId: string,
    tx: PrismaTransactionClient
  ): Promise<PeriodSnapshot> {
    // Obtener todos los JournalEntries de la cuenta en el período,
    // excluyendo transacciones VOIDED (ADR-002, ADR-004)
    const entries = await tx.journalEntry.findMany({
      where: {
        accountId,
        transaction: {
          companyId,
          periodId,
          status: { not: "VOIDED" },
        },
      },
      select: { amount: true },
    });

    // Sumar con Decimal.js — NUNCA float (ADR-002)
    const balanceVes = entries.reduce(
      (acc, entry) => acc.plus(new Decimal(entry.amount.toString())),
      new Decimal(0)
    );

    // Upsert usando @@unique([periodId, accountId]) como clave
    const snapshot = await tx.periodSnapshot.upsert({
      where: {
        periodId_accountId: { periodId, accountId },
      },
      create: {
        companyId,
        periodId,
        accountId,
        balanceVes: balanceVes.toDecimalPlaces(4),
        balanceOriginal: null,
        currency: "VES",
        snapshotAt: new Date(),
      },
      update: {
        balanceVes: balanceVes.toDecimalPlaces(4),
        snapshotAt: new Date(),
      },
    });

    return snapshot;
  }

  /**
   * Genera snapshots para TODAS las cuentas con movimientos en un período.
   * Solo procesa cuentas con al menos un JournalEntry no-VOID en el período.
   * Llamado desde PeriodService.closePeriod dentro del mismo $transaction.
   *
   * Retorna la cantidad de snapshots creados/actualizados.
   */
  static async upsertAllSnapshotsForPeriod(
    companyId: string,
    periodId: string,
    tx: PrismaTransactionClient
  ): Promise<number> {
    // Obtener IDs de cuentas distintas con movimientos no-VOID en el período (ADR-004)
    const activeEntries = await tx.journalEntry.findMany({
      where: {
        transaction: {
          companyId,
          periodId,
          status: { not: "VOIDED" },
        },
      },
      select: { accountId: true },
      distinct: ["accountId"],
    });

    if (activeEntries.length === 0) {
      return 0;
    }

    // Generar un snapshot por cada cuenta con movimiento
    await Promise.all(
      activeEntries.map(({ accountId }) =>
        PeriodSnapshotService.upsertSnapshot(companyId, periodId, accountId, tx)
      )
    );

    return activeEntries.length;
  }

  /**
   * Recupera el snapshot de una cuenta para un período dado.
   * Retorna null si no existe (período aún abierto o sin movimientos).
   * Operación de solo lectura — no requiere $transaction.
   */
  static async getSnapshot(
    companyId: string,
    periodId: string,
    accountId: string
  ): Promise<PeriodSnapshot | null> {
    // companyId en where garantiza aislamiento multi-tenant (ADR-004)
    return prisma.periodSnapshot.findFirst({
      where: { companyId, periodId, accountId },
    });
  }

  /**
   * Invalida (elimina) todos los snapshots de un período.
   * Usado si se reabre un período (caso excepcional).
   * DEBE llamarse dentro de un $transaction.
   */
  static async invalidateSnapshots(
    companyId: string,
    periodId: string,
    tx: PrismaTransactionClient
  ): Promise<void> {
    await tx.periodSnapshot.deleteMany({
      where: { companyId, periodId },
    });
  }
}
