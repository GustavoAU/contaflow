// src/modules/vendors/actions/customer.actions.ts
"use server";

import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { CustomerService, type CustomerRow } from "../services/CustomerService";
import { ContactNoteService, type ContactNoteRow } from "../services/ContactNoteService";
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
  ContactNoteSchema,
  type CreateCustomerInput,
  type UpdateCustomerInput,
} from "../schemas/vendor.schemas";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ── List (read-only, ACCOUNTING+) ──────────────────────────────────────────
export async function listCustomersAction(companyId: string): Promise<ActionResult<CustomerRow[]>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
    if (!ctx.ok) return ctx.error;
    const data = await CustomerService.list(companyId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Get (read-only, ACCOUNTING+) ───────────────────────────────────────────
export async function getCustomerAction(companyId: string, customerId: string): Promise<ActionResult<CustomerRow>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
    if (!ctx.ok) return ctx.error;
    const data = await CustomerService.get(companyId, customerId);
    if (!data) return { success: false, error: "Cliente no encontrado" };
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Create (WRITERS+, rate-limited) ────────────────────────────────────────
export async function createCustomerAction(
  companyId: string,
  input: CreateCustomerInput,
): Promise<ActionResult<CustomerRow>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS, limiter: limiters.fiscal });
    if (!ctx.ok) return ctx.error;

    const parsed = CreateCustomerSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    const data = await CustomerService.create(companyId, parsed.data);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Update (WRITERS+, rate-limited) ────────────────────────────────────────
export async function updateCustomerAction(
  companyId: string,
  customerId: string,
  input: UpdateCustomerInput,
): Promise<ActionResult<CustomerRow>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS, limiter: limiters.fiscal });
    if (!ctx.ok) return ctx.error;

    const parsed = UpdateCustomerSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    const data = await CustomerService.update(companyId, customerId, parsed.data);
    if (!data) return { success: false, error: "Cliente no encontrado o sin acceso" };
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Delete/soft-delete (ADMIN_ONLY, rate-limited) ──────────────────────────
export async function deleteCustomerAction(
  companyId: string,
  customerId: string,
): Promise<ActionResult<{ linkedCount: number }>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ADMIN_ONLY, limiter: limiters.fiscal });
    if (!ctx.ok) return ctx.error;

    const result = await CustomerService.softDelete(companyId, customerId);
    if (!result.deleted) return { success: false, error: "Cliente no encontrado o ya eliminado" };
    return { success: true, data: { linkedCount: result.linkedCount } };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Contact notes (historial de interacciones) ─────────────────────────────

export async function listContactNotesAction(
  companyId: string,
  customerId: string,
): Promise<ActionResult<ContactNoteRow[]>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
    if (!ctx.ok) return ctx.error;
    const data = await ContactNoteService.list(companyId, "CUSTOMER", customerId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function addContactNoteAction(
  companyId: string,
  customerId: string,
  input: unknown,
): Promise<ActionResult<ContactNoteRow>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS, limiter: limiters.fiscal });
    if (!ctx.ok) return ctx.error;

    const parsed = ContactNoteSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    // Verificar que el cliente pertenece a esta empresa (ADR-004)
    const customer = await CustomerService.get(companyId, customerId);
    if (!customer) return { success: false, error: "Cliente no encontrado" };

    const data = await ContactNoteService.create(companyId, "CUSTOMER", customerId, parsed.data.content, ctx.userId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteContactNoteAction(
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

// ── Link customer to invoice (WRITERS+, rate-limited, IDOR guard) ──────────
export async function linkCustomerToInvoiceAction(
  companyId: string,
  invoiceId: string,
  customerId: string,
): Promise<ActionResult<true>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS, limiter: limiters.fiscal });
    if (!ctx.ok) return ctx.error;

    const ok = await CustomerService.linkToInvoice(companyId, invoiceId, customerId);
    if (!ok) return { success: false, error: "Factura o cliente no válidos para esta empresa" };
    return { success: true, data: true };
  } catch (e) {
    return toActionError(e);
  }
}
