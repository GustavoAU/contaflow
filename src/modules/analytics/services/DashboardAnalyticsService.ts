// src/modules/analytics/services/DashboardAnalyticsService.ts
import { prisma } from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { Currency, InvoiceType } from "@prisma/client";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

/** Punto mensual del gráfico de ingresos vs gastos */
export type MonthlyRevExpPoint = {
  year: number;
  month: number; // 1–12
  revenue: string; // Decimal → string (Bs.)
  expenses: string;
};

/** Item del gráfico de composición IVA */
export type IvaCompositionItem = {
  taxType: string; // TaxLineType enum value
  totalAmount: string;
};

/** Bucket de envejecimiento CxC/CxP */
export type AgingBucketPoint = {
  bucket: "0-30" | "31-60" | "61-90" | "90+";
  cxcAmount: string; // pendingAmount CxC en Bs.
  cxpAmount: string; // pendingAmount CxP en Bs.
};

/** Ratio de conciliación bancaria */
export type BankReconciliationRatio = {
  total: number;
  reconciled: number;
  unreconciled: number;
  ratioPercent: number; // 0–100
};

/** Punto temporal de tasa BCV */
export type BcvRatePoint = {
  date: string; // "YYYY-MM-DD"
  rate: string; // Decimal → string
};

// ─── Service ──────────────────────────────────────────────────────────────────

export const DashboardAnalyticsService = {
  /**
   * Ingresos y gastos agregados por mes para un año dado.
   * Usa $queryRaw para hacer GROUP BY sobre columnas calculadas (EXTRACT).
   * Excluye asientos de tipo CIERRE para no distorsionar los totales.
   */
  async getRevenueExpenseTrend(
    companyId: string,
    year: number,
  ): Promise<MonthlyRevExpPoint[]> {
    type RawRow = {
      year: bigint;
      month: bigint;
      revenue: string;
      expenses: string;
    };

    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT
        EXTRACT(YEAR  FROM t.date)::bigint AS year,
        EXTRACT(MONTH FROM t.date)::bigint AS month,
        COALESCE(SUM(
          CASE WHEN a.type = 'REVENUE' AND je.amount < 0 THEN -je.amount ELSE 0 END
        ), 0)::text AS revenue,
        COALESCE(SUM(
          CASE WHEN a.type = 'EXPENSE' AND je.amount > 0 THEN je.amount ELSE 0 END
        ), 0)::text AS expenses
      FROM "JournalEntry" je
      JOIN "Transaction" t ON je."transactionId" = t.id
      JOIN "Account" a      ON je."accountId"     = a.id
      WHERE t."companyId" = ${companyId}
        AND t.status      = 'POSTED'
        AND t.type       != 'CIERRE'
        AND EXTRACT(YEAR FROM t.date) = ${year}
      GROUP BY
        EXTRACT(YEAR  FROM t.date),
        EXTRACT(MONTH FROM t.date)
      ORDER BY year, month
    `;

    return rows.map((r) => ({
      year: Number(r.year),
      month: Number(r.month),
      revenue: r.revenue,
      expenses: r.expenses,
    }));
  },

  /**
   * Composición de líneas de IVA del año (o de todos los tiempos si year es null).
   * Agrupa InvoiceTaxLine por taxType y suma los montos.
   */
  async getIvaComposition(
    companyId: string,
    year?: number,
  ): Promise<IvaCompositionItem[]> {
    const dateFilter =
      year !== undefined
        ? {
            gte: new Date(`${year}-01-01T00:00:00.000Z`),
            lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
          }
        : undefined;

    const rows = await prisma.invoiceTaxLine.groupBy({
      by: ["taxType"],
      where: {
        invoice: {
          companyId,
          deletedAt: null,
          ...(dateFilter && { date: dateFilter }),
        },
      },
      _sum: { amount: true },
    });

    return rows
      .filter((r) => r._sum.amount !== null)
      .map((r) => ({
        taxType: r.taxType,
        totalAmount: r._sum.amount!.toString(),
      }));
  },

  /**
   * Envejecimiento de cartera CxC y CxP.
   * Buckets: 0-30, 31-60, 61-90, 90+ días desde la fecha de vencimiento.
   * Solo facturas activas (deletedAt IS NULL) con estado UNPAID o PARTIAL.
   */
  async getAgingBuckets(companyId: string): Promise<AgingBucketPoint[]> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const unpaidInvoices = await prisma.invoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        paymentStatus: { in: ["UNPAID", "PARTIAL"] },
        dueDate: { not: null },
      },
      select: {
        type: true,
        dueDate: true,
        pendingAmount: true,
      },
    });

    const buckets: Record<AgingBucketPoint["bucket"], { cxc: Decimal; cxp: Decimal }> = {
      "0-30": { cxc: new Decimal(0), cxp: new Decimal(0) },
      "31-60": { cxc: new Decimal(0), cxp: new Decimal(0) },
      "61-90": { cxc: new Decimal(0), cxp: new Decimal(0) },
      "90+": { cxc: new Decimal(0), cxp: new Decimal(0) },
    };

    for (const inv of unpaidInvoices) {
      if (!inv.dueDate || !inv.pendingAmount) continue;

      const daysOverdue = Math.floor(
        (today.getTime() - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      const bucketKey: AgingBucketPoint["bucket"] =
        daysOverdue <= 30
          ? "0-30"
          : daysOverdue <= 60
            ? "31-60"
            : daysOverdue <= 90
              ? "61-90"
              : "90+";

      const amount = new Decimal(inv.pendingAmount.toString());
      if (inv.type === InvoiceType.SALE) {
        buckets[bucketKey].cxc = buckets[bucketKey].cxc.plus(amount);
      } else {
        buckets[bucketKey].cxp = buckets[bucketKey].cxp.plus(amount);
      }
    }

    return (["0-30", "31-60", "61-90", "90+"] as const).map((bucket) => ({
      bucket,
      cxcAmount: buckets[bucket].cxc.toFixed(2),
      cxpAmount: buckets[bucket].cxp.toFixed(2),
    }));
  },

  /**
   * Ratio global de conciliación bancaria de la empresa.
   * Cuenta transacciones activas (deletedAt IS NULL) reconciliadas vs total.
   */
  async getBankReconciliationRatio(
    companyId: string,
  ): Promise<BankReconciliationRatio> {
    const [total, reconciled] = await Promise.all([
      prisma.bankTransaction.count({
        where: { companyId, deletedAt: null },
      }),
      prisma.bankTransaction.count({
        where: { companyId, deletedAt: null, isReconciled: true },
      }),
    ]);

    const unreconciled = total - reconciled;
    const ratioPercent = total === 0 ? 0 : Math.round((reconciled / total) * 100);

    return { total, reconciled, unreconciled, ratioPercent };
  },

  /**
   * Evolución de la tasa BCV USD/VES en el tiempo.
   * Devuelve los últimos `months` meses de registros, ordenados cronológicamente.
   */
  async getBcvRateTrend(
    companyId: string,
    currency: Currency = Currency.USD,
    months = 12,
  ): Promise<BcvRatePoint[]> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setMonth(since.getMonth() - months);

    const rows = await prisma.exchangeRate.findMany({
      where: {
        companyId,
        currency,
        date: { gte: since },
      },
      select: { date: true, rate: true },
      orderBy: { date: "asc" },
    });

    return rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      rate: r.rate.toString(),
    }));
  },
};
