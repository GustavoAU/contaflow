// src/modules/accounting/actions/transaction.actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TransactionService } from "../services/TransactionService";
import { CreateTransactionSchema, VoidTransactionSchema } from "../schemas/transaction.schema";

// ─── Tipo de respuesta estandar ───────────────────────────────────────────────

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// ─── Crear asiento ────────────────────────────────────────────────────────────

export async function createTransactionAction(
  input: z.infer<typeof CreateTransactionSchema>
): Promise<ActionResult<{ id: string; number: string }>> {
  try {
    const transaction = await TransactionService.createBalancedTransaction(input);

    revalidatePath(`/company/${input.companyId}/transactions`);

    return {
      success: true,
      data: { id: transaction.id, number: transaction.number },
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const path = issue.path.join(".");
        if (!fieldErrors[path]) fieldErrors[path] = [];
        fieldErrors[path].push(issue.message);
      }
      return { success: false, error: "Datos invalidos", fieldErrors };
    }
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado al crear el asiento" };
  }
}

// ─── Anular asiento ───────────────────────────────────────────────────────────

export async function voidTransactionAction(
  input: z.infer<typeof VoidTransactionSchema>
): Promise<ActionResult<{ id: string; number: string }>> {
  try {
    const transaction = await TransactionService.voidTransaction(input);

    revalidatePath(`/company`);

    return {
      success: true,
      data: { id: transaction.id, number: transaction.number },
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const path = issue.path.join(".");
        if (!fieldErrors[path]) fieldErrors[path] = [];
        fieldErrors[path].push(issue.message);
      }
      return { success: false, error: "Datos invalidos", fieldErrors };
    }
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado al anular el asiento" };
  }
}

// ─── Obtener asientos por empresa ─────────────────────────────────────────────

export async function getTransactionsByCompanyAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof TransactionService.getTransactionsByCompany>>>> {
  try {
    if (!companyId) return { success: false, error: "Company ID es requerido" };

    const transactions = await TransactionService.getTransactionsByCompany(companyId);

    return { success: true, data: transactions };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener los asientos" };
  }
}
