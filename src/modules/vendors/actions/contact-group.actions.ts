// src/modules/vendors/actions/contact-group.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { VendorGroupService, CustomerGroupService, type ContactGroupRow } from "../services/ContactGroupService";
import { CreateContactGroupSchema } from "../schemas/vendor.schemas";

type Result<T> = { success: true; data: T } | { success: false; error: string };

async function resolveWriters(companyId: string): Promise<{ userId: string; allowed: boolean }> {
  const { userId } = await auth();
  if (!userId) return { userId: "", allowed: false };
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.WRITERS)) return { userId, allowed: false };
  return { userId, allowed: true };
}

async function resolveAdmin(companyId: string): Promise<{ userId: string; allowed: boolean }> {
  const { userId } = await auth();
  if (!userId) return { userId: "", allowed: false };
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ADMIN_ONLY)) return { userId, allowed: false };
  return { userId, allowed: true };
}

// ── Vendor Groups ─────────────────────────────────────────────────────────────

export async function createVendorGroupAction(
  companyId: string,
  name: string,
): Promise<Result<ContactGroupRow>> {
  const { userId, allowed } = await resolveWriters(companyId);
  if (!allowed) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

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
): Promise<Result<true>> {
  const { userId, allowed } = await resolveAdmin(companyId);
  if (!allowed) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

  const ok = await VendorGroupService.delete(companyId, groupId);
  if (!ok) return { success: false, error: "Grupo no encontrado" };
  return { success: true, data: true };
}

// ── Customer Groups ───────────────────────────────────────────────────────────

export async function createCustomerGroupAction(
  companyId: string,
  name: string,
): Promise<Result<ContactGroupRow>> {
  const { userId, allowed } = await resolveWriters(companyId);
  if (!allowed) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

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
): Promise<Result<true>> {
  const { userId, allowed } = await resolveAdmin(companyId);
  if (!allowed) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

  const ok = await CustomerGroupService.delete(companyId, groupId);
  if (!ok) return { success: false, error: "Grupo no encontrado" };
  return { success: true, data: true };
}
