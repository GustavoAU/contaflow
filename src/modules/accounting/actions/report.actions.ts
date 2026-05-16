// src/modules/accounting/actions/report.actions.ts
"use server";

import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { Decimal } from "decimal.js";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export type LedgerEntry = {
  date: Date;
  number: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
  transactionId: string;
};

export type LedgerAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  entries: LedgerEntry[];
  totalDebit: string;
  totalCredit: string;
  balance: string;
  openingBalance: string; // saldo acumulado antes de dateFrom; "0.00" si no hay filtro
};

export type TrialBalanceRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  totalDebit: string;
  totalCredit: string;
  balance: string;
};

// ─── Tipos nuevos ─────────────────────────────────────────────────────────────

export type IncomeStatementRow = {
  id: string;
  code: string;
  name: string;
  balance: string;
};

export type IncomeStatement = {
  revenues: IncomeStatementRow[];
  expenses: IncomeStatementRow[];
  totalRevenues: string;
  totalExpenses: string;
  netIncome: string; // positivo = utilidad, negativo = pérdida
};

export type IncomeStatementResult = {
  current: IncomeStatement;
  compare?: IncomeStatement;
};

export type BalanceSheetRow = {
  id: string;
  code: string;
  name: string;
  balance: string;
};

export type BalanceSheet = {
  // Split corriente / no corriente (VEN-NIF BA-10 / IAS 1)
  currentAssets: BalanceSheetRow[];
  nonCurrentAssets: BalanceSheetRow[];
  currentLiabilities: BalanceSheetRow[];
  nonCurrentLiabilities: BalanceSheetRow[];
  totalCurrentAssets: string;
  totalNonCurrentAssets: string;
  totalCurrentLiabilities: string;
  totalNonCurrentLiabilities: string;
  // Mantenidos para compatibilidad con PDF service
  assets: BalanceSheetRow[];
  liabilities: BalanceSheetRow[];
  equity: BalanceSheetRow[];
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  totalLiabilitiesAndEquity: string;
  isBalanced: boolean;
};

// ─── Libro Diario ─────────────────────────────────────────────────────────────

export type JournalLine = {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
};

export type JournalTransaction = {
  id: string;
  number: string;
  date: Date;
  description: string;
  reference: string | null;
  type: string;
  lines: JournalLine[];
  totalDebit: string;
  totalCredit: string;
};

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ─── Guard compartido ─────────────────────────────────────────────────────────

async function guardAccounting(
  companyId: string,
): Promise<{ userId: string } | { success: false; error: string }> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Acceso denegado" };

  return { userId };
}

