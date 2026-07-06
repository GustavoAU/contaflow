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

    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const t31 = new Date(today.getTime() - 31 * MS_PER_DAY);
    const t61 = new Date(today.getTime() - 61 * MS_PER_DAY);
    const t91 = new Date(today.getTime() - 91 * MS_PER_DAY);

    // MEDIUM-01 follow-up: suma en BD por (ventana × tipo). Antes cargaba TODA la
    // cartera impaga a memoria solo para clasificarla — O(filas) sin límite.
    // Equivalencia exacta con floor((hoy−dueDate)/día): floor(y)≤30 ⇔ y<31 →
    // "0-30" = dueDate > hoy−31d (incluye vencimientos futuros, igual que antes).
    // Un rango sobre dueDate excluye NULL (reemplaza el { not: null }).
    const windows = [
      { bucket: "0-30" as const,  range: { gt: t31 } },
      { bucket: "31-60" as const, range: { gt: t61, lte: t31 } },
      { bucket: "61-90" as const, range: { gt: t91, lte: t61 } },
      { bucket: "90+" as const,   range: { lte: t91 } },
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
      let cxc = new Decimal(0);
      let cxp = new Decimal(0);
      for (const row of perWindow[i]) {
        if (!row._sum.pendingAmount) continue;
        const amount = new Decimal(row._sum.pendingAmount.toString());
        if (row.type === InvoiceType.SALE) cxc = cxc.plus(amount);
        else cxp = cxp.plus(amount);
      }
      return {
        bucket: w.bucket,
        cxcAmount: cxc.toFixed(2),
        cxpAmount: cxp.toFixed(2),
      };
    });
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
