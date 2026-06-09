"use server";
// src/modules/payroll/actions/payroll-concept.actions.ts
// Fase NOM-B: Server Actions para conceptos de nómina
//
// Security findings:
//   NOM-B-01 (CRITICAL): companyId verificado vía companyMember
//   NOM-B-04 (HIGH):     write = ADMIN_ONLY; read = ACCOUNTING (contador necesita ver conceptos)

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { CreateConceptSchema, UpdateConceptSchema } from "../schemas/payroll-concept.schema";
import { PayrollConceptService } from "../services/PayrollConceptService";
import type { PayrollConceptRow } from "../services/PayrollConceptService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

async function resolveAuth(companyId: string) {
  const { userId } = await auth();
  if (!userId) return { userId: null, member: null };
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  return { userId, member };
}

function revalidate(companyId: string) {
  revalidatePath(`/company/${companyId}/payroll/concepts`);
}

// ── listConceptsAction — ACCOUNTING (contador necesita verlos) ────────────────
export async function listConceptsAction(
  companyId: string
): Promise<ActionResult<PayrollConceptRow[]>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ACCOUNTING)) return { success: false, error: "Acceso denegado" };

  // Seed defaults si no existen aún (idempotente)
  await PayrollConceptService.seedDefaults(companyId);
  const concepts = await PayrollConceptService.list(companyId);
  return { success: true, data: concepts };
}

// ── createConceptAction — ADMIN_ONLY ─────────────────────────────────────────
export async function createConceptAction(
  companyId: string,
  rawInput: unknown
): Promise<ActionResult<PayrollConceptRow>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Solo el Administrador puede crear conceptos" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intenta en unos minutos." };

  const parsed = CreateConceptSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

  try {
    const concept = await PayrollConceptService.create(companyId, userId, parsed.data, ipAddress, userAgent);
    revalidate(companyId);
    return { success: true, data: concept };
  } catch (err) {
    if (err instanceof Error && err.message.includes("P2002"))
      return { success: false, error: "Ya existe un concepto con ese código" };
    return toActionError(err);
  }
}

// ── updateConceptAction — ADMIN_ONLY ─────────────────────────────────────────
export async function updateConceptAction(
  companyId: string,
  conceptId: string,
  rawInput: unknown
): Promise<ActionResult<PayrollConceptRow>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Solo el Administrador puede editar conceptos" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intenta en unos minutos." };

  const parsed = UpdateConceptSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

  try {
    const concept = await PayrollConceptService.update(companyId, userId, conceptId, parsed.data, ipAddress, userAgent);
    revalidate(companyId);
    return { success: true, data: concept };
  } catch (err) {
    return toActionError(err);
  }
}

// ── deleteConceptAction — ADMIN_ONLY (solo no-sistema) ───────────────────────
export async function deleteConceptAction(
  companyId: string,
  conceptId: string
): Promise<ActionResult<{ deleted: true }>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Solo el Administrador puede eliminar conceptos" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intenta en unos minutos." };

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

  try {
    await PayrollConceptService.delete(companyId, userId, conceptId, ipAddress, userAgent);
    revalidate(companyId);
    return { success: true, data: { deleted: true } };
  } catch (err) {
    return toActionError(err);
  }
}
