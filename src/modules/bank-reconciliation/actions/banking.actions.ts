// src/modules/bank-reconciliation/actions/banking.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { BankingService } from "../services/BankingService";
import { CsvParserService } from "../services/CsvParserService";
import { BankAccountService } from "../services/BankAccountService";
import { CreateBankAccountSchema } from "../schemas/bank-account.schema";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ─── Schemas Zod ─────────────────────────────────────────────────────────────

const DecimalStringSchema = z.string().regex(/^-?\d+(\.\d{1,4})?$/, { error: "Monto inválido" });

const ImportStatementSchema = z.object({
  bankAccountId: z.string().min(1, { error: "ID de cuenta bancaria requerido" }),
  companyId: z.string().min(1, { error: "ID de empresa requerido" }),
  csvContent: z.string().min(1, { error: "Contenido CSV requerido" }),
  openingBalance: DecimalStringSchema,
  closingBalance: DecimalStringSchema,
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getAuthUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

async function verifyMembership(userId: string, companyId: string): Promise<boolean> {
  const member = await prisma.companyMember.findFirst({
    where: { userId, companyId },
  });
  return member !== null;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Crea una nueva cuenta bancaria.
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

    const isMember = await verifyMembership(userId, companyId);
    if (!isMember) {
      return { success: false, error: "No tienes permisos en esta empresa" };
    }

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    const account = await BankAccountService.create({ ...parsed.data, createdBy: userId });

    revalidatePath(`/company/${companyId}/bank-reconciliation`);

    return { success: true, data: { id: account.id, name: account.name } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al crear la cuenta bancaria";
    return { success: false, error: msg };
  }
}

/**
 * Importa un extracto bancario CSV.
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

    const { bankAccountId, companyId, csvContent, openingBalance, closingBalance } = parsed.data;

    const isMember = await verifyMembership(userId, companyId);
    if (!isMember) {
      return { success: false, error: "No tienes permisos en esta empresa" };
    }

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    // Parsear CSV
    const csvRows = CsvParserService.parseBankCsv(csvContent);

    // Importar extracto
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
    const msg = err instanceof Error ? err.message : "Error al importar el extracto";
    return { success: false, error: msg };
  }
}

/**
 * Concilia una transacción bancaria con un pago de factura.
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

    const isMember = await verifyMembership(userId, companyId);
    if (!isMember) {
      return { success: false, error: "No tienes permisos en esta empresa" };
    }

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
    const msg = err instanceof Error ? err.message : "Error al conciliar la transacción";
    return { success: false, error: msg };
  }
}

/**
 * Desconcilia una transacción bancaria.
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

    const isMember = await verifyMembership(userId, companyId);
    if (!isMember) {
      return { success: false, error: "No tienes permisos en esta empresa" };
    }

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    const updated = await BankingService.unreconcileTransaction(bankTransactionId, companyId, userId);

    revalidatePath(`/company/${companyId}/bank-reconciliation`);

    return { success: true, data: { id: updated.id, isReconciled: updated.isReconciled } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al desconciliar la transacción";
    return { success: false, error: msg };
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

    const isMember = await verifyMembership(userId, companyId);
    if (!isMember) {
      return { success: false, error: "No tienes permisos en esta empresa" };
    }

    const transactions = await BankingService.getUnreconciledTransactions(bankAccountId, companyId);

    // Serializar Decimal a string
    const serialized = transactions.map((t) => ({
      ...t,
      amount: new Decimal(t.amount.toString()).toFixed(4),
    }));

    return { success: true, data: serialized };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al obtener transacciones";
    return { success: false, error: msg };
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

    const isMember = await verifyMembership(userId, companyId);
    if (!isMember) {
      return { success: false, error: "No tienes permisos en esta empresa" };
    }

    const summary = await BankingService.getReconciliationSummary(bankStatementId, companyId);

    return { success: true, data: summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al obtener el resumen";
    return { success: false, error: msg };
  }
}
