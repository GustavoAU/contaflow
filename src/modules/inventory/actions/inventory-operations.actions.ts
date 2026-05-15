// src/modules/inventory/actions/inventory-operations.actions.ts
"use server";
// Dominio ADMINISTRATIVE — crear/editar ítems, registrar movimientos DRAFT, anular DRAFT

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
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

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

async function getInventoryAuthContext() {
  const { userId } = await auth();
  if (!userId) return null;
  const h = await headers();
  const ipAddress =
    h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;
  return { userId, ipAddress, userAgent };
}

// ─── Crear ítem ───────────────────────────────────────────────────────────────

export async function createInventoryItemAction(
  input: unknown
): Promise<ActionResult<string>> {
  // LOW-1: auth() primero, safeParse después
  const ctx = await getInventoryAuthContext();
  if (!ctx) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(ctx.userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes" };

  const parsed = CreateInventoryItemSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  const member = await prisma.companyMember.findFirst({
    where: { companyId: parsed.data.companyId, userId: ctx.userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  // HIGH-1: VIEWER no puede crear ítems
  if (!canAccess(member.role, ROLES.OPERATIONS))
    return { success: false, error: "Se requiere rol Administrativo o superior" };

  try {
    const item = await createInventoryItem(parsed.data, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${parsed.data.companyId}/inventory`);
    return { success: true, data: item.id };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado" };
  }
}

// ─── Actualizar ítem ──────────────────────────────────────────────────────────

export async function updateInventoryItemAction(
  input: unknown
): Promise<ActionResult<string>> {
  const ctx = await getInventoryAuthContext();
  if (!ctx) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(ctx.userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes" };

  const parsed = UpdateInventoryItemSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  const member = await prisma.companyMember.findFirst({
    where: { companyId: parsed.data.companyId, userId: ctx.userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  if (!canAccess(member.role, ROLES.OPERATIONS))
    return { success: false, error: "Se requiere rol Administrativo o superior" };

  try {
    const item = await updateInventoryItem(parsed.data, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${parsed.data.companyId}/inventory`);
    return { success: true, data: item.id };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado" };
  }
}

// ─── Soft-delete ítem ─────────────────────────────────────────────────────────

export async function softDeleteInventoryItemAction(
  companyId: string,
  itemId: string
): Promise<ActionResult<boolean>> {
  const ctx = await getInventoryAuthContext();
  if (!ctx) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(ctx.userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId: ctx.userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  // Solo ADMIN/OWNER pueden eliminar
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Se requiere rol Administrador o superior" };

  try {
    await softDeleteInventoryItem(itemId, companyId, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${companyId}/inventory`);
    return { success: true, data: true };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado" };
  }
}

// ─── Registrar movimiento (→ DRAFT) ──────────────────────────────────────────

export async function createMovementAction(
  input: unknown
): Promise<ActionResult<string>> {
  const ctx = await getInventoryAuthContext();
  if (!ctx) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(ctx.userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes" };

  const parsed = CreateMovementSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  const member = await prisma.companyMember.findFirst({
    where: { companyId: parsed.data.companyId, userId: ctx.userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  // HIGH-1: VIEWER no puede registrar movimientos
  if (!canAccess(member.role, ROLES.OPERATIONS))
    return { success: false, error: "Se requiere rol Administrativo o superior" };

  try {
    const movement = await createDraftMovement(parsed.data, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${parsed.data.companyId}/inventory`);
    return { success: true, data: movement.id };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado" };
  }
}

// ─── Anular movimiento DRAFT ──────────────────────────────────────────────────

export async function voidDraftMovementAction(
  input: unknown
): Promise<ActionResult<boolean>> {
  const ctx = await getInventoryAuthContext();
  if (!ctx) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(ctx.userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes" };

  const parsed = VoidMovementSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  const member = await prisma.companyMember.findFirst({
    where: { companyId: parsed.data.companyId, userId: ctx.userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  if (!canAccess(member.role, ROLES.OPERATIONS))
    return { success: false, error: "Se requiere rol Administrativo o superior" };

  try {
    await voidDraftMovement(parsed.data, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${parsed.data.companyId}/inventory`);
    return { success: true, data: true };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado" };
  }
}

// ─── Consultas ────────────────────────────────────────────────────────────────

export async function getInventoryItemsAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof getInventoryItems>>>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  if (!canAccess(member.role, ROLES.WRITERS))
    return { success: false, error: "Se requiere autenticación" };

  try {
    const items = await getInventoryItems(companyId);
    return { success: true, data: items };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado" };
  }
}

export async function getItemMovementsAction(
  companyId: string,
  itemId: string
): Promise<ActionResult<Awaited<ReturnType<typeof getItemMovements>>>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  if (!canAccess(member.role, ROLES.WRITERS))
    return { success: false, error: "Se requiere autenticación" };

  try {
    const movements = await getItemMovements(companyId, itemId);
    return { success: true, data: movements };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado" };
  }
}

export async function getDraftMovementsAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof getDraftMovements>>>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  if (!canAccess(member.role, ROLES.OPERATIONS))
    return { success: false, error: "Se requiere rol Administrativo o superior" };

  try {
    const movements = await getDraftMovements(companyId);
    return { success: true, data: movements };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado" };
  }
}

// ── searchInventoryItemsAction — ROLES.OPERATIONS — lookup para product picker ─
export async function searchInventoryItemsAction(
  companyId: string,
  query: string
): Promise<ActionResult<{ id: string; name: string; sku: string; stockQuantity: string; baseUnitAbbr: string }[]>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Acceso denegado" };
  if (!canAccess(member.role, ROLES.OPERATIONS))
    return { success: false, error: "Acceso denegado" };

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
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}
