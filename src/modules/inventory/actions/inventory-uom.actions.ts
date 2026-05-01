// src/modules/inventory/actions/inventory-uom.actions.ts
"use server";
// Dominio ACCOUNTANT/ADMIN — gestión de unidades de medida por ítem de inventario.
// HIGH-5 (security-agent): crear/actualizar → ACCOUNTING; eliminar → ADMIN_ONLY.

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import {
  CreateUomSchema,
  UpdateUomSchema,
  SoftDeleteUomSchema,
  ListUomsSchema,
} from "../schemas/inventory-item-unit.schema";
import {
  createUnit,
  updateUnit,
  softDeleteUnit,
  listUnits,
} from "../services/InventoryUomService";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ─── Captura de red ───────────────────────────────────────────────────────────

async function getNetworkContext() {
  const h = await headers();
  const ipAddress =
    h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;
  return { ipAddress, userAgent };
}

// ─── Crear unidad ─────────────────────────────────────────────────────────────

export async function createUomAction(input: unknown): Promise<ActionResult<string>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  // HIGH-4: rate limiting en mutaciones UoM
  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes" };

  const parsed = CreateUomSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  const member = await prisma.companyMember.findFirst({
    where: { companyId: parsed.data.companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };

  // HIGH-5: solo ACCOUNTANT/OWNER/ADMIN pueden configurar unidades de medida
  if (!canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Se requiere rol Contador o superior" };

  const { ipAddress, userAgent } = await getNetworkContext();

  try {
    const unit = await createUnit(parsed.data, userId, ipAddress, userAgent);
    revalidatePath(`/company/${parsed.data.companyId}/inventory`);
    return { success: true, data: unit.id };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado" };
  }
}

// ─── Actualizar unidad ────────────────────────────────────────────────────────

export async function updateUomAction(input: unknown): Promise<ActionResult<string>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes" };

  const parsed = UpdateUomSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  const member = await prisma.companyMember.findFirst({
    where: { companyId: parsed.data.companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };

  // HIGH-5: solo ACCOUNTANT/OWNER/ADMIN
  if (!canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Se requiere rol Contador o superior" };

  const { ipAddress, userAgent } = await getNetworkContext();

  try {
    const unit = await updateUnit(parsed.data, userId, ipAddress, userAgent);
    revalidatePath(`/company/${parsed.data.companyId}/inventory`);
    return { success: true, data: unit.id };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado" };
  }
}

// ─── Eliminar unidad (soft-delete) ────────────────────────────────────────────

export async function softDeleteUomAction(input: unknown): Promise<ActionResult<boolean>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes" };

  const parsed = SoftDeleteUomSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  const member = await prisma.companyMember.findFirst({
    where: { companyId: parsed.data.companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };

  // HIGH-5: solo ADMIN/OWNER pueden eliminar unidades de medida
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Se requiere rol Administrador o superior" };

  const { ipAddress, userAgent } = await getNetworkContext();

  try {
    await softDeleteUnit(parsed.data, userId, ipAddress, userAgent);
    revalidatePath(`/company/${parsed.data.companyId}/inventory`);
    return { success: true, data: true };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado" };
  }
}

// ─── Listar unidades ──────────────────────────────────────────────────────────

export async function listUomsAction(
  input: unknown
): Promise<ActionResult<Awaited<ReturnType<typeof listUnits>>>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const parsed = ListUomsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  const member = await prisma.companyMember.findFirst({
    where: { companyId: parsed.data.companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  if (!canAccess(member.role, ROLES.WRITERS))
    return { success: false, error: "Se requiere autenticación" };

  try {
    const units = await listUnits(parsed.data);
    return { success: true, data: units };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado" };
  }
}
