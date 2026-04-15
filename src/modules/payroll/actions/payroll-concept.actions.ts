"use server";
// src/modules/payroll/actions/payroll-concept.actions.ts
// Fase NOM-B: Server Actions para conceptos de nómina
//
// Security findings:
//   NOM-B-01 (CRITICAL): companyId verificado vía companyMember
//   NOM-B-04 (HIGH):     write = ADMIN_ONLY; read = ACCOUNTING (contador necesita ver conceptos)

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { CreateConceptSchema, UpdateConceptSchema } from "../schemas/payroll-concept.schema";
import { PayrollConceptService } from "../services/PayrollConceptService";
import type { PayrollConceptRow } from "../services/PayrollConceptService";

type Result<T> = { success: true; data: T } | { success: false; error: string };

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
): Promise<Result<PayrollConceptRow[]>> {
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
): Promise<Result<PayrollConceptRow>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Solo el Administrador puede crear conceptos" };

  const parsed = CreateConceptSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const concept = await PayrollConceptService.create(companyId, parsed.data);
    revalidate(companyId);
    return { success: true, data: concept };
  } catch (err) {
    if (err instanceof Error && err.message.includes("P2002"))
      return { success: false, error: "Ya existe un concepto con ese código" };
    const msg = err instanceof Error ? err.message : "Error al crear concepto";
    return { success: false, error: msg };
  }
}

// ── updateConceptAction — ADMIN_ONLY ─────────────────────────────────────────
export async function updateConceptAction(
  companyId: string,
  conceptId: string,
  rawInput: unknown
): Promise<Result<PayrollConceptRow>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Solo el Administrador puede editar conceptos" };

  const parsed = UpdateConceptSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const concept = await PayrollConceptService.update(companyId, conceptId, parsed.data);
    revalidate(companyId);
    return { success: true, data: concept };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al actualizar concepto";
    return { success: false, error: msg };
  }
}

// ── deleteConceptAction — ADMIN_ONLY (solo no-sistema) ───────────────────────
export async function deleteConceptAction(
  companyId: string,
  conceptId: string
): Promise<Result<{ deleted: true }>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Solo el Administrador puede eliminar conceptos" };

  try {
    await PayrollConceptService.delete(companyId, conceptId);
    revalidate(companyId);
    return { success: true, data: { deleted: true } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al eliminar concepto";
    return { success: false, error: msg };
  }
}
