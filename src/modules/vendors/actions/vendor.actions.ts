// src/modules/vendors/actions/vendor.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { VendorService, type VendorRow } from "../services/VendorService";
import {
  CreateVendorSchema,
  UpdateVendorSchema,
  type CreateVendorInput,
  type UpdateVendorInput,
} from "../schemas/vendor.schemas";

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

async function resolveAccounting(companyId: string): Promise<{ userId: string; allowed: boolean }> {
  const { userId } = await auth();
  if (!userId) return { userId: "", allowed: false };
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ACCOUNTING)) return { userId, allowed: false };
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

// ── List (read-only, ACCOUNTING+) ──────────────────────────────────────────
export async function listVendorsAction(companyId: string): Promise<Result<VendorRow[]>> {
  const { allowed } = await resolveAccounting(companyId);
  if (!allowed) return { success: false, error: "No autorizado" };
  const data = await VendorService.list(companyId);
  return { success: true, data };
}

// ── Get (read-only, ACCOUNTING+) ───────────────────────────────────────────
export async function getVendorAction(companyId: string, vendorId: string): Promise<Result<VendorRow>> {
  const { allowed } = await resolveAccounting(companyId);
  if (!allowed) return { success: false, error: "No autorizado" };
  const data = await VendorService.get(companyId, vendorId);
  if (!data) return { success: false, error: "Proveedor no encontrado" };
  return { success: true, data };
}

// ── Create (WRITERS+, rate-limited) ────────────────────────────────────────
export async function createVendorAction(
  companyId: string,
  input: CreateVendorInput,
): Promise<Result<VendorRow>> {
  const { userId, allowed } = await resolveWriters(companyId);
  if (!allowed) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

  const parsed = CreateVendorSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const data = await VendorService.create(companyId, parsed.data);
  return { success: true, data };
}

// ── Update (WRITERS+, rate-limited) ────────────────────────────────────────
export async function updateVendorAction(
  companyId: string,
  vendorId: string,
  input: UpdateVendorInput,
): Promise<Result<VendorRow>> {
  const { userId, allowed } = await resolveWriters(companyId);
  if (!allowed) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

  const parsed = UpdateVendorSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const data = await VendorService.update(companyId, vendorId, parsed.data);
  if (!data) return { success: false, error: "Proveedor no encontrado o sin acceso" };
  return { success: true, data };
}

// ── Delete/soft-delete (ADMIN_ONLY, rate-limited) ──────────────────────────
export async function deleteVendorAction(
  companyId: string,
  vendorId: string,
): Promise<Result<{ linkedCount: number }>> {
  const { userId, allowed } = await resolveAdmin(companyId);
  if (!allowed) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

  const result = await VendorService.softDelete(companyId, vendorId);
  if (!result.deleted) return { success: false, error: "Proveedor no encontrado o ya eliminado" };
  return { success: true, data: { linkedCount: result.linkedCount } };
}

// ── Link vendor to invoice (WRITERS+, rate-limited, IDOR guard) ────────────
export async function linkVendorToInvoiceAction(
  companyId: string,
  invoiceId: string,
  vendorId: string,
): Promise<Result<true>> {
  const { userId, allowed } = await resolveWriters(companyId);
  if (!allowed) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

  const ok = await VendorService.linkToInvoice(companyId, invoiceId, vendorId);
  if (!ok) return { success: false, error: "Factura o proveedor no válidos para esta empresa" };
  return { success: true, data: true };
}
