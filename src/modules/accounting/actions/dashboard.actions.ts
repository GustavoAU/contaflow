// src/modules/accounting/actions/dashboard.actions.ts
"use server";

import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";

export async function getDashboardMetricsAction(companyId: string) {
  try {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const monthStart = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00Z`);

    const [
      totalAccounts,
      totalTransactions,
      monthTransactions,
      activePeriod,
      lastTransaction,
      trialBalance,
    ] = await Promise.all([
      // Total de cuentas
      prisma.account.count({ where: { companyId } }),

      // Total de asientos
      prisma.transaction.count({
        where: { companyId, status: "POSTED" },
      }),

      // Asientos del mes actual
      prisma.transaction.count({
        where: {
          companyId,
          status: "POSTED",
          date: { gte: monthStart },
        },
      }),

      // Período activo
      prisma.accountingPeriod.findFirst({
        where: { companyId, status: "OPEN" },
        orderBy: { year: "desc" },
      }),

      // Último asiento
      prisma.transaction.findFirst({
        where: { companyId, status: "POSTED" },
        orderBy: { date: "desc" },
        select: { number: true, description: true, date: true },
      }),

      // Balance para calcular activos y pasivos
      prisma.account.findMany({
        where: { companyId },
        include: {
          journalEntries: {
            where: {
              transaction: { status: "POSTED" },
            },
          },
        },
      }),
    ]);

    // Calcular totales por tipo
    let totalAssets = new Decimal(0);
    let totalLiabilities = new Decimal(0);
    let totalRevenue = new Decimal(0);
    let totalExpenses = new Decimal(0);

    for (const account of trialBalance) {
      const balance = account.journalEntries.reduce(
        (acc, e) => acc.plus(new Decimal(e.amount.toString())),
        new Decimal(0)
      );

      if (account.type === "ASSET") totalAssets = totalAssets.plus(balance);
      if (account.type === "LIABILITY") totalLiabilities = totalLiabilities.plus(balance.abs());
      if (account.type === "REVENUE") totalRevenue = totalRevenue.plus(balance.abs());
      if (account.type === "EXPENSE") totalExpenses = totalExpenses.plus(balance);
    }

    return {
      success: true,
      data: {
        totalAccounts,
        totalTransactions,
        monthTransactions,
        activePeriod,
        lastTransaction,
        totalAssets: totalAssets.toFixed(2),
        totalLiabilities: totalLiabilities.toFixed(2),
        totalRevenue: totalRevenue.toFixed(2),
        totalExpenses: totalExpenses.toFixed(2),
        netIncome: totalRevenue.minus(totalExpenses).toFixed(2),
      },
    } as const;
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message } as const;
    return { success: false, error: "Error al obtener métricas" } as const;
  }
}
