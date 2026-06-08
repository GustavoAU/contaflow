// src/modules/bank-reconciliation/actions/banking.actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { MAX_INVOICE_AMOUNT } from "@/lib/fiscal-validators";
import { BankingService } from "../services/BankingService";
import { BankReconciliationService } from "../services/BankReconciliationService";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { CsvParserService } from "../services/CsvParserService";
import { BankAccountService } from "../services/BankAccountService";
import { CreateBankAccountSchema } from "../schemas/bank-account.schema";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";
import { getAuthUserId, getMemberRole } from "../utils/bank-action-guard";

// ─── Schemas Zod ─────────────────────────────────────────────────────────────

const DecimalStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,4})?$/, { error: "Monto inválido" })
  .refine(
    (v) => new Decimal(v).abs().lte(new Decimal(MAX_INVOICE_AMOUNT)),
    { message: "Monto excede el límite permitido" }
  );

const ColumnMapSchema = z
  .object({
    date: z.number().int().min(0),
    description: z.number().int().min(0),
    debit: z.number().int().min(0),
    credit: z.number().int().min(0),
    balance: z.number().int().min(0).optional(),
  })
  .optional();

const ImportStatementSchema = z.object({
  bankAccountId: z.string().min(1, { error: "ID de cuenta bancaria requerido" }),
  companyId: z.string().min(1, { error: "ID de empresa requerido" }),
  csvContent: z.string().min(1, { error: "Contenido CSV requerido" }),
  openingBalance: DecimalStringSchema,
  closingBalance: DecimalStringSchema,
  columnMap: ColumnMapSchema,
});

const ReconcileTransactionSchema = z.object({
  bankTransactionId: z.string().min(1, { error: "ID de transacción requerido" }),
  invoicePaymentId: z.string().min(1, { error: "ID de pago requerido" }),
  companyId: z.string().min(1, { error: "ID de empresa requerido" }),
});

const UnreconcileTransactionSchema = z.object({
  bankTransactionId: z.string().min(1, { error: "ID de transacción requerido" }),
  companyId: z.string().min(1, { error: "ID de empresa requerido" }),
});

const GetUnreconciledSchema = z.object({
  bankAccountId: z.string().min(1, { error: "ID de cuenta bancaria requerido" }),
  companyId: z.string().min(1, { error: "ID de empresa requerido" }),
});

const GetSummarySchema = z.object({
  bankStatementId: z.string().min(1, { error: "ID de extracto requerido" }),
  companyId: z.string().min(1, { error: "ID de empresa requerido" }),
});

const MatchBankTransactionSchema = z.object({
  bankTransactionId: z.string().min(1, { error: "ID de transacción requerido" }),
  companyId: z.string().min(1, { error: "ID de empresa requerido" }),
  matchType: z.enum(["INVOICE_PAYMENT", "JOURNAL_ENTRY", "PAYMENT_RECORD"]),
  targetId: z.string().min(1, { error: "ID de contrapartida requerido" }),
});

const SearchJournalEntriesSchema = z.object({
  companyId: z.string().min(1),
  query: z.string().optional(),
});

const SearchPaymentRecordsSchema = z.object({
  companyId: z.string().min(1),
  method: z.string().optional(),
});

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Crea una nueva cuenta bancaria. Requiere role ADMIN (configuración de empresa).
 */
