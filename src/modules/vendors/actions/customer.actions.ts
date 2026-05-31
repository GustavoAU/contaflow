// src/modules/vendors/actions/customer.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { CustomerService, type CustomerRow } from "../services/CustomerService";
import { ContactNoteService, type ContactNoteRow } from "../services/ContactNoteService";
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
  ContactNoteSchema,
  type CreateCustomerInput,
  type UpdateCustomerInput,
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
export async function listCustomersAction(companyId: string): Promise<Result<CustomerRow[]>> {
  try {
    const { allowed } = await resolveAccounting(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };
    const data = await CustomerService.list(companyId);
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

// ── Get (read-only, ACCOUNTING+) ───────────────────────────────────────────
export async function getCustomerAction(companyId: string, customerId: string): Promise<Result<CustomerRow>> {
  try {
    const { allowed } = await resolveAccounting(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };
    const data = await CustomerService.get(companyId, customerId);
    if (!data) return { success: false, error: "Cliente no encontrado" };
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

// ── Create (WRITERS+, rate-limited) ────────────────────────────────────────
export async function createCustomerAction(
  companyId: string,
  input: CreateCustomerInput,
): Promise<Result<CustomerRow>> {
  try {
    const { userId, allowed } = await resolveWriters(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

    const parsed = CreateCustomerSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    const data = await CustomerService.create(companyId, parsed.data);
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

// ── Update (WRITERS+, rate-limited) ────────────────────────────────────────
export async function updateCustomerAction(
  companyId: string,
  customerId: string,
  input: UpdateCustomerInput,
): Promise<Result<CustomerRow>> {
  try {
    const { userId, allowed } = await resolveWriters(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

    const parsed = UpdateCustomerSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    const data = await CustomerService.update(companyId, customerId, parsed.data);
    if (!data) return { success: false, error: "Cliente no encontrado o sin acceso" };
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

// ── Delete/soft-delete (ADMIN_ONLY, rate-limited) ──────────────────────────
export async function deleteCustomerAction(
  companyId: string,
  customerId: string,
): Promise<Result<{ linkedCount: number }>> {
  try {
    const { userId, allowed } = await resolveAdmin(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

    const result = await CustomerService.softDelete(companyId, customerId);
    if (!result.deleted) return { success: false, error: "Cliente no encontrado o ya eliminado" };
    return { success: true, data: { linkedCount: result.linkedCount } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

// ── Contact notes (historial de interacciones) ─────────────────────────────

export async function listContactNotesAction(
  companyId: string,
  customerId: string,
): Promise<Result<ContactNoteRow[]>> {
  try {
    const { allowed } = await resolveAccounting(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };
    const data = await ContactNoteService.list(companyId, "CUSTOMER", customerId);
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

export async function addContactNoteAction(
  companyId: string,
  customerId: string,
  input: unknown,
): Promise<Result<ContactNoteRow>> {
  try {
    const { userId, allowed } = await resolveWriters(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

    const parsed = ContactNoteSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    // Verificar que el cliente pertenece a esta empresa (ADR-004)
    const customer = await CustomerService.get(companyId, customerId);
    if (!customer) return { success: false, error: "Cliente no encontrado" };

    const data = await ContactNoteService.create(companyId, "CUSTOMER", customerId, parsed.data.content, userId);
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

export async function deleteContactNoteAction(
  companyId: string,
  noteId: string,
): Promise<Result<true>> {
  try {
    const { userId, allowed } = await resolveWriters(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

    const deleted = await ContactNoteService.delete(companyId, noteId);
    if (!deleted) return { success: false, error: "Nota no encontrada" };
    return { success: true, data: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}

// ── Link customer to invoice (WRITERS+, rate-limited, IDOR guard) ──────────
export async function linkCustomerToInvoiceAction(
  companyId: string,
  invoiceId: string,
  customerId: string,
): Promise<Result<true>> {
  try {
    const { userId, allowed } = await resolveWriters(companyId);
    if (!allowed) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente en un momento." };

    const ok = await CustomerService.linkToInvoice(companyId, invoiceId, customerId);
    if (!ok) return { success: false, error: "Factura o cliente no válidos para esta empresa" };
    return { success: true, data: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error inesperado" };
  }
}
