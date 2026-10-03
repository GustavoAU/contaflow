// src/modules/vendors/actions/partner.actions.ts
// ADR-054: Server Actions CRUD para Partner (socio/accionista) — mismo patrón
// requireCompanyAction que customer.actions.ts (ADR-041).
"use server";

import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { PartnerService, type PartnerRow } from "../services/PartnerService";
import {
  CreatePartnerSchema,
  UpdatePartnerSchema,
  type CreatePartnerInput,
  type UpdatePartnerInput,
} from "../schemas/partner.schemas";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ── List (read-only, ACCOUNTING+) ──────────────────────────────────────────
export async function listPartnersAction(companyId: string): Promise<ActionResult<PartnerRow[]>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
    if (!ctx.ok) return ctx.error;
    const data = await PartnerService.list(companyId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Get (read-only, ACCOUNTING+) ───────────────────────────────────────────
export async function getPartnerAction(
  companyId: string,
  partnerId: string
): Promise<ActionResult<PartnerRow>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
    if (!ctx.ok) return ctx.error;
    const data = await PartnerService.get(companyId, partnerId);
    if (!data) return { success: false, error: "Socio no encontrado" };
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Create (WRITERS+, rate-limited) ────────────────────────────────────────
export async function createPartnerAction(
  companyId: string,
  input: CreatePartnerInput
): Promise<ActionResult<PartnerRow>> {
  try {
    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.WRITERS,
      limiter: limiters.fiscal,
    });
    if (!ctx.ok) return ctx.error;

    const parsed = CreatePartnerSchema.safeParse(input);
    if (!parsed.success)
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    const data = await PartnerService.create(companyId, parsed.data);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Update (WRITERS+, rate-limited) ────────────────────────────────────────
export async function updatePartnerAction(
  companyId: string,
  partnerId: string,
  input: UpdatePartnerInput
): Promise<ActionResult<PartnerRow>> {
  try {
    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.WRITERS,
      limiter: limiters.fiscal,
    });
    if (!ctx.ok) return ctx.error;

    const parsed = UpdatePartnerSchema.safeParse(input);
    if (!parsed.success)
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    const data = await PartnerService.update(companyId, partnerId, parsed.data);
    if (!data) return { success: false, error: "Socio no encontrado o sin acceso" };
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── Delete/soft-delete (ADMIN_ONLY, rate-limited) ──────────────────────────
export async function deletePartnerAction(
  companyId: string,
  partnerId: string
): Promise<ActionResult<true>> {
  try {
    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.ADMIN_ONLY,
      limiter: limiters.fiscal,
    });
    if (!ctx.ok) return ctx.error;

    const result = await PartnerService.softDelete(companyId, partnerId);
    if (!result.deleted) return { success: false, error: "Socio no encontrado o ya eliminado" };
    return { success: true, data: true };
  } catch (e) {
    return toActionError(e);
  }
}
