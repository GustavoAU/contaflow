// src/modules/bank-reconciliation/services/BankStatementService.ts
import { prisma } from "@/lib/prisma";
import { Decimal } from "decimal.js";
import type { Prisma } from "@prisma/client";
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

  /**
   * @internal Requiere que el caller pase un tx de $transaction.
   * No llama a prisma directamente — solo opera sobre tx para garantizar atomicidad (LL-010).
   */
  async addTransaction(
    input: CreateBankTransactionInput,
    tx: Prisma.TransactionClient
  ) {
    return tx.bankTransaction.create({
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

  /**
   * Obtiene un extracto con sus transacciones.
   * @param statementId - ID del extracto
   * @param companyId - Obligatorio cuando el caller no ha verificado pertenencia previamente.
   *                    Cuando se provee, valida que el extracto pertenece a la company.
   */
  async getWithTransactions(statementId: string, companyId?: string) {
    const stmt = await prisma.bankStatement.findUnique({
      where: { id: statementId },
      include: {
        bankAccount: { select: { id: true, name: true, bankName: true, currency: true, companyId: true } },
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

    // Tenant isolation: si se provee companyId, verificar que el extracto pertenece a esa company
    if (companyId && stmt.bankAccount.companyId !== companyId) return null;

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

  /**
   * @internal Requiere que el caller pase un tx de $transaction.
   */
  async matchTransaction(input: MatchTransactionInput, tx: Prisma.TransactionClient) {
    return tx.bankTransaction.update({
      where: { id: input.bankTransactionId },
      data: {
        matchedPaymentId: input.matchedPaymentId,
        matchedAt: new Date(),
        matchedBy: input.matchedBy,
        isReconciled: true,
      },
    });
  },

  /**
   * Revierte una conciliación bancaria.
   * Requiere companyId para aislamiento multi-tenant (ADR-004).
   * Debe ejecutarse dentro de un $transaction con AuditLog (LL-010, ADR-006 D-4).
   */
  async unmatchTransaction(
    bankTransactionId: string,
    companyId: string,
    userId: string,
    tx: Prisma.TransactionClient
  ) {
    // Verificar tenant scope antes de mutar
    const existing = await tx.bankTransaction.findUnique({
      where: { id: bankTransactionId },
      include: { statement: { include: { bankAccount: { select: { companyId: true } } } } },
    });
    if (!existing || existing.statement.bankAccount.companyId !== companyId) {
      throw new Error("Transacción bancaria no encontrada o sin permisos");
    }

    const updated = await tx.bankTransaction.update({
      where: { id: bankTransactionId },
      data: {
        matchedPaymentId: null,
        matchedAt: null,
        matchedBy: null,
        isReconciled: false,
      },
    });

    await tx.auditLog.create({
      data: {
        entityName: "BankTransaction",
        entityId: bankTransactionId,
        action: "UNRECONCILE",
        userId,
        oldValue: { isReconciled: true, matchedPaymentId: existing.matchedPaymentId },
        newValue: { isReconciled: false, matchedPaymentId: null },
      },
    });

    return updated;
  },

  /**
   * Lista extractos de una cuenta bancaria.
   * Requiere companyId para aislamiento multi-tenant (ADR-004).
   */
  async listByAccount(bankAccountId: string, companyId: string) {
    return prisma.bankStatement.findMany({
      where: { bankAccountId, bankAccount: { companyId } },
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
