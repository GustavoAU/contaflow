// src/modules/vendors/actions/contact-group.actions.ts
"use server";

import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { VendorGroupService, CustomerGroupService, type ContactGroupRow } from "../services/ContactGroupService";
import { CreateContactGroupSchema } from "../schemas/vendor.schemas";
import type { ActionResult } from "../types/action-result";

// ── Vendor Groups ─────────────────────────────────────────────────────────────

export async function createVendorGroupAction(
  companyId: string,
  name: string,
): Promise<ActionResult<ContactGroupRow>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS, limiter: limiters.fiscal });
  if (!ctx.ok) return ctx.error;

  const parsed = CreateContactGroupSchema.safeParse({ name });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const data = await VendorGroupService.create(companyId, parsed.data.name);
    return { success: true, data };
  } catch {
    return { success: false, error: "Ya existe un grupo con ese nombre." };
  }
}

export async function deleteVendorGroupAction(
  companyId: string,
  groupId: string,
): Promise<ActionResult<true>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ADMIN_ONLY, limiter: limiters.fiscal });
  if (!ctx.ok) return ctx.error;

  const ok = await VendorGroupService.delete(companyId, groupId);
  if (!ok) return { success: false, error: "Grupo no encontrado" };
  return { success: true, data: true };
}

// ── Customer Groups ───────────────────────────────────────────────────────────

export async function createCustomerGroupAction(
  companyId: string,
  name: string,
): Promise<ActionResult<ContactGroupRow>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS, limiter: limiters.fiscal });
  if (!ctx.ok) return ctx.error;

  const parsed = CreateContactGroupSchema.safeParse({ name });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const data = await CustomerGroupService.create(companyId, parsed.data.name);
    return { success: true, data };
  } catch {
    return { success: false, error: "Ya existe un grupo con ese nombre." };
  }
}

export async function deleteCustomerGroupAction(
  companyId: string,
  groupId: string,
): Promise<ActionResult<true>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ADMIN_ONLY, limiter: limiters.fiscal });
  if (!ctx.ok) return ctx.error;

  const ok = await CustomerGroupService.delete(companyId, groupId);
  if (!ok) return { success: false, error: "Grupo no encontrado" };
  return { success: true, data: true };
}
