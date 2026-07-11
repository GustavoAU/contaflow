// src/modules/inventory/actions/inventory-operations.actions.ts
"use server";
// Dominio ADMINISTRATIVE — crear/editar ítems, registrar movimientos DRAFT, anular DRAFT

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { limiters } from "@/lib/ratelimit";
import {
  CreateInventoryItemSchema,
  UpdateInventoryItemSchema,
} from "../schemas/inventory-item.schema";
import { CreateMovementSchema, VoidMovementSchema } from "../schemas/inventory-movement.schema";
import {
  createInventoryItem,
  updateInventoryItem,
  softDeleteInventoryItem,
  createDraftMovement,
  voidDraftMovement,
  getInventoryItems,
  getDraftMovements,
  getItemMovements,
} from "../services/InventoryOperationsService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── Crear ítem ───────────────────────────────────────────────────────────────

export async function createInventoryItemAction(
  input: unknown
): Promise<ActionResult<string>> {
  const parsed = CreateInventoryItemSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  const ctx = await requireCompanyAction(parsed.data.companyId, {
    roles: ROLES.OPERATIONS,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  try {
    const item = await createInventoryItem(parsed.data, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${parsed.data.companyId}/inventory`);
    return { success: true, data: item.id };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Actualizar ítem ──────────────────────────────────────────────────────────

export async function updateInventoryItemAction(
  input: unknown
): Promise<ActionResult<string>> {
  const parsed = UpdateInventoryItemSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  const ctx = await requireCompanyAction(parsed.data.companyId, {
    roles: ROLES.OPERATIONS,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  try {
    const item = await updateInventoryItem(parsed.data, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${parsed.data.companyId}/inventory`);
    return { success: true, data: item.id };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Soft-delete ítem ─────────────────────────────────────────────────────────

export async function softDeleteInventoryItemAction(
  companyId: string,
  itemId: string
): Promise<ActionResult<boolean>> {
  // Solo ADMIN/OWNER pueden eliminar
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  try {
    await softDeleteInventoryItem(itemId, companyId, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${companyId}/inventory`);
    return { success: true, data: true };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Registrar movimiento (→ DRAFT) ──────────────────────────────────────────

export async function createMovementAction(
  input: unknown
): Promise<ActionResult<string>> {
  const parsed = CreateMovementSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  const ctx = await requireCompanyAction(parsed.data.companyId, {
    roles: ROLES.OPERATIONS,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  try {
    const movement = await createDraftMovement(parsed.data, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${parsed.data.companyId}/inventory`);
    return { success: true, data: movement.id };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Anular movimiento DRAFT ──────────────────────────────────────────────────

export async function voidDraftMovementAction(
  input: unknown
): Promise<ActionResult<boolean>> {
  const parsed = VoidMovementSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  const ctx = await requireCompanyAction(parsed.data.companyId, {
    roles: ROLES.OPERATIONS,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  try {
    await voidDraftMovement(parsed.data, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${parsed.data.companyId}/inventory`);
    return { success: true, data: true };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Consultas ────────────────────────────────────────────────────────────────

export async function getInventoryItemsAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof getInventoryItems>>>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS });
  if (!ctx.ok) return ctx.error;

  try {
    const items = await getInventoryItems(companyId);
    return { success: true, data: items };
  } catch (error) {
    return toActionError(error);
  }
}

export async function getItemMovementsAction(
  companyId: string,
  itemId: string
): Promise<ActionResult<Awaited<ReturnType<typeof getItemMovements>>>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS });
  if (!ctx.ok) return ctx.error;

  try {
    const movements = await getItemMovements(companyId, itemId);
    return { success: true, data: movements };
  } catch (error) {
    return toActionError(error);
  }
}

export async function getDraftMovementsAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof getDraftMovements>>>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.OPERATIONS });
  if (!ctx.ok) return ctx.error;

  try {
    const movements = await getDraftMovements(companyId);
    return { success: true, data: movements };
  } catch (error) {
    return toActionError(error);
  }
}

// ── searchInventoryItemsAction — ROLES.OPERATIONS — lookup para product picker ─
export async function searchInventoryItemsAction(
  companyId: string,
  query: string
): Promise<ActionResult<{ id: string; name: string; sku: string; stockQuantity: string; baseUnitAbbr: string }[]>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.OPERATIONS });
  if (!ctx.ok) return ctx.error;

  const q = query.trim();
  if (q.length < 2) return { success: true, data: [] };

  try {
    const items = await prisma.inventoryItem.findMany({
      where: {
        companyId,
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, sku: true, stockQuantity: true, baseUnitAbbr: true },
      orderBy: { name: "asc" },
      take: 10,
    });
    return {
      success: true,
      data: items.map((i) => ({ ...i, stockQuantity: i.stockQuantity.toString() })),
    };
  } catch (e) {
    return toActionError(e);
  }
}
