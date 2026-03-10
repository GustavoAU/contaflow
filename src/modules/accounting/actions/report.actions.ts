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
