// src/modules/accounting/actions/period.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { PeriodService } from "../services/PeriodService";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";
import { extractRequestContext } from "../utils/request-context";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const OpenPeriodSchema = z.object({
  companyId: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  userId: z.string().optional(), // kept for backward compat — action uses auth() userId
});

const ClosePeriodSchema = z.object({
  companyId: z.string().min(1),
  userId: z.string().optional(), // kept for backward compat — action uses auth() userId
});

// ─── Obtener período activo ───────────────────────────────────────────────────

export async function getActivePeriodAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof PeriodService.getActivePeriod>>>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };
    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "No autorizado" };
    const period = await PeriodService.getActivePeriod(companyId);
    return { success: true, data: period };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Obtener todos los períodos ───────────────────────────────────────────────

export async function getPeriodsAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof PeriodService.getPeriods>>>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };
    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "No autorizado" };
    const periods = await PeriodService.getPeriods(companyId);
    return { success: true, data: periods };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Abrir período ────────────────────────────────────────────────────────────

export async function openPeriodAction(
  input: z.infer<typeof OpenPeriodSchema>
): Promise<ActionResult<{ id: string; year: number; month: number }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const validated = OpenPeriodSchema.parse(input);

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: validated.companyId } },
    });
    if (!member) return { success: false, error: "Empresa no encontrada" };
    if (!canAccess(member.role, ROLES.ADMIN_ONLY)) return { success: false, error: "No autorizado" };

    const { ipAddress, userAgent } = await extractRequestContext();

    const period = await PeriodService.openPeriod(
      validated.companyId,
      validated.year,
      validated.month,
      userId,
      ipAddress,
      userAgent,
    );

    revalidatePath(`/company/${validated.companyId}/settings`);

    return { success: true, data: { id: period.id, year: period.year, month: period.month } };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Cerrar período ───────────────────────────────────────────────────────────

export async function closePeriodAction(
  input: z.infer<typeof ClosePeriodSchema>
): Promise<ActionResult<{ id: string }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const validated = ClosePeriodSchema.parse(input);

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: validated.companyId } },
    });
    if (!member) return { success: false, error: "Empresa no encontrada" };
    if (!canAccess(member.role, ROLES.ADMIN_ONLY)) return { success: false, error: "No autorizado" };

    const { ipAddress, userAgent } = await extractRequestContext();

    const period = await PeriodService.closePeriod(validated.companyId, userId, ipAddress, userAgent);

    revalidatePath(`/company/${validated.companyId}/settings`);

    return { success: true, data: { id: period.id } };
  } catch (error) {
    return toActionError(error);
  }
}
