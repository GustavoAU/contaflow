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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── Service ──────────────────────────────────────────────────────────────────

export class KpiDashboardService {
  /**
   * KPIs de cartera y días de cobro promedio.
   */
  static async getKpiSummary(companyId: string): Promise<KpiSummary> {
    const now = new Date();
    const since30d = new Date(now.getTime() - 30 * MS_PER_DAY);

    const [pendingByType, recentSales] = await Promise.all([
      // MEDIUM-01 follow-up: suma en BD por tipo. Antes cargaba TODAS las facturas
      // impagas a memoria solo para sumarlas en JS — O(cartera) que crece sin límite.
      prisma.invoice.groupBy({
        by: ["type"],
        where: {
          companyId,
          deletedAt: null,
          paymentStatus: { in: ["UNPAID", "PARTIAL"] },
        },
        _sum: { pendingAmount: true },
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

    for (const row of pendingByType) {
      if (!row._sum.pendingAmount) continue;
      const amount = new Decimal(row._sum.pendingAmount.toString());
      if (row.type === InvoiceType.SALE) {
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

    const d30 = new Date(now.getTime() + 30 * MS_PER_DAY);
    const d60 = new Date(now.getTime() + 60 * MS_PER_DAY);
    const d90 = new Date(now.getTime() + 90 * MS_PER_DAY);

    // MEDIUM-01 follow-up: suma en BD por (ventana × tipo). Equivalencia exacta con
    // el bucketing anterior por ceil((dueDate−hoy)/día): ceil(y)≤30 ⇔ y≤30 →
    // [hoy, +30d] · (＋30d, +60d] · (+60d, +90d]. Un rango sobre dueDate excluye NULL.
    const windows = [
      { label: "0-30d" as const,  range: { gte: now, lte: d30 } },
      { label: "31-60d" as const, range: { gt: d30, lte: d60 } },
      { label: "61-90d" as const, range: { gt: d60, lte: d90 } },
    ];

    const perWindow = await Promise.all(
      windows.map((w) =>
        prisma.invoice.groupBy({
          by: ["type"],
          where: {
            companyId,
            deletedAt: null,
            paymentStatus: { in: ["UNPAID", "PARTIAL"] },
            dueDate: w.range,
          },
          _sum: { pendingAmount: true },
        }),
      ),
    );

    return windows.map((w, i) => {
      let collections = new Decimal(0);
      let payments = new Decimal(0);
      for (const row of perWindow[i]) {
        if (!row._sum.pendingAmount) continue;
        const amount = new Decimal(row._sum.pendingAmount.toString());
        if (row.type === InvoiceType.SALE) collections = collections.plus(amount);
        else payments = payments.plus(amount);
      }
      return {
        label: w.label,
        collections: collections.toFixed(2),
        payments: payments.toFixed(2),
        net: collections.minus(payments).toFixed(2),
      };
    });
  }
}
