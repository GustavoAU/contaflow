// src/modules/analytics/services/KpiDashboardService.ts
// KPIs ejecutivos: CxC, CxP, DSO, flujo de caja proyectado 30/60/90 días.
// Solo lectura. Sin mutaciones.

import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { InvoiceType } from "@prisma/client";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type KpiSummary = {
  /** Saldo pendiente total de facturas de VENTA no pagadas (Bs.) */
  cxcTotal: string;
  /** Saldo pendiente total de facturas de COMPRA no pagadas (Bs.) */
  cxpTotal: string;
  /** Capital de trabajo: CxC − CxP (puede ser negativo) */
  workingCapital: string;
  /**
   * DSO — Días de Cobro Promedio.
   * Fórmula: (CxC / ventas_últimos_30d) × 30.
   * null si no hay ventas en los últimos 30 días.
   */
  dso: number | null;
};

export type CashFlowBucket = {
  label: "0-30d" | "31-60d" | "61-90d";
  collections: string; // cobros esperados (SALE invoices con dueDate en la ventana)
  payments: string;    // pagos comprometidos (PURCHASE invoices con dueDate en la ventana)
  net: string;         // collections − payments
};

export type CashFlowProjection = CashFlowBucket[];

// ─── Service ──────────────────────────────────────────────────────────────────

export class KpiDashboardService {
  /**
   * KPIs de cartera y días de cobro promedio.
   */
  static async getKpiSummary(companyId: string): Promise<KpiSummary> {
    const now = new Date();
    const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [unpaidInvoices, recentSales] = await Promise.all([
      // Todas las facturas activas no pagadas / parciales
      prisma.invoice.findMany({
        where: {
          companyId,
          deletedAt: null,
          paymentStatus: { in: ["UNPAID", "PARTIAL"] },
        },
        select: { type: true, pendingAmount: true },
      }),

      // Ventas de los últimos 30 días para calcular DSO
      prisma.invoice.aggregate({
        where: {
          companyId,
          deletedAt: null,
          type: InvoiceType.SALE,
          date: { gte: since30d },
        },
        _sum: { totalAmountVes: true },
      }),
    ]);

    let cxc = new Decimal(0);
    let cxp = new Decimal(0);

    for (const inv of unpaidInvoices) {
      if (!inv.pendingAmount) continue;
      const amount = new Decimal(inv.pendingAmount.toString());
      if (inv.type === InvoiceType.SALE) {
        cxc = cxc.plus(amount);
      } else {
        cxp = cxp.plus(amount);
      }
    }

    const workingCapital = cxc.minus(cxp);

    // DSO = (CxC / ventas_30d) × 30
    const sales30d = recentSales._sum.totalAmountVes
      ? new Decimal(recentSales._sum.totalAmountVes.toString())
      : new Decimal(0);

    const dso =
      sales30d.isZero()
        ? null
        : Math.round(cxc.dividedBy(sales30d).times(30).toNumber());

    return {
      cxcTotal: cxc.toFixed(2),
      cxpTotal: cxp.toFixed(2),
      workingCapital: workingCapital.toFixed(2),
      dso,
    };
  }

  /**
   * Flujo de caja proyectado en ventanas de 30/60/90 días.
   * Incluye facturas con dueDate en el rango y paymentStatus UNPAID | PARTIAL.
   */
  static async getCashFlowProjection(companyId: string): Promise<CashFlowProjection> {
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);

    const d90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    const invoices = await prisma.invoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        paymentStatus: { in: ["UNPAID", "PARTIAL"] },
        dueDate: { gte: now, lte: d90 },
      },
      select: { type: true, dueDate: true, pendingAmount: true },
    });

    type BucketAccum = { collections: Decimal; payments: Decimal };
    const buckets: Record<"0-30d" | "31-60d" | "61-90d", BucketAccum> = {
      "0-30d":  { collections: new Decimal(0), payments: new Decimal(0) },
      "31-60d": { collections: new Decimal(0), payments: new Decimal(0) },
      "61-90d": { collections: new Decimal(0), payments: new Decimal(0) },
    };

    for (const inv of invoices) {
      if (!inv.dueDate || !inv.pendingAmount) continue;

      const daysAhead = Math.ceil(
        (inv.dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      );

      const key: keyof typeof buckets =
        daysAhead <= 30
          ? "0-30d"
          : daysAhead <= 60
            ? "31-60d"
            : "61-90d";

      const amount = new Decimal(inv.pendingAmount.toString());
      if (inv.type === InvoiceType.SALE) {
        buckets[key].collections = buckets[key].collections.plus(amount);
      } else {
        buckets[key].payments = buckets[key].payments.plus(amount);
      }
    }

    return (["0-30d", "31-60d", "61-90d"] as const).map((label) => ({
      label,
      collections: buckets[label].collections.toFixed(2),
      payments: buckets[label].payments.toFixed(2),
      net: buckets[label].collections.minus(buckets[label].payments).toFixed(2),
    }));
  }
}
