// src/modules/accounting/services/PeriodService.ts
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { FiscalYearCloseService } from "@/modules/fiscal-close/services/FiscalYearCloseService";
import { PeriodSnapshotService } from "./PeriodSnapshotService";

export class PeriodService {
  /**
   * Obtiene el período activo (OPEN) de una empresa.
   * Retorna null si no hay período abierto.
   */
  static async getActivePeriod(companyId: string) {
    return prisma.accountingPeriod.findFirst({
      where: { companyId, status: "OPEN" },
      orderBy: { year: "desc" },
    });
  }

  /**
   * Verifica que `date` caiga dentro del único período OPEN de la empresa y lo retorna.
   * Garantía del modelo: hay exactamente UN período OPEN por empresa, definido por
   * `year` + `month` (1-12). Lanza si no hay período abierto o si el año/mes de la
   * fecha no coinciden con el período (HC-02 auditoría Caja Chica 2026-06).
   *
   * Importante: se usan getters UTC porque las fechas de operación se construyen como
   * `new Date("YYYY-MM-DD")` (medianoche UTC). Usar getters locales desplazaría el mes
   * en husos negativos como Venezuela (UTC-4). Ver patrón en fixed-assets/payroll.
   */
  static async assertDateInOpenPeriod(
    companyId: string,
    date: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; year: number; month: number }> {
    const db = tx ?? prisma;
    const period = await db.accountingPeriod.findFirst({
      where: { companyId, status: "OPEN" },
      select: { id: true, year: true, month: true },
    });
    if (!period) throw new Error("No hay período contable abierto");

    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    if (year !== period.year || month !== period.month) {
      const mm = String(month).padStart(2, "0");
      const pm = String(period.month).padStart(2, "0");
      throw new Error(
        `La fecha (${mm}/${year}) está fuera del período contable abierto (${pm}/${period.year}). Solo se pueden registrar operaciones del período abierto actual.`,
      );
    }
    return period;
  }

  /**
   * Obtiene todos los períodos de una empresa ordenados por fecha.
   */
  static async getPeriods(companyId: string) {
    return prisma.accountingPeriod.findMany({
      where: { companyId },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      include: {
        _count: { select: { transactions: true } },
      },
    });
  }

  /**
   * Abre un nuevo período contable.
   * Regla: solo puede haber un período OPEN por empresa a la vez.
   */
  static async openPeriod(
    companyId: string,
    year: number,
    month: number,
    userId: string,
    ipAddress?: string | null,
    userAgent?: string | null,
  ) {
    // 1. Verificar que el ejercicio económico no esté cerrado (Fase 15)
    const isClosed = await FiscalYearCloseService.isFiscalYearClosed(companyId, year);
    if (isClosed) {
      throw new Error(
        `El ejercicio económico ${year} está cerrado. No se pueden abrir períodos de ejercicios cerrados.`
      );
    }

    // 2. Verificar que no haya un período abierto
    const activePeriod = await PeriodService.getActivePeriod(companyId);
    if (activePeriod) {
      throw new Error(
        `Ya existe un período abierto: ${activePeriod.month}/${activePeriod.year}. Ciérralo antes de abrir uno nuevo.`
      );
    }

    // 2. Verificar que no exista ya ese período
    const existing = await prisma.accountingPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
    });
    if (existing) {
      throw new Error(`El período ${month}/${year} ya existe.`);
    }

    // 3. Crear el período + AuditLog de forma atómica
    const period = await prisma.$transaction(async (tx) => {
      const created = await tx.accountingPeriod.create({
        data: { companyId, year, month, openedBy: userId },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityId: created.id,
          entityName: "AccountingPeriod",
          action: "OPEN",
          userId,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
          newValue: created as object,
        },
      });

      return created;
    });

    return period;
  }

  /**
   * Cierra el período activo.
   * Genera snapshots de saldos para todas las cuentas con movimientos (Fase 13C-B4).
   * Regla: debe existir un período OPEN para cerrar.
   */
  static async closePeriod(
    companyId: string,
    userId: string,
    ipAddress?: string | null,
    userAgent?: string | null,
  ) {
    // 1. Buscar período activo
    const activePeriod = await PeriodService.getActivePeriod(companyId);
    if (!activePeriod) {
      throw new Error("No hay período abierto para cerrar.");
    }

    // 2. Cerrar el período + Snapshots + AuditLog de forma atómica
    const closed = await prisma.$transaction(async (tx) => {
      const updated = await tx.accountingPeriod.update({
        where: { id: activePeriod.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedBy: userId,
        },
      });

      // Fase 13C-B4: generar snapshots de saldos al cierre del período.
      // Llamado dentro del mismo $transaction para atomicidad ACID (best-practices §6.3).
      await PeriodSnapshotService.upsertAllSnapshotsForPeriod(companyId, activePeriod.id, tx);

      await tx.auditLog.create({
        data: {
          companyId,
          entityId: updated.id,
          entityName: "AccountingPeriod",
          action: "CLOSE",
          userId,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
          oldValue: activePeriod as object,
          newValue: updated as object,
        },
      });

      return updated;
    });

    return closed;
  }
}
