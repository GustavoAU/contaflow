"use server";

import { revalidatePath } from "next/cache";
import { TransactionService } from "../services/TransactionService";
import { CreateTransactionSchema, VoidTransactionSchema } from "../schemas/transaction.schema";
import { z } from "zod";

// ─── Tipo de respuesta estandar ───────────────────────────────────────────────
// Todos los actions retornan este tipo -- nunca lanzan excepciones al cliente

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// ─── Crear Transaccion ────────────────────────────────────────────────────────

export async function createTransactionAction(
  input: z.infer<typeof CreateTransactionSchema>
): Promise<ActionResult<{ id: string; description: string }>> {
  try {
    const transaction = await TransactionService.createBalancedTransaction(input);

    // Revalidar las paginas que muestran transacciones
    revalidatePath("/accounting/transactions");

    return {
      success: true,
      data: {
        id: transaction.id,
        description: transaction.description,
      },
    };
  } catch (error) {
    // Errores de validacion Zod -- mostrar por campo
    if (error instanceof z.ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const path = issue.path.join(".");
        if (!fieldErrors[path]) fieldErrors[path] = [];
        fieldErrors[path].push(issue.message);
      }
      return { success: false, error: "Datos invalidos", fieldErrors };
    }

    // Errores de negocio (partida doble, cuenta no encontrada, etc.)
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }

    return { success: false, error: "Error inesperado al crear la transaccion" };
  }
}

// ─── Anular Transaccion ───────────────────────────────────────────────────────

export async function voidTransactionAction(
  input: z.infer<typeof VoidTransactionSchema>
): Promise<ActionResult<{ id: string }>> {
  try {
    const voided = await TransactionService.voidTransaction(input);

    revalidatePath("/accounting/transactions");

    return {
      success: true,
      data: { id: voided.id },
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: "Datos invalidos" };
    }

    if (error instanceof Error) {
      return { success: false, error: error.message };
    }

    return { success: false, error: "Error inesperado al anular la transaccion" };
  }
}

// ─── Obtener Transacciones ────────────────────────────────────────────────────

export async function getTransactionsByCompanyAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof TransactionService.getTransactionsByCompany>>>> {
  try {
    if (!companyId) {
      return { success: false, error: "Company ID es requerido" };
    }

    const transactions = await TransactionService.getTransactionsByCompany(companyId);

    return { success: true, data: transactions };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }

    return { success: false, error: "Error al obtener las transacciones" };
  }
}
