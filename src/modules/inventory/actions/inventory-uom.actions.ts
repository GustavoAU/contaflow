// src/modules/inventory/actions/inventory-uom.actions.ts
"use server";
// Dominio ACCOUNTANT/ADMIN — gestión de unidades de medida por ítem de inventario.
// HIGH-5 (security-agent): crear/actualizar → ACCOUNTING; eliminar → ADMIN_ONLY.

import { revalidatePath } from "next/cache";

import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
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
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── Crear unidad ─────────────────────────────────────────────────────────────

export async function createUomAction(input: unknown): Promise<ActionResult<string>> {
  const parsed = CreateUomSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  // HIGH-4: rate limiting en mutaciones UoM
  // HIGH-5: solo ACCOUNTANT/OWNER/ADMIN pueden configurar unidades de medida
  const ctx = await requireCompanyAction(parsed.data.companyId, {
    roles: ROLES.ACCOUNTING,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  try {
    const unit = await createUnit(parsed.data, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${parsed.data.companyId}/inventory`);
    return { success: true, data: unit.id };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Actualizar unidad ────────────────────────────────────────────────────────

export async function updateUomAction(input: unknown): Promise<ActionResult<string>> {
  const parsed = UpdateUomSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  // HIGH-5: solo ACCOUNTANT/OWNER/ADMIN
  const ctx = await requireCompanyAction(parsed.data.companyId, {
    roles: ROLES.ACCOUNTING,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  try {
    const unit = await updateUnit(parsed.data, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${parsed.data.companyId}/inventory`);
    return { success: true, data: unit.id };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Eliminar unidad (soft-delete) ────────────────────────────────────────────

export async function softDeleteUomAction(input: unknown): Promise<ActionResult<boolean>> {
  const parsed = SoftDeleteUomSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  // HIGH-5: solo ADMIN/OWNER pueden eliminar unidades de medida
  const ctx = await requireCompanyAction(parsed.data.companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  try {
    await softDeleteUnit(parsed.data, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${parsed.data.companyId}/inventory`);
    return { success: true, data: true };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Listar unidades ──────────────────────────────────────────────────────────

export async function listUomsAction(
  input: unknown
): Promise<ActionResult<Awaited<ReturnType<typeof listUnits>>>> {
  const parsed = ListUomsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  const ctx = await requireCompanyAction(parsed.data.companyId, { roles: ROLES.WRITERS });
  if (!ctx.ok) return ctx.error;

  try {
    const units = await listUnits(parsed.data);
    return { success: true, data: units };
  } catch (error) {
    return toActionError(error);
  }
}
