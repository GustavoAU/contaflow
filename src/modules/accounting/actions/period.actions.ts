// src/modules/accounting/actions/period.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { PeriodService } from "../services/PeriodService";

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

// ─── Tipo de respuesta ────────────────────────────────────────────────────────

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ─── Obtener período activo ───────────────────────────────────────────────────

export async function getActivePeriodAction(companyId: string) {
  try {
    const period = await PeriodService.getActivePeriod(companyId);
    return { success: true, data: period } as const;
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message } as const;
    return { success: false, error: "Error al obtener el período" } as const;
  }
}

// ─── Obtener todos los períodos ───────────────────────────────────────────────

export async function getPeriodsAction(companyId: string) {
  try {
    const periods = await PeriodService.getPeriods(companyId);
    return { success: true, data: periods } as const;
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message } as const;
    return { success: false, error: "Error al obtener los períodos" } as const;
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
    if (!["OWNER", "ADMIN"].includes(member.role)) return { success: false, error: "No autorizado" };

    const period = await PeriodService.openPeriod(
      validated.companyId,
      validated.year,
      validated.month,
      userId // always use auth() userId, never client-provided
    );

    revalidatePath(`/company/${validated.companyId}/settings`);

    return { success: true, data: { id: period.id, year: period.year, month: period.month } };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false, error: "Datos invalidos" };
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al abrir el período" };
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
    if (!["OWNER", "ADMIN"].includes(member.role)) return { success: false, error: "No autorizado" };

    const period = await PeriodService.closePeriod(validated.companyId, userId);

    revalidatePath(`/company/${validated.companyId}/settings`);

    return { success: true, data: { id: period.id } };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false, error: "Datos invalidos" };
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al cerrar el período" };
  }
}
