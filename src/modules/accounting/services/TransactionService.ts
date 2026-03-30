// src/modules/accounting/services/TransactionService.ts
import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { CreateTransactionSchema, VoidTransactionSchema } from "../schemas/transaction.schema";
import type { CreateTransactionInput, VoidTransactionInput } from "../schemas/transaction.schema";

export class TransactionService {
  /**
   * Genera el numero correlativo automatico para un asiento.
   * Formato: YYYY-MM-XXXXXX (ej: 2026-03-000001)
   * Es unico por empresa y por mes.
   */
  static async generateTransactionNumber(companyId: string, date: Date): Promise<string> {
    const year = date.getFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const prefix = `${year}-${month}-`;

    // Buscar el ultimo numero del mes para esta empresa
    const last = await prisma.transaction.findFirst({
      where: {
        companyId,
        number: { startsWith: prefix },
      },
      orderBy: { number: "desc" },
      select: { number: true },
    });

    let sequence = 1;
    if (last) {
      // Extraer el numero secuencial del ultimo asiento
      const lastSequence = parseInt(last.number.replace(prefix, ""), 10);
      sequence = lastSequence + 1;
    }

    return `${prefix}${String(sequence).padStart(6, "0")}`;
  }

  /**
   * Crea un asiento contable validando la regla de partida doble.
   * Convencion: Debito = positivo, Credito = negativo
   */
  static async createBalancedTransaction(input: CreateTransactionInput) {
    // 1. Validar con Zod — incluye validacion de partida doble
    const validated = CreateTransactionSchema.parse(input);

    // 2. Convertir debit/credit a amount
    const entries = validated.entries.map((entry) => ({
      accountId: entry.accountId,
      amount:
        entry.debit && Number(entry.debit) > 0
          ? new Decimal(entry.debit)
          : new Decimal(entry.credit || "0").negated(),
    }));

    // 3. Validar que todas las cuentas existen y pertenecen a la empresa
    const accountIds = entries.map((e) => e.accountId);
    const accounts = await prisma.account.findMany({
      where: {
        id: { in: accountIds },
        companyId: validated.companyId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (accounts.length !== accountIds.length) {
      const foundIds = accounts.map((a) => a.id);
      const missing = accountIds.filter((id) => !foundIds.includes(id));
      throw new Error(
        "Cuentas no encontradas o no pertenecen a esta empresa: " + missing.join(", ")
      );
    }

    // 4. Verificar que hay un período abierto
    const activePeriod = await prisma.accountingPeriod.findFirst({
      where: { companyId: validated.companyId, status: "OPEN" },
    });

    if (!activePeriod) {
      throw new Error(
        "No hay período contable abierto. Abre un período en Configuración antes de registrar asientos."
      );
    }

    // 5. Generar numero correlativo
    const date = validated.date ?? new Date();
    const number = await TransactionService.generateTransactionNumber(validated.companyId, date);

    // 6. Crear transaccion + AuditLog de forma atómica
    const transaction = await prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          number,
          companyId: validated.companyId,
          userId: validated.userId,
          description: validated.description,
          reference: validated.reference,
          notes: validated.notes,
          date,
          type: validated.type,
          periodId: activePeriod.id,
          entries: {
            create: entries,
          },
        },
        include: {
          entries: { include: { account: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          entityId: created.id,
          entityName: "Transaction",
          action: "CREATE",
          userId: validated.userId,
          newValue: created as object,
        },
      });

      return created;
    });

    return transaction;
  }

  /**
   * Anula un asiento contabilizado creando un asiento espejo con montos invertidos.
   * El asiento original queda con status VOIDED — nunca se borra.
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

    // 4. Generar numero para el asiento de anulacion
    const voidDate = new Date();
    const voidNumber = await TransactionService.generateTransactionNumber(
      original.companyId,
      voidDate
    );

    // 5. Crear asiento de contrapartida y marcar original como VOIDED
    const voidTransaction = await prisma.$transaction(async (tx) => {
      // Crear asiento espejo con montos invertidos
      const voidTx = await tx.transaction.create({
        data: {
          number: voidNumber,
          companyId: original.companyId,
          userId: validated.userId,
          description: "ANULACION: " + original.description + " — " + validated.reason,
          reference: original.reference ?? undefined,
          date: voidDate,
          type: original.type,
          status: "POSTED",
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
      });

      // Marcar original como VOIDED y vincular con el asiento de anulacion
      await tx.transaction.update({
        where: { id: original.id },
        data: {
          status: "VOIDED",
          voidedById: voidTx.id,
        },
      });

      // 6. AuditLog dentro del mismo $transaction
      await tx.auditLog.create({
        data: {
          entityId: original.id,
          entityName: "Transaction",
          action: "VOID",
          userId: validated.userId,
          oldValue: original as object,
          newValue: voidTx as object,
        },
      });

      return voidTx;
    });

    return voidTransaction;
  }

  /**
   * Obtiene todas las transacciones de una empresa ordenadas por fecha.
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
