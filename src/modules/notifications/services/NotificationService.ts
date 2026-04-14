// src/modules/notifications/services/NotificationService.ts
// Alertas computadas on-the-fly — sin tabla DB propia.
// Solo lectura: no muta datos.

import prisma from "@/lib/prisma";

export type AlertSeverity = "error" | "warning" | "info";

export type NotificationAlert = {
  id: string;           // clave única para React key
  type: string;         // "INVOICE_OVERDUE" | "INVOICE_DUE_SOON" | ...
  title: string;
  description: string;
  href: string;
  severity: AlertSeverity;
};

const DAYS_7 = 7 * 24 * 60 * 60 * 1000;

export class NotificationService {
  /**
   * Devuelve todas las alertas activas para una empresa.
   * Roles que deben ver esto: ACCOUNTING (OWNER, ADMIN, ACCOUNTANT).
   */
  static async getAlerts(companyId: string): Promise<NotificationAlert[]> {
    const now = new Date();
    const in7Days = new Date(now.getTime() + DAYS_7);
    const base = `/company/${companyId}`;

    const [overdueInvoices, dueSoonInvoices, pendingRetenciones, draftMovements] =
      await Promise.all([
        // Facturas vencidas (dueDate < hoy, no pagadas ni anuladas)
        prisma.invoice.findMany({
          where: {
            companyId,
            dueDate: { lt: now },
            paymentStatus: { notIn: ["PAID", "VOIDED"] },
            deletedAt: null,
          },
          select: { id: true, invoiceNumber: true, dueDate: true },
          orderBy: { dueDate: "asc" },
          take: 10,
        }),

        // Facturas que vencen en los próximos 7 días
        prisma.invoice.findMany({
          where: {
            companyId,
            dueDate: { gte: now, lte: in7Days },
            paymentStatus: { notIn: ["PAID", "VOIDED"] },
            deletedAt: null,
          },
          select: { id: true, invoiceNumber: true, dueDate: true },
          orderBy: { dueDate: "asc" },
          take: 10,
        }),

        // Retenciones pendientes de contabilizar
        prisma.retencion.count({
          where: { companyId, status: "PENDING", deletedAt: null },
        }),

        // Movimientos de inventario en DRAFT
        prisma.inventoryMovement.count({
          where: { companyId, status: "DRAFT" },
        }),
      ]);

    const alerts: NotificationAlert[] = [];

    // ── Facturas vencidas ─────────────────────────────────────────────────────
    for (const inv of overdueInvoices) {
      const daysOverdue = Math.floor((now.getTime() - inv.dueDate!.getTime()) / (24 * 60 * 60 * 1000));
      alerts.push({
        id: `invoice-overdue-${inv.id}`,
        type: "INVOICE_OVERDUE",
        title: `Factura vencida: ${inv.invoiceNumber}`,
        description: `Venció hace ${daysOverdue} día${daysOverdue === 1 ? "" : "s"}.`,
        href: `${base}/invoices`,
        severity: "error",
      });
    }

    // ── Facturas por vencer ───────────────────────────────────────────────────
    for (const inv of dueSoonInvoices) {
      const daysLeft = Math.ceil((inv.dueDate!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      alerts.push({
        id: `invoice-due-${inv.id}`,
        type: "INVOICE_DUE_SOON",
        title: `Factura por vencer: ${inv.invoiceNumber}`,
        description: `Vence en ${daysLeft} día${daysLeft === 1 ? "" : "s"}.`,
        href: `${base}/invoices`,
        severity: "warning",
      });
    }

    // ── Retenciones pendientes ────────────────────────────────────────────────
    if (pendingRetenciones > 0) {
      alerts.push({
        id: "retenciones-pending",
        type: "RETENCIONES_PENDING",
        title: pendingRetenciones === 1
          ? "1 retención sin contabilizar"
          : `${pendingRetenciones} retenciones sin contabilizar`,
        description: "Requieren asiento contable para cerrarse.",
        href: `${base}/retentions`,
        severity: "warning",
      });
    }

    // ── Movimientos inventario en DRAFT ───────────────────────────────────────
    if (draftMovements > 0) {
      alerts.push({
        id: "inventory-drafts",
        type: "INVENTORY_DRAFTS",
        title: `${draftMovements} movimiento${draftMovements === 1 ? "" : "s"} de inventario pendiente${draftMovements === 1 ? "" : "s"}`,
        description: "En borrador — el Contador debe contabilizarlos.",
        href: `${base}/inventory`,
        severity: "info",
      });
    }

    // Ordenar: error primero, luego warning, luego info
    const order: Record<AlertSeverity, number> = { error: 0, warning: 1, info: 2 };
    return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
  }
}
