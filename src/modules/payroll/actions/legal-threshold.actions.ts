"use server";
// src/modules/payroll/actions/legal-threshold.actions.ts
// Ítem 72: Server Actions para gestión de topes legales venezolanos.
//
// Seguridad:
//   - getLegalThresholdsAction: cualquier miembro (ROLES.ALL)
//   - createLegalThresholdAction / deleteLegalThresholdAction: ADMIN_ONLY
//   - companyMember.findFirst siempre verifica pertenencia (IDOR guard)
//   - rate limit con limiters.fiscal en escrituras

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import Decimal from "decimal.js";
import { LegalThresholdService, type LegalThresholdRow } from "../services/LegalThresholdService";
import type { LegalThresholdType } from "@prisma/client";

type Result<T> = { success: true; data: T } | { success: false; error: string };

const CreateSchema = z.object({
  type: z.enum(["SALARY_MIN_VES", "UT_VALUE"]),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD requerido"),
  value: z.string().refine((v) => {
    try { return new Decimal(v).gt(0); } catch { return false; }
  }, "Valor debe ser un número positivo"),
  notes: z.string().max(200).optional(),
});

async function guardAdmin(companyId: string): Promise<{ userId: string } | { success: false; error: string }> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Se requiere rol Administrador" };
  return { userId };
}

async function guardAny(companyId: string): Promise<{ userId: string } | { success: false; error: string }> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ALL))
    return { success: false, error: "Acceso denegado" };
  return { userId };
}

// ── getLegalThresholdsAction ──────────────────────────────────────────────────
export async function getLegalThresholdsAction(
  companyId: string,
): Promise<Result<LegalThresholdRow[]>> {
  try {
    const guard = await guardAny(companyId);
    if ("error" in guard) return guard;
    const data = await LegalThresholdService.list(companyId);
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error al obtener topes legales" };
  }
}

// ── createLegalThresholdAction — ADMIN_ONLY + rate limit ──────────────────────
export async function createLegalThresholdAction(
  companyId: string,
  rawInput: unknown,
): Promise<Result<LegalThresholdRow>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const guard = await guardAdmin(companyId);
    if ("error" in guard) return guard;

    const parsed = CreateSchema.safeParse(rawInput);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    const { type, effectiveFrom, value, notes } = parsed.data;

    const data = await LegalThresholdService.create(companyId, {
      type: type as LegalThresholdType,
      effectiveFrom: new Date(effectiveFrom),
      value: new Decimal(value),
      notes,
    });

    revalidatePath(`/payroll/legal-thresholds`);
    return { success: true, data };
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return { success: false, error: "Ya existe un registro para ese tipo y fecha de vigencia" };
    }
    return { success: false, error: e instanceof Error ? e.message : "Error al crear tope legal" };
  }
}

// ── deleteLegalThresholdAction — ADMIN_ONLY ───────────────────────────────────
export async function deleteLegalThresholdAction(
  companyId: string,
  id: string,
): Promise<Result<void>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const guard = await guardAdmin(companyId);
    if ("error" in guard) return guard;

    await LegalThresholdService.delete(companyId, id);
    revalidatePath(`/payroll/legal-thresholds`);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error al eliminar tope legal" };
  }
}
