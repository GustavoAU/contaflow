import { prisma } from "@/lib/prisma";
import { Decimal } from "decimal.js";
import type { BankTransaction } from "@prisma/client";

export type MatchTarget =
  | { type: "INVOICE_PAYMENT"; id: string }
  | { type: "JOURNAL_ENTRY"; id: string }
  | { type: "PAYMENT_RECORD"; id: string };

export const BankReconciliationService = {
  async matchTransaction(
    bankTransactionId: string,
    target: MatchTarget,
    companyId: string,
    matchedBy: string
  ): Promise<BankTransaction> {
    return prisma.$transaction(async (tx) => {
      // ADR-004: verify bankTx belongs to company via statement → bankAccount
      const bankTx = await tx.bankTransaction.findFirst({
        where: { id: bankTransactionId },
        include: { statement: { include: { bankAccount: true } } },
      });

      if (!bankTx || (bankTx as { statement: { bankAccount: { companyId: string } } }).statement.bankAccount.companyId !== companyId) {
        throw new Error("BankTransaction no encontrada o no pertenece a la empresa");
      }

      if (bankTx.isReconciled) {
        throw new Error("La transacción ya está conciliada");
      }

      // Verify counterpart belongs to same company
      let matchData: Record<string, unknown>;

      if (target.type === "INVOICE_PAYMENT") {
        const payment = await tx.invoicePayment.findFirst({
          where: { id: target.id, companyId },
        });
        if (!payment) throw new Error("La contrapartida no pertenece a la empresa");
        matchData = { matchedPaymentId: target.id };
      } else if (target.type === "JOURNAL_ENTRY") {
        const journal = await tx.transaction.findFirst({
          where: { id: target.id, companyId },
        });
        if (!journal) throw new Error("La contrapartida no pertenece a la empresa");
        matchData = { matchedTransactionId: target.id };
      } else {
        const paymentRecord = await tx.paymentRecord.findFirst({
          where: { id: target.id, companyId },
        });
        if (!paymentRecord) throw new Error("La contrapartida no pertenece a la empresa");
        matchData = { matchedPaymentRecordId: target.id };
      }

      const updated = await tx.bankTransaction.update({
        where: { id: bankTransactionId },
        data: {
          ...matchData,
          isReconciled: true,
          matchedAt: new Date(),
          matchedBy,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "BANK_TRANSACTION_MATCHED",
          entityType: "BankTransaction",
          entityId: bankTransactionId,
          userId: matchedBy,
          companyId,
          metadata: { target },
        },
      });

      return updated;
    });
  },

  detectIgtfCandidate(
    target: BankTransaction,
    allUnreconciled: BankTransaction[]
  ): BankTransaction | null {
    const expected = new Decimal(target.amount.toString()).mul("0.03");
    const tolerance = new Decimal("0.01");
    const targetDate = target.date.getTime();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;

    for (const candidate of allUnreconciled) {
      if (candidate.id === target.id) continue;
      if (candidate.isReconciled) continue;
      if (candidate.type !== "DEBIT") continue;

      const amountDiff = new Decimal(candidate.amount.toString()).minus(expected).abs();
      if (amountDiff.greaterThan(tolerance)) continue;

      const dateDiff = Math.abs(candidate.date.getTime() - targetDate);
      if (dateDiff > threeDaysMs) continue;

      return candidate;
    }

    return null;
  },
};
