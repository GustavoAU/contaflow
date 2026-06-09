// src/modules/vendors/actions/vendor.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { VendorService, type VendorRow } from "../services/VendorService";
import { ContactNoteService, type ContactNoteRow } from "../services/ContactNoteService";
import {
  CreateVendorSchema,
  UpdateVendorSchema,
  ContactNoteSchema,
  type CreateVendorInput,
  type UpdateVendorInput,
} from "../schemas/vendor.schemas";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

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
export async function listVendorsAction(companyId: string): Promise<ActionResult<VendorRow[]>> {
  try {
    const { allowed } = await resolveAccounting(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };
    const data = await VendorService.list(companyId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Get (read-only, ACCOUNTING+) ───────────────────────────────────────────
export async function getVendorAction(companyId: string, vendorId: string): Promise<ActionResult<VendorRow>> {
  try {
    const { allowed } = await resolveAccounting(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };
    const data = await VendorService.get(companyId, vendorId);
    if (!data) return { success: false, error: "Proveedor no encontrado" };
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Create (WRITERS+, rate-limited) ────────────────────────────────────────
export async function createVendorAction(
  companyId: string,
  input: CreateVendorInput,
): Promise<ActionResult<VendorRow>> {
  try {
    const { userId, allowed } = await resolveWriters(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

    const parsed = CreateVendorSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    const data = await VendorService.create(companyId, parsed.data);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Update (WRITERS+, rate-limited) ────────────────────────────────────────
export async function updateVendorAction(
  companyId: string,
  vendorId: string,
  input: UpdateVendorInput,
): Promise<ActionResult<VendorRow>> {
  try {
    const { userId, allowed } = await resolveWriters(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

    const parsed = UpdateVendorSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    const data = await VendorService.update(companyId, vendorId, parsed.data);
    if (!data) return { success: false, error: "Proveedor no encontrado o sin acceso" };
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Delete/soft-delete (ADMIN_ONLY, rate-limited) ──────────────────────────
export async function deleteVendorAction(
  companyId: string,
  vendorId: string,
): Promise<ActionResult<{ linkedCount: number }>> {
  try {
    const { userId, allowed } = await resolveAdmin(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

    const result = await VendorService.softDelete(companyId, vendorId);
    if (!result.deleted) return { success: false, error: "Proveedor no encontrado o ya eliminado" };
    return { success: true, data: { linkedCount: result.linkedCount } };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Contact notes (historial de interacciones) ─────────────────────────────

export async function listVendorNotesAction(
  companyId: string,
  vendorId: string,
): Promise<ActionResult<ContactNoteRow[]>> {
  try {
    const { allowed } = await resolveAccounting(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };
    const data = await ContactNoteService.list(companyId, "VENDOR", vendorId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function addVendorNoteAction(
  companyId: string,
  vendorId: string,
  input: unknown,
): Promise<ActionResult<ContactNoteRow>> {
  try {
    const { userId, allowed } = await resolveWriters(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

    const parsed = ContactNoteSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    // Verificar que el proveedor pertenece a esta empresa (ADR-004)
    const vendor = await VendorService.get(companyId, vendorId);
    if (!vendor) return { success: false, error: "Proveedor no encontrado" };

    const data = await ContactNoteService.create(companyId, "VENDOR", vendorId, parsed.data.content, userId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteVendorNoteAction(
  companyId: string,
  noteId: string,
): Promise<ActionResult<true>> {
  try {
    const { userId, allowed } = await resolveWriters(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

    const deleted = await ContactNoteService.delete(companyId, noteId);
    if (!deleted) return { success: false, error: "Nota no encontrada" };
    return { success: true, data: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Link vendor to invoice (WRITERS+, rate-limited, IDOR guard) ────────────
export async function linkVendorToInvoiceAction(
  companyId: string,
  invoiceId: string,
  vendorId: string,
): Promise<ActionResult<true>> {
  try {
    const { userId, allowed } = await resolveWriters(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

    const ok = await VendorService.linkToInvoice(companyId, invoiceId, vendorId);
    if (!ok) return { success: false, error: "Factura o proveedor no válidos para esta empresa" };
    return { success: true, data: true };
  } catch (e) {
    return toActionError(e);
  }
}