export async function getJournalAction(
  companyId: string,
  dateFrom?: Date,
  dateTo?: Date,
  search?: string,
): Promise<ActionResult<JournalTransaction[]>> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  const q = search?.trim();

  try {
    const transactions = await prisma.transaction.findMany({
      where: {
        companyId,
        status: "POSTED",
        ...(dateFrom || dateTo
          ? {
              date: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
        ...(q
          ? {
              OR: [
                { description: { contains: q, mode: "insensitive" } },
                { number: { contains: q, mode: "insensitive" } },
                { reference: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ date: "asc" }, { number: "asc" }],
      include: {
        entries: {
          include: {
            account: { select: { code: true, name: true } },
          },
          orderBy: { amount: "desc" }, // débitos primero (positivos), créditos después
        },
      },
    });

    const result: JournalTransaction[] = transactions.map((tx) => {
      let totalDebit = new Decimal(0);
      let totalCredit = new Decimal(0);

      const lines: JournalLine[] = tx.entries.map((entry) => {
        const amount = new Decimal(entry.amount.toString());
        if (amount.greaterThan(0)) {
          totalDebit = totalDebit.plus(amount);
          return {
            accountCode: entry.account?.code ?? "—",
            accountName: entry.account?.name ?? "—",
            debit: amount.toFixed(2),
            credit: "",
          };
        } else {
          totalCredit = totalCredit.plus(amount.abs());
          return {
            accountCode: entry.account?.code ?? "—",
            accountName: entry.account?.name ?? "—",
            debit: "",
            credit: amount.abs().toFixed(2),
          };
        }
      });

      return {
        id: tx.id,
        number: tx.number,
        date: tx.date,
        description: tx.description,
        reference: tx.reference,
        type: tx.type,
        lines,
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
      };
    });

    return { success: true, data: result };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al generar el Libro Diario" };
  }
}

// ─── Libro Mayor ──────────────────────────────────────────────────────────────

export async function getLedgerAction(
  companyId: string,
  dateFrom?: Date,
  dateTo?: Date,
): Promise<ActionResult<LedgerAccount[]>> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  try {
    // Saldos anteriores a dateFrom (un aggregate por cuenta en una sola query)
    const openingBalanceMap = new Map<string, Decimal>();
    if (dateFrom) {
      const priorEntries = await prisma.journalEntry.groupBy({
        by: ["accountId"],
        where: {
          account: { companyId },
          transaction: { status: "POSTED", date: { lt: dateFrom } },
        },
        _sum: { amount: true },
      });
      for (const row of priorEntries) {
        openingBalanceMap.set(
          row.accountId,
          new Decimal(row._sum.amount?.toString() ?? "0"),
        );
      }
    }

    const accounts = await prisma.account.findMany({
      where: { companyId },
      orderBy: { code: "asc" },
      include: {
        journalEntries: {
          include: {
            transaction: true,
          },
          where: {
            transaction: {
              status: "POSTED",
              ...(dateFrom || dateTo
                ? {
                    date: {
                      ...(dateFrom ? { gte: dateFrom } : {}),
                      ...(dateTo ? { lte: dateTo } : {}),
                    },
                  }
                : {}),
            },
          },
          orderBy: {
            transaction: { date: "asc" },
          },
        },
      },
    });

    const result: LedgerAccount[] = accounts
      .filter((a) => a.journalEntries.length > 0)
      .map((account) => {
        const opening = openingBalanceMap.get(account.id) ?? new Decimal(0);
        let runningBalance = opening;
        let totalDebit = new Decimal(0);
        let totalCredit = new Decimal(0);

        const entries: LedgerEntry[] = account.journalEntries.map((entry) => {
          const amount = new Decimal(entry.amount.toString());

          if (amount.greaterThan(0)) {
            totalDebit = totalDebit.plus(amount);
          } else {
            totalCredit = totalCredit.plus(amount.abs());
          }

          runningBalance = runningBalance.plus(amount);

          return {
            date: entry.transaction.date,
            number: entry.transaction.number,
            description: entry.description ?? entry.transaction.description,
            debit: amount.greaterThan(0) ? amount.toFixed(2) : "",
            credit: amount.lessThan(0) ? amount.abs().toFixed(2) : "",
            balance: runningBalance.toFixed(2),
            transactionId: entry.transactionId,
          };
        });

        return {
          id: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          entries,
          totalDebit: totalDebit.toFixed(2),
          totalCredit: totalCredit.toFixed(2),
          balance: runningBalance.toFixed(2),
          openingBalance: opening.toFixed(2),
        };
      });

    return { success: true, data: result };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al generar el Libro Mayor" };
  }
}

// ─── Balance de Comprobacion ──────────────────────────────────────────────────

export async function getTrialBalanceAction(
  companyId: string,
  dateFrom?: Date,
  dateTo?: Date,
): Promise<ActionResult<TrialBalanceRow[]>> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  try {
    const accounts = await prisma.account.findMany({
      where: { companyId },
      orderBy: { code: "asc" },
      include: {
        journalEntries: {
          where: {
            transaction: {
              status: "POSTED",
              ...(dateFrom || dateTo
                ? {
                    date: {
                      ...(dateFrom ? { gte: dateFrom } : {}),
                      ...(dateTo ? { lte: dateTo } : {}),
                    },
                  }
                : {}),
            },
          },
        },
      },
    });

    const rows: TrialBalanceRow[] = accounts
      .filter((a) => a.journalEntries.length > 0)
      .map((account) => {
        let totalDebit = new Decimal(0);
        let totalCredit = new Decimal(0);

        for (const entry of account.journalEntries) {
          const amount = new Decimal(entry.amount.toString());
          if (amount.greaterThan(0)) {
            totalDebit = totalDebit.plus(amount);
          } else {
            totalCredit = totalCredit.plus(amount.abs());
          }
        }

        const balance = totalDebit.minus(totalCredit);

        return {
          id: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          totalDebit: totalDebit.toFixed(2),
          totalCredit: totalCredit.toFixed(2),
          balance: balance.toFixed(2),
        };
      });

    return { success: true, data: rows };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al generar el Balance de Comprobacion" };
  }
}

// ─── Estado de Resultados ─────────────────────────────────────────────────────

async function computeIncomeStatement(
  companyId: string,
  dateFrom?: Date,
  dateTo?: Date,
): Promise<IncomeStatement> {
  const accounts = await prisma.account.findMany({
    where: { companyId, type: { in: ["REVENUE", "EXPENSE"] } },
    orderBy: { code: "asc" },
    include: {
      journalEntries: {
        where: {
          transaction: {
            status: "POSTED",
            ...(dateFrom || dateTo
              ? { date: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } }
              : {}),
          },
        },
      },
    },
  });

  let totalRevenues = new Decimal(0);
  let totalExpenses = new Decimal(0);
  const revenues: IncomeStatementRow[] = [];
  const expenses: IncomeStatementRow[] = [];

  for (const account of accounts) {
    if (account.journalEntries.length === 0) continue;
    const balance = account.journalEntries.reduce(
      (acc, entry) => acc.plus(new Decimal(entry.amount.toString())),
      new Decimal(0),
    );
    const row: IncomeStatementRow = {
      id: account.id,
      code: account.code,
      name: account.name,
      balance: balance.abs().toFixed(2),
    };
    if (account.type === "REVENUE") {
      revenues.push(row);
      totalRevenues = totalRevenues.plus(balance.abs());
    } else {
      expenses.push(row);
      totalExpenses = totalExpenses.plus(balance.abs());
    }
  }

  return {
    revenues,
    expenses,
    totalRevenues: totalRevenues.toFixed(2),
    totalExpenses: totalExpenses.toFixed(2),
    netIncome: totalRevenues.minus(totalExpenses).toFixed(2),
  };
}

export async function getIncomeStatementAction(
  companyId: string,
  dateFrom?: Date,
  dateTo?: Date,
  compareDateFrom?: Date,
  compareDateTo?: Date,
): Promise<ActionResult<IncomeStatementResult>> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  try {
    const hasCompare = !!(compareDateFrom || compareDateTo);
    const [current, compare] = await Promise.all([
      computeIncomeStatement(companyId, dateFrom, dateTo),
      hasCompare ? computeIncomeStatement(companyId, compareDateFrom, compareDateTo) : Promise.resolve(undefined),
    ]);

    return { success: true, data: { current, compare } };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al generar el Estado de Resultados" };
  }
}

