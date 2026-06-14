// src/modules/accounting/actions/transaction.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { TransactionService } from "../services/TransactionService";
import type { TransactionPage } from "../services/TransactionService";
import { MAX_PAGE_SIZE } from "../constants";
import { CreateTransactionSchema, VoidTransactionSchema } from "../schemas/transaction.schema";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { hasModuleAccess, moduleAccessError } from "@/lib/module-access";
import { withPeriodCache, invalidatePeriod } from "@/lib/report-cache";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";
import { extractRequestContext } from "../utils/request-context";

// ─── Crear asiento ────────────────────────────────────────────────────────────

export async function createTransactionAction(
  input: z.infer<typeof CreateTransactionSchema>
): Promise<ActionResult<{ id: string; number: string }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: input.companyId } },
    });
    if (!member) return { success: false, error: "Empresa no encontrada" };
    // ADR-025: verifica acceso base + grants granulares al módulo Contabilidad
    if (!await hasModuleAccess(input.companyId, member.role, "accounting")) {
      return { success: false, error: moduleAccessError("accounting") };
    }

    const { ipAddress, userAgent } = await extractRequestContext();

    const transaction = await TransactionService.createBalancedTransaction(
      { ...input, userId },
      ipAddress,
      userAgent,
    );

    revalidatePath(`/company/${input.companyId}/transactions`);

    return {
      success: true,
      data: { id: transaction.id, number: transaction.number },
    };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Anular asiento ───────────────────────────────────────────────────────────

export async function voidTransactionAction(
  input: z.infer<typeof VoidTransactionSchema>
): Promise<ActionResult<{ id: string; number: string }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    // Fetch companyId to check membership (VoidTransactionSchema only has transactionId)
    const existing = await prisma.transaction.findUnique({
      where: { id: input.transactionId },
      select: { companyId: true },
    });
    if (!existing) return { success: false, error: "Asiento no encontrado" };

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: existing.companyId } },
    });
    if (!member) return { success: false, error: "Empresa no encontrada" };
    // ADR-025: verifica acceso base + grants granulares al módulo Contabilidad
    if (!await hasModuleAccess(existing.companyId, member.role, "accounting")) {
      return { success: false, error: moduleAccessError("accounting") };
    }
    // Anular asiento requiere ADMIN_ONLY (más estricto que acceso al módulo)
    if (!canAccess(member.role, ROLES.ADMIN_ONLY)) return { success: false, error: "Anular asientos requiere rol Administrador o Propietario" };

    const { ipAddress, userAgent } = await extractRequestContext();

    const transaction = await TransactionService.voidTransaction(
      { ...input, userId },
      existing.companyId,
      ipAddress,
      userAgent
    );

    revalidatePath(`/company`);

    return {
      success: true,
      data: { id: transaction.id, number: transaction.number },
    };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Obtener asientos por empresa ─────────────────────────────────────────────

export async function getTransactionsByCompanyAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof TransactionService.getTransactionsByCompany>>>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    if (!companyId) return { success: false, error: "Company ID es requerido" };

    const rl = await checkRateLimit(userId, limiters.read);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!member || !canAccess(member.role, ROLES.ALL)) {
      return { success: false, error: "No autorizado" };
    }

    const transactions = await TransactionService.getTransactionsByCompany(companyId);

    return { success: true, data: transactions };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Obtener asientos paginados (cursor-based) ────────────────────────────────

export async function getTransactionsPaginatedAction(
  companyId: string,
  cursor?: string,
  limit: number = MAX_PAGE_SIZE
): Promise<ActionResult<TransactionPage>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    if (!companyId) return { success: false, error: "Company ID es requerido" };

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!member || !canAccess(member.role, ROLES.ALL)) {
      return { success: false, error: "No autorizado" };
    }

    const page = await TransactionService.getTransactionsPaginated(companyId, cursor, limit);
    return { success: true, data: page };
  } catch (error) {
    return toActionError(error);
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
  limit: number = MAX_PAGE_SIZE
): Promise<ActionResult<TransactionPage>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    if (!companyId) return { success: false, error: "Company ID es requerido" };
    if (!periodId) return { success: false, error: "Period ID es requerido" };
    // Role intent: ROLES.ALL — cualquier miembro autenticado puede leer el libro diario.
    // VIEWER y ADMINISTRATIVE necesitan ver los asientos aunque no puedan crearlos.
    const member = await prisma.companyMember.findFirst({
      where: { userId, companyId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "No autorizado" };

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
    return toActionError(error);
  }
}

// ─── Invalidar cache de período (llamar al reabrir un período) ────────────────

/**
 * Invalida el cache en memoria para un período específico.
 * Debe llamarse cuando un período CLOSED se reabre (caso excepcional).
 * No requiere auth — el control de acceso para reabrir período está en PeriodService.
 * Exportado para uso desde PeriodService o acciones de cierre/reapertura.
 */
export async function invalidatePeriodCache(companyId: string, periodId: string): Promise<void> {
  invalidatePeriod(companyId, periodId);
}

// ─── Obtener detalle de un asiento ────────────────────────────────────────────

export async function getTransactionByIdAction(
  companyId: string,
  transactionId: string
): Promise<ActionResult<{
  id: string;
  number: string;
  date: string;
  description: string;
  reference: string | null;
  notes: string | null;
  type: string;
  status: string;
  entries: { id: string; amount: string; account: { id: string; code: string; name: string; type: string } }[];
}>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "No autorizado" };

    // Acepta tanto el CUID (id) como el número legible (ej: T-2026-003)
    // para que URLs compartidas por número no arrojen 404.
    const tx = await prisma.transaction.findFirst({
      where: { companyId, OR: [{ id: transactionId }, { number: transactionId }] },
      select: {
        id: true,
        number: true,
        date: true,
        description: true,
        reference: true,
        notes: true,
        type: true,
        status: true,
        entries: {
          select: {
            id: true,
            amount: true,
            account: { select: { id: true, code: true, name: true, type: true } },
          },
          orderBy: { amount: "desc" },
        },
      },
    });

    if (!tx) return { success: false, error: "Asiento no encontrado" };

    return {
      success: true,
      data: {
        ...tx,
        date: tx.date.toISOString(),
        entries: tx.entries.map((e) => ({ ...e, amount: e.amount.toString() })),
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}
