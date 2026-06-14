// src/modules/accounting/actions/dashboard.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

type DashboardMetrics = {
  totalAccounts: number;
  totalTransactions: number;
  monthTransactions: number;
  activePeriod: Awaited<ReturnType<typeof prisma.accountingPeriod.findFirst>>;
  lastTransaction: { number: string; description: string; date: Date } | null;
  totalAssets: string;
  totalLiabilities: string;
  totalRevenue: string;
  totalExpenses: string;
  netIncome: string;
};

export async function getDashboardMetricsAction(
  companyId: string
): Promise<ActionResult<DashboardMetrics>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    // NOTA: esta es una lectura del dashboard en el render de cada entrada a la empresa.
    // No se rate-limita con limiters.fiscal (cupo de mutaciones fiscales): hacerlo bloqueaba
    // al usuario (redirect a /dashboard) tras varias recargas. Sigue protegida por auth + IDOR.
    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member || !canAccess(member.role, ROLES.ALL))
      return { success: false, error: "Acceso denegado" };

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
      prisma.account.count({ where: { companyId } }),
      prisma.transaction.count({ where: { companyId, status: "POSTED" } }),
      prisma.transaction.count({
        where: { companyId, status: "POSTED", date: { gte: monthStart } },
      }),
      prisma.accountingPeriod.findFirst({
        where: { companyId, status: "OPEN" },
        orderBy: { year: "desc" },
      }),
      prisma.transaction.findFirst({
        where: { companyId, status: "POSTED" },
        orderBy: { date: "desc" },
        select: { number: true, description: true, date: true },
      }),
      prisma.account.findMany({
        where: { companyId },
        include: {
          journalEntries: {
            where: { transaction: { status: "POSTED" } },
          },
        },
      }),
    ]);

    let totalAssets = new Decimal(0);
    let totalLiabilities = new Decimal(0);
    let totalRevenue = new Decimal(0);
    let totalExpenses = new Decimal(0);

    for (const account of trialBalance) {
      const balance = account.journalEntries.reduce(
        (acc, e) => acc.plus(new Decimal(e.amount.toString())),
        new Decimal(0),
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
    };
  } catch (error) {
    return toActionError(error);
  }
}
