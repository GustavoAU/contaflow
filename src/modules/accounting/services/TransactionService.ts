import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { CreateTransactionSchema, VoidTransactionSchema } from "../schemas/transaction.schema";
import type { CreateTransactionInput, VoidTransactionInput } from "../schemas/transaction.schema";

export class TransactionService {
  /**
   * Crea un asiento contable validando la regla de partida doble.
   * Convencion: positivo = Debito, negativo = Credito
   */
  static async createBalancedTransaction(input: CreateTransactionInput) {
    // 1. Validar con Zod
    const validated = CreateTransactionSchema.parse(input);

    // 2. Convertir debit/credit a amount
    // Convencion: Debito = positivo, Credito = negativo
    const entries = validated.entries.map((entry) => ({
      accountId: entry.accountId,
      amount:
        entry.debit && Number(entry.debit) > 0
          ? new Decimal(entry.debit)
          : new Decimal(entry.credit || "0").negated(),
    }));

    // 3. Validar que todas las cuentas existen
    const accountIds = entries.map((e) => e.accountId);
    const accounts = await prisma.account.findMany({
      where: { id: { in: accountIds } },
      select: { id: true },
    });

    if (accounts.length !== accountIds.length) {
      const foundIds = accounts.map((a) => a.id);
      const missing = accountIds.filter((id) => !foundIds.includes(id));
      throw new Error("Cuentas no encontradas: " + missing.join(", "));
    }

    // 4. Crear transaccion atomica
    const transaction = await prisma.transaction.create({
      data: {
        companyId: validated.companyId,
        userId: validated.userId,
        description: validated.description,
        reference: validated.reference,
        notes: validated.notes,
        date: validated.date ?? new Date(),
        type: validated.type,
        entries: {
          create: entries,
        },
      },
      include: {
        entries: { include: { account: true } },
      },
    });

    // 5. AuditLog
    await prisma.auditLog.create({
      data: {
        entityId: transaction.id,
        entityName: "Transaction",
        action: "CREATE",
        userId: validated.userId,
        newValue: transaction as object,
      },
    });

    return transaction;
  }

  /**
   * Anula un asiento contabilizado creando un asiento espejo con montos invertidos.
   * El asiento original queda con status VOIDED -- nunca se borra.
   */
  static async voidTransaction(input: VoidTransactionInput) {
    // 1. Validar con Zod
    const validated = VoidTransactionSchema.parse(input);

    // 2. Buscar la transaccion original
    const original = await prisma.transaction.findUnique({
      where: { id: validated.transactionId },
      include: { entries: true },
    });

    if (!original) {
      throw new Error("Transaccion no encontrada: " + validated.transactionId);
    }

    // 3. Verificar que no este ya anulada
    if (original.status === "VOIDED") {
      throw new Error("Esta transaccion ya fue anulada anteriormente");
    }

    // 4. Crear asiento de contrapartida y marcar original como VOIDED
    const [voidTransaction] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          companyId: original.companyId,
          userId: validated.userId,
          description: "ANULACION: " + original.description + " - " + validated.reason,
          reference: original.reference ?? undefined,
          date: new Date(),
          entries: {
            create: original.entries.map((entry) => ({
              accountId: entry.accountId,
              amount: new Decimal(entry.amount.toString()).negated(),
            })),
          },
        },
        include: {
          entries: { include: { account: true } },
        },
      }),
      prisma.transaction.update({
        where: { id: validated.transactionId },
        data: { status: "VOIDED" },
      }),
    ]);

    // 5. Vincular el asiento original con su contrapartida
    await prisma.transaction.update({
      where: { id: validated.transactionId },
      data: { voidedById: voidTransaction.id },
    });

    // 6. Registrar en AuditLog
    await prisma.auditLog.create({
      data: {
        entityId: original.id,
        entityName: "Transaction",
        action: "VOID",
        userId: validated.userId,
        oldValue: { status: "POSTED" },
        newValue: {
          status: "VOIDED",
          voidedById: voidTransaction.id,
          reason: validated.reason,
        },
      },
    });

    return voidTransaction;
  }

  /**
   * Obtiene todas las transacciones de una empresa,
   * ordenadas de mas reciente a mas antigua.
   */
  static async getTransactionsByCompany(companyId: string) {
    return prisma.transaction.findMany({
      where: { companyId },
      orderBy: { date: "desc" },
      include: {
        entries: {
          include: { account: true },
        },
      },
    });
  }
}
