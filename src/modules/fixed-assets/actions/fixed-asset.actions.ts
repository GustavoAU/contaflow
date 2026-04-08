// src/modules/fixed-assets/actions/fixed-asset.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { withCompanyContext } from "@/lib/prisma-rls";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { FiscalYearCloseService } from "@/modules/fiscal-close/services/FiscalYearCloseService";
import { FixedAssetService } from "../services/FixedAssetService";
import {
  CreateFixedAssetSchema,
  PostMonthlyDepreciationSchema,
  DisposeFixedAssetSchema,
} from "../schemas/fixed-asset.schema";
import { generateDepreciationSchedule } from "../services/FixedAssetService";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ─── Crear activo fijo ─────────────────────────────────────────────────────────

export async function createFixedAssetAction(input: unknown): Promise<ActionResult<string>> {
  const parsed = CreateFixedAssetSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (member.role === "VIEWER") return { success: false, error: "No autorizado" };

    // Guard: no permitir en año fiscal cerrado
    const acqYear = parsed.data.acquisitionDate.getFullYear();
    const yearClosed = await FiscalYearCloseService.isFiscalYearClosed(parsed.data.companyId, acqYear);
    if (yearClosed) {
      return {
        success: false,
        error: `El ejercicio económico ${acqYear} está cerrado. No se pueden registrar activos en ejercicios cerrados.`,
      };
    }

    const asset = await prisma.$transaction(async (tx) =>
      withCompanyContext(parsed.data.companyId, tx, async (tx) =>
        FixedAssetService.create(parsed.data, userId, tx)
      )
    );

    revalidatePath(`/company/${parsed.data.companyId}/fixed-assets`);
    return { success: true, data: asset.id };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al registrar el activo" };
  }
}

// ─── Calcular depreciación mensual (todos los activos de la empresa) ───────────

export async function postMonthlyDepreciationAction(
  input: unknown,
): Promise<ActionResult<{ processed: number; skipped: number; errors: string[] }>> {
  const parsed = PostMonthlyDepreciationSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (member.role === "VIEWER") return { success: false, error: "No autorizado" };

    // Guard: año cerrado
    const yearClosed = await FiscalYearCloseService.isFiscalYearClosed(
      parsed.data.companyId,
      parsed.data.year
    );
    if (yearClosed) {
      return {
        success: false,
        error: `El ejercicio económico ${parsed.data.year} está cerrado.`,
      };
    }

    const result = await prisma.$transaction(async (tx) =>
      withCompanyContext(parsed.data.companyId, tx, async (tx) =>
        FixedAssetService.postMonthlyDepreciation(
          parsed.data.companyId,
          parsed.data.year,
          parsed.data.month,
          userId,
          tx,
        )
      )
    );

    revalidatePath(`/company/${parsed.data.companyId}/fixed-assets`);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al calcular la depreciación" };
  }
}

// ─── Dar de baja un activo ─────────────────────────────────────────────────────

export async function disposeFixedAssetAction(input: unknown): Promise<ActionResult<void>> {
  const parsed = DisposeFixedAssetSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (member.role !== "ADMIN") return { success: false, error: "Solo administradores pueden dar de baja activos" };

    await prisma.$transaction(async (tx) =>
      withCompanyContext(parsed.data.companyId, tx, async (tx) =>
        FixedAssetService.dispose(parsed.data, userId, tx)
      )
    );

    revalidatePath(`/company/${parsed.data.companyId}/fixed-assets`);
    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al dar de baja el activo" };
  }
}

// ─── Listado con resumen de valor en libros ────────────────────────────────────

export async function getFixedAssetsAction(
  companyId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof FixedAssetService.getSummary>>>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };

    const assets = await FixedAssetService.getSummary(companyId);
    return { success: true, data: assets };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener los activos" };
  }
}

// ─── Tabla de depreciación de un activo ───────────────────────────────────────

export async function getDepreciationScheduleAction(
  assetId: string,
  companyId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof FixedAssetService.getSchedule>>>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };

    const schedule = await FixedAssetService.getSchedule(assetId, companyId);
    return { success: true, data: schedule };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener la tabla de depreciación" };
  }
}

// ─── Pre-cálculo de tabla de depreciación (sin BD — para vista previa en formulario) ─

export async function previewDepreciationScheduleAction(input: {
  acquisitionCost: string;
  residualValue: string;
  usefulLifeMonths: number;
  depreciationMethod: "LINEA_RECTA" | "SUMA_DIGITOS" | "UNIDADES_PRODUCCION";
  acquisitionDate: Date;
  totalUnits?: number | null;
}): Promise<ActionResult<ReturnType<typeof generateDepreciationSchedule>>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const schedule = generateDepreciationSchedule({
      acquisitionCost: input.acquisitionCost as never,
      residualValue: input.residualValue as never,
      usefulLifeMonths: input.usefulLifeMonths,
      depreciationMethod: input.depreciationMethod,
      acquisitionDate: input.acquisitionDate,
      totalUnits: input.totalUnits ?? null,
    });

    return { success: true, data: schedule };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al calcular la tabla" };
  }
}