// ─── Balance General ──────────────────────────────────────────────────────────

export async function getBalanceSheetAction(
  companyId: string,
  dateTo?: Date,
): Promise<ActionResult<BalanceSheet>> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  try {
    const [accounts, incomeAccounts] = await Promise.all([
      prisma.account.findMany({
        where: { companyId, type: { in: ["ASSET", "CONTRA_ASSET", "LIABILITY", "EQUITY"] } },
        orderBy: { code: "asc" },
        include: {
          journalEntries: {
            where: { transaction: { status: "POSTED", ...(dateTo ? { date: { lte: dateTo } } : {}) } },
          },
        },
      }),
      prisma.account.findMany({
        where: { companyId, type: { in: ["REVENUE", "EXPENSE"] } },
        include: {
          journalEntries: {
            where: { transaction: { status: "POSTED", ...(dateTo ? { date: { lte: dateTo } } : {}) } },
          },
        },
      }),
    ]);

    let totalAssets = new Decimal(0);
    let totalLiabilities = new Decimal(0);
    let totalEquity = new Decimal(0);
    let totalCurrentAssets = new Decimal(0);
    let totalNonCurrentAssets = new Decimal(0);
    let totalCurrentLiabilities = new Decimal(0);
    let totalNonCurrentLiabilities = new Decimal(0);

    const assets: BalanceSheetRow[] = [];
    const liabilities: BalanceSheetRow[] = [];
    const equity: BalanceSheetRow[] = [];
    const currentAssets: BalanceSheetRow[] = [];
    const nonCurrentAssets: BalanceSheetRow[] = [];
    const currentLiabilities: BalanceSheetRow[] = [];
    const nonCurrentLiabilities: BalanceSheetRow[] = [];

    for (const account of accounts) {
      if (account.journalEntries.length === 0) continue;

      const balance = account.journalEntries.reduce(
        (acc, entry) => acc.plus(new Decimal(entry.amount.toString())),
        new Decimal(0),
      );

      if (account.type === "ASSET") {
        const row: BalanceSheetRow = { id: account.id, code: account.code, name: account.name, balance: balance.toFixed(2) };
        assets.push(row);
        totalAssets = totalAssets.plus(balance);
        if (account.isCurrent) { currentAssets.push(row); totalCurrentAssets = totalCurrentAssets.plus(balance); }
        else { nonCurrentAssets.push(row); totalNonCurrentAssets = totalNonCurrentAssets.plus(balance); }
      } else if (account.type === "CONTRA_ASSET") {
        // Credit balance (negative) — shown as deduction from assets with (-) prefix
        const row: BalanceSheetRow = { id: account.id, code: account.code, name: `(-) ${account.name}`, balance: balance.toFixed(2) };
        assets.push(row);
        totalAssets = totalAssets.plus(balance);
        if (account.isCurrent) { currentAssets.push(row); totalCurrentAssets = totalCurrentAssets.plus(balance); }
        else { nonCurrentAssets.push(row); totalNonCurrentAssets = totalNonCurrentAssets.plus(balance); }
      } else if (account.type === "LIABILITY") {
        const display = balance.negated();
        const row: BalanceSheetRow = { id: account.id, code: account.code, name: account.name, balance: display.toFixed(2) };
        liabilities.push(row);
        totalLiabilities = totalLiabilities.plus(display);
        if (account.isCurrent) { currentLiabilities.push(row); totalCurrentLiabilities = totalCurrentLiabilities.plus(display); }
        else { nonCurrentLiabilities.push(row); totalNonCurrentLiabilities = totalNonCurrentLiabilities.plus(display); }
      } else {
        const display = balance.negated();
        equity.push({ id: account.id, code: account.code, name: account.name, balance: display.toFixed(2) });
        totalEquity = totalEquity.plus(display);
      }
    }

    let totalRevenues = new Decimal(0);
    let totalExpenses = new Decimal(0);
    for (const account of incomeAccounts) {
      if (account.journalEntries.length === 0) continue;
      const balance = account.journalEntries.reduce(
        (acc, entry) => acc.plus(new Decimal(entry.amount.toString())),
        new Decimal(0),
      );
      if (account.type === "REVENUE") {
        totalRevenues = totalRevenues.plus(balance.negated());
      } else {
        totalExpenses = totalExpenses.plus(balance);
      }
    }
    const netIncome = totalRevenues.minus(totalExpenses);
    if (!netIncome.isZero()) {
      equity.push({ id: "net-income", code: "—", name: "Resultado del Ejercicio", balance: netIncome.toFixed(2) });
      totalEquity = totalEquity.plus(netIncome);
    }

    const totalLiabilitiesAndEquity = totalLiabilities.plus(totalEquity);
    const isBalanced = totalAssets.minus(totalLiabilitiesAndEquity).abs().lessThan(new Decimal("0.02"));

    return {
      success: true,
      data: {
        currentAssets,
        nonCurrentAssets,
        currentLiabilities,
        nonCurrentLiabilities,
        totalCurrentAssets: totalCurrentAssets.toFixed(2),
        totalNonCurrentAssets: totalNonCurrentAssets.toFixed(2),
        totalCurrentLiabilities: totalCurrentLiabilities.toFixed(2),
        totalNonCurrentLiabilities: totalNonCurrentLiabilities.toFixed(2),
        assets,
        liabilities,
        equity,
        totalAssets: totalAssets.toFixed(2),
        totalLiabilities: totalLiabilities.toFixed(2),
        totalEquity: totalEquity.toFixed(2),
        totalLiabilitiesAndEquity: totalLiabilitiesAndEquity.toFixed(2),
        isBalanced,
      },
    };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al generar el Balance General" };
  }
}

// ─── Info básica de empresa para encabezados de reporte ───────────────────────

export async function getCompanyHeaderAction(
  companyId: string,
): Promise<ActionResult<{ name: string; rif: string | null }>> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, rif: true },
    });
    if (!company) return { success: false, error: "Empresa no encontrada" };
    return { success: true, data: { name: company.name, rif: company.rif } };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener datos de empresa" };
  }
}
