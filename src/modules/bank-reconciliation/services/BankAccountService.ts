// src/modules/bank-reconciliation/services/BankAccountService.ts
import { prisma } from "@/lib/prisma";
import { Decimal } from "decimal.js";
import type { CreateBankAccountInput } from "../schemas/bank-account.schema";

export const BankAccountService = {
  async create(input: CreateBankAccountInput) {
    return prisma.bankAccount.create({
      data: {
        companyId: input.companyId,
        accountId: input.accountId,
        name: input.name,
        bankName: input.bankName,
        currency: input.currency as "VES" | "USD" | "EUR",
        createdBy: input.createdBy,
      },
      include: { account: true },
    });
  },

  async list(companyId: string) {
    const accounts = await prisma.bankAccount.findMany({
      where: { companyId, isActive: true },
      include: {
        account: { select: { id: true, code: true, name: true } },
        statements: {
          orderBy: { periodEnd: "desc" },
          take: 1,
          select: { closingBalance: true, periodEnd: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return accounts.map((a) => ({
      id: a.id,
      name: a.name,
      bankName: a.bankName,
      currency: a.currency,
      accountCode: a.account.code,
      accountName: a.account.name,
      lastClosingBalance: a.statements[0]?.closingBalance
        ? new Decimal(a.statements[0].closingBalance).toFixed(2)
        : null,
      lastStatementDate: a.statements[0]?.periodEnd ?? null,
    }));
  },

  async deactivate(id: string, companyId: string) {
    return prisma.bankAccount.updateMany({
      where: { id, companyId },
      data: { isActive: false },
    });
  },
};
