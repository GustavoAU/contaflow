// src/modules/dashboard/services/PendingTasksService.ts
//
// Motor de reglas determinístico para detectar tareas de compliance fiscal pendientes.
// Solo recibe companyId — no texto libre del usuario (security finding 26B-02: prompt injection).
// El servicio devuelve counts y metadata; el resumen en lenguaje natural lo genera la action.

import prisma from "@/lib/prisma";

export type PendingTaskType =
  | "INVOICES_SIN_CAUSAR"
  | "PERIODO_ABIERTO_VIEJO"
  | "ACTIVOS_SIN_DEPRECIAR"
  | "RETENCIONES_SIN_VINCULAR"
  | "EXTRACTO_SIN_CONCILIAR";

export type PendingTask = {
  type: PendingTaskType;
  severity: "error" | "warning" | "info";
  title: string;
  description: string;
  count: number;
  href: string; // ruta relativa (se prefija con /company/[companyId] en el componente)
};

export type PendingTasksData = {
  tasks: PendingTask[];
  totalCount: number;
};

export const PendingTasksService = {
  async getPendingTasks(companyId: string): Promise<PendingTasksData> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-indexed

    const [
      invoicesSinCausarCount,
      periodosAbiertosCount,
      activosSinDepreciarCount,
      retencionesSinVincularCount,
      extractosSinConciliarCount,
    ] = await Promise.all([
      // 1. Facturas sin asiento contable (transactionId null)
      prisma.invoice.count({
        where: {
          companyId,
          transactionId: null,
          deletedAt: null,
          type: { in: ["SALE", "PURCHASE"] },
        },
      }),

      // 2. Períodos contables OPEN hace más de 30 días
      prisma.accountingPeriod.count({
        where: {
          companyId,
          status: "OPEN",
          openedAt: { lt: thirtyDaysAgo },
        },
      }),

      // 3. Activos fijos ACTIVE sin entrada de depreciación del mes actual
      prisma.fixedAsset.count({
        where: {
          companyId,
          status: "ACTIVE",
          deletedAt: null,
          NOT: {
            entries: {
              some: {
                periodYear: currentYear,
                periodMonth: currentMonth,
              },
            },
          },
        },
      }),

      // 4. Retenciones PENDING sin vincular a factura
      prisma.retencion.count({
        where: {
          companyId,
          invoiceId: null,
          deletedAt: null,
          status: "PENDING",
        },
      }),

      // 5. Extractos bancarios OPEN con período terminado hace > 30 días
      prisma.bankStatement.count({
        where: {
          bankAccount: { companyId, deletedAt: null },
          status: "OPEN",
          periodEnd: { lt: thirtyDaysAgo },
          deletedAt: null,
        },
      }),
    ]);

    const tasks: PendingTask[] = [];

    if (invoicesSinCausarCount > 0) {
      const pl = invoicesSinCausarCount > 1;
      tasks.push({
        type: "INVOICES_SIN_CAUSAR",
        severity: "error",
        title: "Facturas sin asiento contable",
        description: `${invoicesSinCausarCount} factura${pl ? "s" : ""} no ha${pl ? "n" : ""} sido causada${pl ? "s" : ""} en el libro mayor.`,
        count: invoicesSinCausarCount,
        href: "/invoices",
      });
    }

    if (periodosAbiertosCount > 0) {
      const pl = periodosAbiertosCount > 1;
      tasks.push({
        type: "PERIODO_ABIERTO_VIEJO",
        severity: "warning",
        title: "Período contable sin cerrar",
        description: `${periodosAbiertosCount} período${pl ? "s" : ""} lleva${pl ? "n" : ""} más de 30 días abierto${pl ? "s" : ""}.`,
        count: periodosAbiertosCount,
        href: "/settings",
      });
    }

    if (activosSinDepreciarCount > 0) {
      const pl = activosSinDepreciarCount > 1;
      tasks.push({
        type: "ACTIVOS_SIN_DEPRECIAR",
        severity: "warning",
        title: "Activos sin depreciar este mes",
        description: `${activosSinDepreciarCount} activo${pl ? "s" : ""} fijo${pl ? "s" : ""} no tiene${pl ? "n" : ""} depreciación del mes actual registrada.`,
        count: activosSinDepreciarCount,
        href: "/fixed-assets",
      });
    }

    if (retencionesSinVincularCount > 0) {
      const pl = retencionesSinVincularCount > 1;
      tasks.push({
        type: "RETENCIONES_SIN_VINCULAR",
        severity: "warning",
        title: "Retenciones sin vincular",
        description: `${retencionesSinVincularCount} retención${pl ? "es" : ""} pendiente${pl ? "s" : ""} sin factura asociada.`,
        count: retencionesSinVincularCount,
        href: "/retentions",
      });
    }

    if (extractosSinConciliarCount > 0) {
      const pl = extractosSinConciliarCount > 1;
      tasks.push({
        type: "EXTRACTO_SIN_CONCILIAR",
        severity: "info",
        title: "Extractos bancarios sin conciliar",
        description: `${extractosSinConciliarCount} extracto${pl ? "s" : ""} bancario${pl ? "s" : ""} sin conciliar hace más de 30 días.`,
        count: extractosSinConciliarCount,
        href: "/bank-reconciliation",
      });
    }

    return {
      tasks,
      totalCount: tasks.reduce((acc, t) => acc + t.count, 0),
    };
  },
};
