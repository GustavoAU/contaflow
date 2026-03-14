// src/modules/accounting/actions/report.actions.ts
"use server";

import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";

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

export type BalanceSheetRow = {
  id: string;
  code: string;
  name: string;
  balance: string;
};

export type BalanceSheet = {
  assets: BalanceSheetRow[];
  liabilities: BalanceSheetRow[];
  equity: BalanceSheetRow[];
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  totalLiabilitiesAndEquity: string;
  isBalanced: boolean;
};

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ─── Libro Mayor ──────────────────────────────────────────────────────────────

export async function getLedgerAction(
  companyId: string,
  dateFrom?: Date,
  dateTo?: Date
): Promise<ActionResult<LedgerAccount[]>> {
  try {
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
        let runningBalance = new Decimal(0);
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
            description: entry.transaction.description,
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
  dateTo?: Date
): Promise<ActionResult<TrialBalanceRow[]>> {
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

export async function getIncomeStatementAction(
  companyId: string,
  dateFrom?: Date,
  dateTo?: Date
): Promise<ActionResult<IncomeStatement>> {
  try {
    const accounts = await prisma.account.findMany({
      where: {
        companyId,
        type: { in: ["REVENUE", "EXPENSE"] },
      },
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

    let totalRevenues = new Decimal(0);
    let totalExpenses = new Decimal(0);

    const revenues: IncomeStatementRow[] = [];
    const expenses: IncomeStatementRow[] = [];

    for (const account of accounts) {
      if (account.journalEntries.length === 0) continue;

      const balance = account.journalEntries.reduce((acc, entry) => {
        return acc.plus(new Decimal(entry.amount.toString()));
      }, new Decimal(0));

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

    const netIncome = totalRevenues.minus(totalExpenses);

    return {
      success: true,
      data: {
        revenues,
        expenses,
        totalRevenues: totalRevenues.toFixed(2),
        totalExpenses: totalExpenses.toFixed(2),
        netIncome: netIncome.toFixed(2),
      },
    };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al generar el Estado de Resultados" };
  }
}

// ─── Balance General ──────────────────────────────────────────────────────────

export async function getBalanceSheetAction(
  companyId: string,
  dateTo?: Date
): Promise<ActionResult<BalanceSheet>> {
  try {
    const accounts = await prisma.account.findMany({
      where: {
        companyId,
        type: { in: ["ASSET", "LIABILITY", "EQUITY"] },
      },
      orderBy: { code: "asc" },
      include: {
        journalEntries: {
          where: {
            transaction: {
              status: "POSTED",
              ...(dateTo ? { date: { lte: dateTo } } : {}),
            },
          },
        },
      },
    });

    let totalAssets = new Decimal(0);
    let totalLiabilities = new Decimal(0);
    let totalEquity = new Decimal(0);

    const assets: BalanceSheetRow[] = [];
    const liabilities: BalanceSheetRow[] = [];
    const equity: BalanceSheetRow[] = [];

    for (const account of accounts) {
      if (account.journalEntries.length === 0) continue;

      const balance = account.journalEntries.reduce((acc, entry) => {
        return acc.plus(new Decimal(entry.amount.toString()));
      }, new Decimal(0));

      const row: BalanceSheetRow = {
        id: account.id,
        code: account.code,
        name: account.name,
        balance: balance.abs().toFixed(2),
      };

      if (account.type === "ASSET") {
        assets.push(row);
        totalAssets = totalAssets.plus(balance.abs());
      } else if (account.type === "LIABILITY") {
        liabilities.push(row);
        totalLiabilities = totalLiabilities.plus(balance.abs());
      } else {
        equity.push(row);
        totalEquity = totalEquity.plus(balance.abs());
      }
    }

    const totalLiabilitiesAndEquity = totalLiabilities.plus(totalEquity);
    const isBalanced = totalAssets.equals(totalLiabilitiesAndEquity);

    return {
      success: true,
      data: {
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
