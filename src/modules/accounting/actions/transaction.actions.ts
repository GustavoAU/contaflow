// src/modules/accounting/actions/transaction.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { TransactionService } from "../services/TransactionService";
import type { TransactionPage } from "../services/TransactionService";
import { CreateTransactionSchema, VoidTransactionSchema } from "../schemas/transaction.schema";
import { withPeriodCache, invalidatePeriod } from "@/lib/report-cache";

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

// ─── Obtener asientos paginados (cursor-based) ────────────────────────────────

export async function getTransactionsPaginatedAction(
  companyId: string,
  cursor?: string,
  limit: number = 50
): Promise<ActionResult<TransactionPage>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  if (!companyId) return { success: false, error: "Company ID es requerido" };

  try {
    const page = await TransactionService.getTransactionsPaginated(companyId, cursor, limit);
    return { success: true, data: page };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener los asientos" };
  }
}

// ─── Obtener asientos por período (con cache para períodos CERRADOS) ──────────

/**
 * Retorna asientos paginados filtrados por período contable.
 * Aplica cache en memoria para períodos CERRADOS (inmutables).
 * Períodos OPEN se calculan siempre en tiempo real.
 *
 * Nota: el cache es por página (cursor + limit). Si el caller itera todas las
 * páginas de un período cerrado, cada combinación (cursor, limit) se cachea
 * independientemente. Esto es correcto — la inmutabilidad garantiza que los
 * cursores del período cerrado no cambiarán.
 */
export async function getTransactionsByPeriodAction(
  companyId: string,
  periodId: string,
  cursor?: string,
  limit: number = 50
): Promise<ActionResult<TransactionPage>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  if (!companyId) return { success: false, error: "Company ID es requerido" };
  if (!periodId) return { success: false, error: "Period ID es requerido" };

  try {
    // Verificar membresía y obtener estado del período en un solo query (ADR-004)
    const period = await prisma.accountingPeriod.findFirst({
      where: { id: periodId, companyId },
      select: { id: true, status: true },
    });

    if (!period) {
      return { success: false, error: "Período no encontrado o no pertenece a esta empresa" };
    }

    // Cache key incluye cursor y limit para manejar correctamente la paginación
    const reportType = `transactions:cursor=${cursor ?? ""}:limit=${limit}`;

    const page = await withPeriodCache(
      companyId,
      periodId,
      period.status,
      reportType,
      () => TransactionService.listTransactions({ companyId, periodId, cursor, limit })
    );

    return { success: true, data: page };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener los asientos del período" };
  }
}

// ─── Invalidar cache de período (llamar al reabrir un período) ────────────────

/**
 * Invalida el cache en memoria para un período específico.
 * Debe llamarse cuando un período CLOSED se reabre (caso excepcional).
 * No requiere auth — el control de acceso para reabrir período está en PeriodService.
 * Exportado para uso desde PeriodService o acciones de cierre/reapertura.
 */
export function invalidatePeriodCache(companyId: string, periodId: string): void {
  invalidatePeriod(companyId, periodId);
}
