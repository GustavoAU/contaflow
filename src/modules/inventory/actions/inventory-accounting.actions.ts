// src/modules/inventory/actions/inventory-accounting.actions.ts
"use server";
// Dominio ACCOUNTANT — aprobar movimientos DRAFT→POSTED, anular POSTED→VOIDED
// HIGH-2: ADMINISTRATIVE no puede alcanzar estas acciones

import prisma from "@/lib/prisma";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { revalidatePath } from "next/cache";
import { PostMovementSchema, VoidMovementSchema } from "../schemas/inventory-movement.schema";
import {
  postMovement,
  voidPostedMovement,
  getInventoryValuation,
  getPendingMovements,
} from "../services/InventoryAccountingService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── Contabilizar movimiento (DRAFT → POSTED) ─────────────────────────────────

export async function postMovementAction(
  input: unknown
): Promise<ActionResult<{ movementId: string; transactionId: string }>> {
  const parsed = PostMovementSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  // HIGH-2: ADMINISTRATIVE no puede contabilizar — solo ACCOUNTING
  const ctx = await requireCompanyAction(parsed.data.companyId, {
    roles: ROLES.ACCOUNTING,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  try {
    const result = await postMovement(parsed.data, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${parsed.data.companyId}/inventory`);
    return {
      success: true,
      data: {
        movementId: result.movement.id,
        transactionId: result.transaction.id,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Anular movimiento POSTED (POSTED → VOIDED) ───────────────────────────────

export async function voidPostedMovementAction(
  input: unknown
): Promise<ActionResult<boolean>> {
  const parsed = VoidMovementSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  // HIGH-2: solo ACCOUNTING puede anular movimientos contabilizados
  const ctx = await requireCompanyAction(parsed.data.companyId, {
    roles: ROLES.ACCOUNTING,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  try {
    await voidPostedMovement(parsed.data, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${parsed.data.companyId}/inventory`);
    return { success: true, data: true };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Consultas ────────────────────────────────────────────────────────────────

export async function getInventoryValuationAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof getInventoryValuation>>>> {
  // Valoración visible para ACCOUNTING y OPERATIONS
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS });
  if (!ctx.ok) return ctx.error;

  try {
    const valuation = await getInventoryValuation(companyId);
    return { success: true, data: valuation };
  } catch (error) {
    return toActionError(error);
  }
}

export async function getPendingMovementsAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof getPendingMovements>>>> {
  // ACCOUNTING ve los pending para aprobarlos
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

  try {
    const movements = await getPendingMovements(companyId);
    return { success: true, data: movements };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Lotes disponibles para SALIDA (FEFO order) ───────────────────────────────

export async function getAvailableLotsAction(
  companyId: string,
  itemId: string
): Promise<ActionResult<Array<{ id: string; lotNumber: string; quantityOnHand: string; expiresAt: string | null }>>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

  const lots = await prisma.inventoryLot.findMany({
    where: { companyId, itemId, quantityOnHand: { gt: 0 } },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, lotNumber: true, quantityOnHand: true, expiresAt: true },
  });

  return {
    success: true,
    data: lots.map((l) => ({
      id: l.id,
      lotNumber: l.lotNumber,
      quantityOnHand: l.quantityOnHand.toString(),
      expiresAt: l.expiresAt?.toISOString() ?? null,
    })),
  };
}

// ─── Seriales disponibles para SALIDA ────────────────────────────────────────

export async function getAvailableSerialsAction(
  companyId: string,
  itemId: string
): Promise<ActionResult<Array<{ id: string; serialNumber: string }>>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

  const serials = await prisma.inventorySerial.findMany({
    where: { companyId, itemId, status: "AVAILABLE" },
    orderBy: { serialNumber: "asc" },
    select: { id: true, serialNumber: true },
  });

  return { success: true, data: serials };
}
