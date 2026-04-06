// src/modules/bank-reconciliation/services/BankStatementService.ts
import { prisma } from "@/lib/prisma";
import { Decimal } from "decimal.js";
import type {
  CreateBankStatementInput,
  CreateBankTransactionInput,
  MatchTransactionInput,
} from "../schemas/bank-statement.schema";

export const BankStatementService = {
  async create(input: CreateBankStatementInput) {
    return prisma.bankStatement.create({
      data: {
        bankAccountId: input.bankAccountId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        openingBalance: new Decimal(input.openingBalance),
        closingBalance: new Decimal(input.closingBalance),
        importedBy: input.importedBy,
      },
    });
  },

  async addTransaction(input: CreateBankTransactionInput) {
    return prisma.bankTransaction.create({
      data: {
        statementId: input.statementId,
        date: input.date,
        description: input.description,
        type: input.type,
        amount: new Decimal(input.amount),
        reference: input.reference,
      },
    });
  },

  async getWithTransactions(statementId: string) {
    const stmt = await prisma.bankStatement.findUnique({
      where: { id: statementId },
      include: {
        bankAccount: { select: { id: true, name: true, bankName: true, currency: true } },
        transactions: {
          orderBy: [{ date: "asc" }, { createdAt: "asc" }],
          include: {
            matchedPayment: {
              select: {
                id: true,
                amount: true,
                currency: true,
                method: true,
                date: true,
                referenceNumber: true,
              },
            },
          },
        },
      },
    });
    if (!stmt) return null;

    const matchedCount = stmt.transactions.filter((t) => t.matchedPaymentId !== null).length;

    return {
      ...stmt,
      openingBalance: new Decimal(stmt.openingBalance).toFixed(2),
      closingBalance: new Decimal(stmt.closingBalance).toFixed(2),
      matchedCount,
      totalCount: stmt.transactions.length,
      transactions: stmt.transactions.map((t) => ({
        ...t,
        amount: new Decimal(t.amount).toFixed(2),
      })),
    };
  },

  async matchTransaction(input: MatchTransactionInput) {
    return prisma.bankTransaction.update({
      where: { id: input.bankTransactionId },
      data: {
        matchedPaymentId: input.matchedPaymentId,
        matchedAt: new Date(),
        matchedBy: input.matchedBy,
        isReconciled: true,
      },
    });
  },

  async unmatchTransaction(bankTransactionId: string) {
    return prisma.bankTransaction.update({
      where: { id: bankTransactionId },
      data: {
        matchedPaymentId: null,
        matchedAt: null,
        matchedBy: null,
        isReconciled: false,
      },
    });
  },

  async listByAccount(bankAccountId: string) {
    return prisma.bankStatement.findMany({
      where: { bankAccountId },
      orderBy: { periodEnd: "desc" },
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        openingBalance: true,
        closingBalance: true,
        status: true,
        importedAt: true,
        _count: { select: { transactions: true } },
      },
    });
  },
};
