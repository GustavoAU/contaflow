// src/modules/accounting/services/PeriodService.ts
import prisma from "@/lib/prisma";

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
  static async openPeriod(companyId: string, year: number, month: number, userId: string) {
    // 1. Verificar que no haya un período abierto
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
          entityId: created.id,
          entityName: "AccountingPeriod",
          action: "OPEN",
          userId,
          newValue: created as object,
        },
      });

      return created;
    });

    return period;
  }

  /**
   * Cierra el período activo.
   * Regla: debe existir un período OPEN para cerrar.
   */
  static async closePeriod(companyId: string, userId: string) {
    // 1. Buscar período activo
    const activePeriod = await PeriodService.getActivePeriod(companyId);
    if (!activePeriod) {
      throw new Error("No hay período abierto para cerrar.");
    }

    // 2. Cerrar el período + AuditLog de forma atómica
    const closed = await prisma.$transaction(async (tx) => {
      const updated = await tx.accountingPeriod.update({
        where: { id: activePeriod.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedBy: userId,
        },
      });

      await tx.auditLog.create({
        data: {
          entityId: updated.id,
          entityName: "AccountingPeriod",
          action: "CLOSE",
          userId,
          oldValue: activePeriod as object,
          newValue: updated as object,
        },
      });

      return updated;
    });

    return closed;
  }
}
