// src/modules/budgets/services/CashFlowProjectionService.ts
// Q3-3: Proyección de Flujo de Caja 30/60/90 días basada en CxC/CxP vencimientos.
// ADR-004: todos los queries filtran por companyId.
// R-5: Decimal.js para importes.

import prisma from "@/lib/prisma";
import Decimal from "decimal.js";
import type { CashFlowBucket, CashFlowProjection } from "./BudgetService";

type Bucket = {
  label: string;
  maxDays: number | null;   // null = overdue (negative days)
  minDays: number;
};

const BUCKETS: Bucket[] = [
  { label: "Vencido",     minDays: -9999, maxDays: -1   },
  { label: "0-30 días",   minDays: 0,     maxDays: 30   },
  { label: "31-60 días",  minDays: 31,    maxDays: 60   },
  { label: "61-90 días",  minDays: 61,    maxDays: 90   },
];

function daysFromNow(date: Date): number {
  const diff = date.getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function bucketIndex(daysUntilDue: number): number {
  if (daysUntilDue < 0) return 0;  // Vencido
  if (daysUntilDue <= 30) return 1;
  if (daysUntilDue <= 60) return 2;
  return 3;
}

export const CashFlowProjectionService = {
  /**
   * Retorna la proyección de flujo de caja en 4 buckets: Vencido, 0-30, 31-60, 61-90.
   * Solo incluye facturas UNPAID/PARTIAL con dueDate != null dentro de los próximos 90 días
   * (o ya vencidas). Usa pendingAmount cuando existe, o totalAmountVes como fallback.
   */
  async project(companyId: string): Promise<CashFlowProjection> {
    const now     = new Date();
    const cutoff  = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const overdue = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); // 1 año atrás

    // CxC: SALE invoices unpaid/partial with dueDate
    // CxP: PURCHASE invoices unpaid/partial with dueDate
    const [cxcInvoices, cxpInvoices] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          companyId,
          type: "SALE",
          paymentStatus: { in: ["UNPAID", "PARTIAL"] },
          deletedAt: null,
          dueDate: { gte: overdue, lte: cutoff },
        },
        select: { dueDate: true, pendingAmount: true, totalAmountVes: true },
      }),
      prisma.invoice.findMany({
        where: {
          companyId,
          type: "PURCHASE",
          paymentStatus: { in: ["UNPAID", "PARTIAL"] },
          deletedAt: null,
          dueDate: { gte: overdue, lte: cutoff },
        },
        select: { dueDate: true, pendingAmount: true, totalAmountVes: true },
      }),
    ]);

    type Accumulator = {
      cxc: Decimal;
      cxp: Decimal;
      cxcCount: number;
      cxpCount: number;
    };

    const acc: Accumulator[] = BUCKETS.map(() => ({
      cxc: new Decimal(0), cxp: new Decimal(0), cxcCount: 0, cxpCount: 0,
    }));

    for (const inv of cxcInvoices) {
      if (!inv.dueDate) continue;
      const days = daysFromNow(inv.dueDate);
      const idx = bucketIndex(days);
      if (idx >= BUCKETS.length) continue;
      const amount = inv.pendingAmount
        ? new Decimal(inv.pendingAmount.toString())
        : inv.totalAmountVes
          ? new Decimal(inv.totalAmountVes.toString())
          : new Decimal(0);
      acc[idx].cxc = acc[idx].cxc.plus(amount);
      acc[idx].cxcCount++;
    }

    for (const inv of cxpInvoices) {
      if (!inv.dueDate) continue;
      const days = daysFromNow(inv.dueDate);
      const idx = bucketIndex(days);
      if (idx >= BUCKETS.length) continue;
      const amount = inv.pendingAmount
        ? new Decimal(inv.pendingAmount.toString())
        : inv.totalAmountVes
          ? new Decimal(inv.totalAmountVes.toString())
          : new Decimal(0);
      acc[idx].cxp = acc[idx].cxp.plus(amount);
      acc[idx].cxpCount++;
    }

    const buckets: CashFlowBucket[] = BUCKETS.map((b, i) => ({
      label: b.label,
      cxcAmount: acc[i].cxc.toFixed(2),
      cxpAmount: acc[i].cxp.toFixed(2),
      netAmount: acc[i].cxc.minus(acc[i].cxp).toFixed(2),
      invoiceCount: acc[i].cxcCount + acc[i].cxpCount,
    }));

    const totalCxC = acc.reduce((s, a) => s.plus(a.cxc), new Decimal(0));
    const totalCxP = acc.reduce((s, a) => s.plus(a.cxp), new Decimal(0));

    return {
      buckets,
      totalCxC: totalCxC.toFixed(2),
      totalCxP: totalCxP.toFixed(2),
      totalNet: totalCxC.minus(totalCxP).toFixed(2),
    };
  },
};
