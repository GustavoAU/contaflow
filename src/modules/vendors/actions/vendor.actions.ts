// src/modules/vendors/actions/vendor.actions.ts
"use server";

import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
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

// ── List (read-only, ACCOUNTING+) ──────────────────────────────────────────
export async function listVendorsAction(companyId: string): Promise<ActionResult<VendorRow[]>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
    if (!ctx.ok) return ctx.error;
    const data = await VendorService.list(companyId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Get (read-only, ACCOUNTING+) ───────────────────────────────────────────
export async function getVendorAction(companyId: string, vendorId: string): Promise<ActionResult<VendorRow>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
    if (!ctx.ok) return ctx.error;
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
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS, limiter: limiters.fiscal });
    if (!ctx.ok) return ctx.error;

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
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS, limiter: limiters.fiscal });
    if (!ctx.ok) return ctx.error;

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
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ADMIN_ONLY, limiter: limiters.fiscal });
    if (!ctx.ok) return ctx.error;

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
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
    if (!ctx.ok) return ctx.error;
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
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS, limiter: limiters.fiscal });
    if (!ctx.ok) return ctx.error;

    const parsed = ContactNoteSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    // Verificar que el proveedor pertenece a esta empresa (ADR-004)
    const vendor = await VendorService.get(companyId, vendorId);
    if (!vendor) return { success: false, error: "Proveedor no encontrado" };

    const data = await ContactNoteService.create(companyId, "VENDOR", vendorId, parsed.data.content, ctx.userId);
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
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS, limiter: limiters.fiscal });
    if (!ctx.ok) return ctx.error;

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
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS, limiter: limiters.fiscal });
    if (!ctx.ok) return ctx.error;

    const ok = await VendorService.linkToInvoice(companyId, invoiceId, vendorId);
    if (!ok) return { success: false, error: "Factura o proveedor no válidos para esta empresa" };
    return { success: true, data: true };
  } catch (e) {
    return toActionError(e);
  }
}