export async function createBankAccountAction(
  input: unknown
): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const userId = await getAuthUserId();
    if (!userId) return { success: false, error: "No autorizado" };

    const parsed = CreateBankAccountSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
    }

    const { companyId } = parsed.data;

    const role = await getMemberRole(userId, companyId);
    if (!role) return { success: false, error: "No tienes permisos en esta empresa" };
    if (!canAccess(role, ROLES.ADMIN_ONLY)) return { success: false, error: "No autorizado para esta operación" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    const account = await BankAccountService.create({ ...parsed.data, createdBy: userId });

    revalidatePath(`/company/${companyId}/bank-reconciliation`);

    return { success: true, data: { id: account.id, name: account.name } };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * Importa un extracto bancario CSV. Requiere role ACCOUNTANT o ADMIN.
 */
export async function importStatementAction(
  input: unknown
): Promise<ActionResult<{ statementId: string; transactionCount: number }>> {
  try {
    const userId = await getAuthUserId();
    if (!userId) return { success: false, error: "No autorizado" };

    const parsed = ImportStatementSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
    }

    const { bankAccountId, companyId, csvContent, openingBalance, closingBalance, columnMap } = parsed.data;

    const role = await getMemberRole(userId, companyId);
    if (!role) return { success: false, error: "No tienes permisos en esta empresa" };
    if (!canAccess(role, ROLES.ACCOUNTING)) return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    const csvRows = CsvParserService.parseBankCsv(csvContent, columnMap);

    const result = await BankingService.importStatement(
      bankAccountId,
      companyId,
      csvRows,
      new Decimal(openingBalance),
      new Decimal(closingBalance),
      userId
    );

    revalidatePath(`/company/${companyId}/bank-reconciliation`);

    return { success: true, data: result };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * Concilia una transacción bancaria con un pago de factura. Requiere role ACCOUNTANT o ADMIN.
 */
export async function reconcileTransactionAction(
  input: unknown
): Promise<ActionResult<{ id: string; isReconciled: boolean }>> {
  try {
    const userId = await getAuthUserId();
    if (!userId) return { success: false, error: "No autorizado" };

    const parsed = ReconcileTransactionSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
    }

    const { bankTransactionId, invoicePaymentId, companyId } = parsed.data;

    const role = await getMemberRole(userId, companyId);
    if (!role) return { success: false, error: "No tienes permisos en esta empresa" };
    if (!canAccess(role, ROLES.ACCOUNTING)) return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    const updated = await BankingService.reconcileTransaction(
      bankTransactionId,
      invoicePaymentId,
      companyId,
      userId
    );

    revalidatePath(`/company/${companyId}/bank-reconciliation`);

    return { success: true, data: { id: updated.id, isReconciled: updated.isReconciled } };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * Desconcilia una transacción bancaria. Requiere role ADMIN (operación destructiva reversible).
 */
export async function unreconcileTransactionAction(
  input: unknown
): Promise<ActionResult<{ id: string; isReconciled: boolean }>> {
  try {
    const userId = await getAuthUserId();
    if (!userId) return { success: false, error: "No autorizado" };

    const parsed = UnreconcileTransactionSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
    }

    const { bankTransactionId, companyId } = parsed.data;

    const role = await getMemberRole(userId, companyId);
    if (!role) return { success: false, error: "No tienes permisos en esta empresa" };
    if (!canAccess(role, ROLES.ADMIN_ONLY)) return { success: false, error: "No autorizado para esta operación" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    const updated = await BankingService.unreconcileTransaction(bankTransactionId, companyId, userId);

    revalidatePath(`/company/${companyId}/bank-reconciliation`);

    return { success: true, data: { id: updated.id, isReconciled: updated.isReconciled } };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * Obtiene las transacciones sin conciliar de una cuenta bancaria.
 * Serializa Decimal a string antes de retornar.
 */
export async function getUnreconciledTransactionsAction(
  input: unknown
): Promise<ActionResult<Array<Record<string, unknown>>>> {
  try {
    const userId = await getAuthUserId();
    if (!userId) return { success: false, error: "No autorizado" };

    const parsed = GetUnreconciledSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
    }

    const { bankAccountId, companyId } = parsed.data;

    const role = await getMemberRole(userId, companyId);
    if (!role) return { success: false, error: "No tienes permisos en esta empresa" };
    if (!canAccess(role, ROLES.ACCOUNTING)) return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

    const transactions = await BankingService.getUnreconciledTransactions(bankAccountId, companyId);

    // Serializar Decimal a string
    const serialized = transactions.map((t) => ({
      ...t,
      amount: new Decimal(t.amount.toString()).toFixed(4),
    }));

    return { success: true, data: serialized };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * Concilia una transacción bancaria con cualquier tipo de contrapartida:
 * INVOICE_PAYMENT | JOURNAL_ENTRY | PAYMENT_RECORD.
 * Requiere role ACCOUNTANT o ADMIN.
 */
export async function matchBankTransactionAction(
  input: unknown
): Promise<ActionResult<{ id: string; isReconciled: boolean }>> {
  try {
    const userId = await getAuthUserId();
    if (!userId) return { success: false, error: "No autorizado" };

    const parsed = MatchBankTransactionSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
    }

    const { bankTransactionId, companyId, matchType, targetId } = parsed.data;

    const role = await getMemberRole(userId, companyId);
    if (!role) return { success: false, error: "No tienes permisos en esta empresa" };
    if (!canAccess(role, ROLES.ACCOUNTING)) return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    const updated = await BankReconciliationService.matchTransaction(
      bankTransactionId,
      { type: matchType, id: targetId },
      companyId,
      userId
    );

    revalidatePath(`/company/${companyId}/bank-reconciliation`);

    return { success: true, data: { id: updated.id, isReconciled: updated.isReconciled } };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * Busca asientos contables (Transaction) para conciliación bancaria tipo JOURNAL_ENTRY.
 * Filtra por companyId y query opcional (número o descripción).
 */
export async function searchJournalEntriesAction(
  input: unknown
): Promise<ActionResult<Array<{ id: string; number: string; date: string; description: string }>>> {
  try {
    const userId = await getAuthUserId();
    if (!userId) return { success: false, error: "No autorizado" };

    const parsed = SearchJournalEntriesSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
    }

    const { companyId, query } = parsed.data;

    const role = await getMemberRole(userId, companyId);
    if (!role) return { success: false, error: "No tienes permisos en esta empresa" };
    if (!canAccess(role, ROLES.ACCOUNTING)) return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

    const entries = await prisma.transaction.findMany({
      where: {
        companyId,
        status: "POSTED" as const,
        ...(query
          ? {
              OR: [
                { number: { contains: query, mode: "insensitive" as const } },
                { description: { contains: query, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ date: "desc" }],
      take: 30,
      select: { id: true, number: true, date: true, description: true },
    });

    const serialized = entries.map((e) => ({
      id: e.id,
      number: e.number,
      date: e.date.toISOString(),
      description: e.description,
    }));

    return { success: true, data: serialized };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * Busca registros de pago (PaymentRecord) para conciliación bancaria tipo PAYMENT_RECORD.
 * Filtra por companyId y método opcional.
 */
export async function searchPaymentRecordsAction(
  input: unknown
): Promise<
  ActionResult<
    Array<{
      id: string;
      method: string;
      amountVes: string;
      currency: string;
      amountOriginal: string | null;
      referenceNumber: string | null;
      date: string;
    }>
  >
> {
  try {
    const userId = await getAuthUserId();
    if (!userId) return { success: false, error: "No autorizado" };

    const parsed = SearchPaymentRecordsSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
    }

    const { companyId, method } = parsed.data;

    const role = await getMemberRole(userId, companyId);
    if (!role) return { success: false, error: "No tienes permisos en esta empresa" };
    if (!canAccess(role, ROLES.ACCOUNTING)) return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

    const records = await prisma.paymentRecord.findMany({
      where: {
        companyId,
        ...(method ? { method: method as never } : {}),
      },
      orderBy: [{ date: "desc" }],
      take: 30,
      select: {
        id: true,
        method: true,
        amountVes: true,
        currency: true,
        amountOriginal: true,
        referenceNumber: true,
        date: true,
      },
    });

    const serialized = records.map((r) => ({
      id: r.id,
      method: r.method,
      amountVes: new Decimal(r.amountVes.toString()).toFixed(2),
      currency: r.currency,
      amountOriginal: r.amountOriginal
        ? new Decimal(r.amountOriginal.toString()).toFixed(2)
        : null,
      referenceNumber: r.referenceNumber,
      date: r.date.toISOString(),
    }));

    return { success: true, data: serialized };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * Obtiene el resumen de conciliación de un extracto bancario.
 */
export async function getReconciliationSummaryAction(
  input: unknown
): Promise<
  ActionResult<{ total: number; reconciled: number; pending: number; difference: string }>
> {
  try {
    const userId = await getAuthUserId();
    if (!userId) return { success: false, error: "No autorizado" };

    const parsed = GetSummarySchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
    }

    const { bankStatementId, companyId } = parsed.data;

    const role = await getMemberRole(userId, companyId);
    if (!role) return { success: false, error: "No tienes permisos en esta empresa" };
    if (!canAccess(role, ROLES.ACCOUNTING)) return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

    const summary = await BankingService.getReconciliationSummary(bankStatementId, companyId);

    return { success: true, data: summary };
  } catch (err) {
    return toActionError(err);
  }
}
