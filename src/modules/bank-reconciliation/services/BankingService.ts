// src/modules/bank-reconciliation/services/BankingService.ts
import { Decimal } from "decimal.js";
import { prisma } from "@/lib/prisma";
import { type BankTransaction } from "@prisma/client";
import { CsvParserService, type CsvRow } from "./CsvParserService";

export const BankingService = {
  /**
   * Importa un extracto bancario completo (estado de cuenta + transacciones).
   * Ejecutado dentro de una $transaction Read Committed.
   * 1. Valida que bankAccountId pertenece a companyId.
   * 2. Valida el balance del CSV.
   * 3. Crea BankStatement + BankTransaction[] atómicamente.
   * 4. Registra AuditLog.
   */
  async importStatement(
    bankAccountId: string,
    companyId: string,
    csvRows: CsvRow[],
    openingBalance: Decimal,
    closingBalance: Decimal,
    importedBy: string
  ): Promise<{ statementId: string; transactionCount: number }> {
    // Validar pertenencia ANTES de iniciar la transacción (lectura barata)
    const bankAccount = await prisma.bankAccount.findFirst({
      where: { id: bankAccountId, companyId, isActive: true, deletedAt: null },
    });
    if (!bankAccount) {
      throw new Error("La cuenta bancaria no existe o no pertenece a la empresa indicada");
    }

    // Validar que el balance del CSV cuadra
    const balanceCheck = CsvParserService.validateCsvBalance(csvRows, openingBalance, closingBalance);
    if (!balanceCheck.valid) {
      throw new Error(
        `El balance del extracto no cuadra. Calculado: ${balanceCheck.actual?.toFixed(4)}, Declarado: ${balanceCheck.expected?.toFixed(4)}`
      );
    }

    return prisma.$transaction(async (tx) => {
      // Crear extracto
      const statement = await tx.bankStatement.create({
        data: {
          bankAccountId,
          // Determinar período a partir de las fechas de las filas
          periodStart: csvRows.length > 0 ? csvRows[0].date : new Date(),
          periodEnd: csvRows.length > 0 ? csvRows[csvRows.length - 1].date : new Date(),
          openingBalance: openingBalance.toFixed(4),
          closingBalance: closingBalance.toFixed(4),
          importedBy,
        },
      });

      // Crear transacciones
      for (const row of csvRows) {
        // Determinar tipo y monto
        let type: "CREDIT" | "DEBIT";
        let amount: Decimal;

        if (row.credit !== null && (row.debit === null || row.credit.greaterThan(0))) {
          type = "CREDIT";
          amount = row.credit;
        } else if (row.debit !== null) {
          type = "DEBIT";
          amount = row.debit;
        } else {
          // Fila sin movimiento — ignorar
          continue;
        }

        await tx.bankTransaction.create({
          data: {
            statementId: statement.id,
            date: row.date,
            description: row.description,
            type,
            amount: amount.toFixed(4),
          },
        });
      }

      // Contar transacciones creadas
      const transactionCount = await tx.bankTransaction.count({
        where: { statementId: statement.id },
      });

      // AuditLog
      await tx.auditLog.create({
        data: {
          entityId: statement.id,
          entityName: "BankStatement",
          action: "IMPORT",
          userId: importedBy,
          newValue: {
            bankAccountId,
            openingBalance: openingBalance.toFixed(4),
            closingBalance: closingBalance.toFixed(4),
            transactionCount,
          },
        },
      });

      return { statementId: statement.id, transactionCount };
    });
  },

  /**
   * Retorna las transacciones sin conciliar de una cuenta bancaria.
   * Sin $transaction (operación de lectura).
   */
  async getUnreconciledTransactions(
    bankAccountId: string,
    companyId: string
  ): Promise<BankTransaction[]> {
    return prisma.bankTransaction.findMany({
      where: {
        isReconciled: false,
        deletedAt: null,
        statement: {
          bankAccountId,
          bankAccount: {
            companyId,
          },
        },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });
  },

  /**
   * Concilia una transacción bancaria con un pago de factura.
   * $transaction Read Committed.
   */
  async reconcileTransaction(
    transactionId: string,
    invoicePaymentId: string,
    companyId: string,
    reconciledBy: string
  ): Promise<BankTransaction> {
    return prisma.$transaction(async (tx) => {
      // Verificar que la transacción pertenece a la empresa
      const bankTx = await tx.bankTransaction.findFirst({
        where: {
          id: transactionId,
          deletedAt: null,
          statement: {
            bankAccount: { companyId },
          },
        },
      });
      if (!bankTx) {
        throw new Error("La transacción bancaria no existe o no pertenece a la empresa indicada");
      }

      // Verificar que no esté ya conciliada
      if (bankTx.isReconciled) {
        throw new Error("La transacción ya está conciliada");
      }

      // Verificar que el pago pertenece a la empresa
      const payment = await tx.invoicePayment.findFirst({
        where: { id: invoicePaymentId, companyId },
      });
      if (!payment) {
        throw new Error("El pago no existe o no pertenece a la empresa indicada");
      }

      // Actualizar transacción
      const updated = await tx.bankTransaction.update({
        where: { id: transactionId },
        data: {
          matchedPaymentId: invoicePaymentId,
          matchedAt: new Date(),
          matchedBy: reconciledBy,
          isReconciled: true,
        },
      });

      // AuditLog
      await tx.auditLog.create({
        data: {
          entityId: transactionId,
          entityName: "BankTransaction",
          action: "RECONCILE",
          userId: reconciledBy,
          oldValue: { isReconciled: false, matchedPaymentId: null },
          newValue: {
            isReconciled: true,
            matchedPaymentId: invoicePaymentId,
            matchedAt: new Date().toISOString(),
          },
        },
      });

      return updated;
    });
  },

  /**
   * Desconcilia una transacción bancaria.
   * $transaction Read Committed.
   */
  async unreconcileTransaction(
    transactionId: string,
    companyId: string,
    unreconciledBy: string
  ): Promise<BankTransaction> {
    return prisma.$transaction(async (tx) => {
      // Verificar pertenencia a companyId
      const bankTx = await tx.bankTransaction.findFirst({
        where: {
          id: transactionId,
          deletedAt: null,
          statement: {
            bankAccount: { companyId },
          },
        },
      });
      if (!bankTx) {
        throw new Error("La transacción bancaria no existe o no pertenece a la empresa indicada");
      }

      // Verificar que esté conciliada
      if (!bankTx.isReconciled) {
        throw new Error("La transacción no está conciliada");
      }

      const updated = await tx.bankTransaction.update({
        where: { id: transactionId },
        data: {
          matchedPaymentId: null,
          matchedAt: null,
          matchedBy: null,
          isReconciled: false,
        },
      });

      // AuditLog
      await tx.auditLog.create({
        data: {
          entityId: transactionId,
          entityName: "BankTransaction",
          action: "UNRECONCILE",
          userId: unreconciledBy,
          oldValue: {
            isReconciled: true,
            matchedPaymentId: bankTx.matchedPaymentId,
          },
          newValue: { isReconciled: false, matchedPaymentId: null },
        },
      });

      return updated;
    });
  },

  /**
   * Calcula el resumen de conciliación de un extracto bancario.
   * Lectura sin $transaction.
   */
  async getReconciliationSummary(
    bankStatementId: string,
    companyId: string
  ): Promise<{
    total: number;
    reconciled: number;
    pending: number;
    difference: string;
  }> {
    const statement = await prisma.bankStatement.findFirst({
      where: {
        id: bankStatementId,
        bankAccount: { companyId },
        deletedAt: null,
      },
      include: {
        transactions: {
          where: { deletedAt: null },
          select: {
            amount: true,
            type: true,
            isReconciled: true,
          },
        },
      },
    });

    if (!statement) {
      throw new Error("El extracto bancario no existe o no pertenece a la empresa indicada");
    }

    const total = statement.transactions.length;
    const reconciled = statement.transactions.filter((t) => t.isReconciled).length;
    const pending = total - reconciled;

    // Calcular diferencia: closingBalance - (openingBalance + sum(credits) - sum(debits))
    let actual = new Decimal(statement.openingBalance.toString());
    for (const t of statement.transactions) {
      const amt = new Decimal(t.amount.toString());
      if (t.type === "CREDIT") {
        actual = actual.plus(amt);
      } else {
        actual = actual.minus(amt);
      }
    }
    const closing = new Decimal(statement.closingBalance.toString());
    const difference = closing.minus(actual);

    return {
      total,
      reconciled,
      pending,
      difference: difference.toFixed(4),
    };
  },
};
