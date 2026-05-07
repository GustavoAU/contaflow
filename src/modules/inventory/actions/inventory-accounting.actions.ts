// src/modules/inventory/actions/inventory-accounting.actions.ts
"use server";
// Dominio ACCOUNTANT — aprobar movimientos DRAFT→POSTED, anular POSTED→VOIDED
// HIGH-2: ADMINISTRATIVE no puede alcanzar estas acciones

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { PostMovementSchema, VoidMovementSchema } from "../schemas/inventory-movement.schema";
import {
  postMovement,
  voidPostedMovement,
  getInventoryValuation,
  getPendingMovements,
} from "../services/InventoryAccountingService";

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

// ─── Contabilizar movimiento (DRAFT → POSTED) ─────────────────────────────────

export async function postMovementAction(
  input: unknown
): Promise<ActionResult<{ movementId: string; transactionId: string }>> {
  // LOW-1: auth() primero
  const ctx = await getInventoryAuthContext();
  if (!ctx) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(ctx.userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes" };

  const parsed = PostMovementSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  const member = await prisma.companyMember.findFirst({
    where: { companyId: parsed.data.companyId, userId: ctx.userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  // HIGH-2: ADMINISTRATIVE no puede contabilizar — solo ACCOUNTING
  if (!canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

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
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado" };
  }
}

// ─── Anular movimiento POSTED (POSTED → VOIDED) ───────────────────────────────

export async function voidPostedMovementAction(
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
  // HIGH-2: solo ACCOUNTING puede anular movimientos contabilizados
  if (!canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

  try {
    await voidPostedMovement(parsed.data, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${parsed.data.companyId}/inventory`);
    return { success: true, data: true };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado" };
  }
}

// ─── Consultas ────────────────────────────────────────────────────────────────

export async function getInventoryValuationAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof getInventoryValuation>>>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  // Valoración visible para ACCOUNTING y OPERATIONS
  if (!canAccess(member.role, ROLES.WRITERS))
    return { success: false, error: "Se requiere autenticación" };

  try {
    const valuation = await getInventoryValuation(companyId);
    return { success: true, data: valuation };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado" };
  }
}

export async function getPendingMovementsAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof getPendingMovements>>>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  // ACCOUNTING ve los pending para aprobarlos
  if (!canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

  try {
    const movements = await getPendingMovements(companyId);
    return { success: true, data: movements };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado" };
  }
}

// ─── Lotes disponibles para SALIDA (FEFO order) ───────────────────────────────

export async function getAvailableLotsAction(
  companyId: string,
  itemId: string
): Promise<ActionResult<Array<{ id: string; lotNumber: string; quantityOnHand: string; expiresAt: string | null }>>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  if (!canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Se requiere rol Contador o superior" };

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
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  if (!canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Se requiere rol Contador o superior" };

  const serials = await prisma.inventorySerial.findMany({
    where: { companyId, itemId, status: "AVAILABLE" },
    orderBy: { serialNumber: "asc" },
    select: { id: true, serialNumber: true },
  });

  return { success: true, data: serials };
}
