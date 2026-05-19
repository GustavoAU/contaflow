// src/modules/fixed-assets/actions/fixed-asset.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

import prisma from "@/lib/prisma";
import { mapPrismaError } from "@/lib/prisma-errors";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { withCompanyContext } from "@/lib/prisma-rls";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { FiscalYearCloseService } from "@/modules/fiscal-close/services/FiscalYearCloseService";
import { FixedAssetService } from "../services/FixedAssetService";
import {
  CreateFixedAssetSchema,
  PostMonthlyDepreciationSchema,
  DisposeFixedAssetSchema,
  CatchUpAssetSchema,
  CatchUpAllAssetsSchema,
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
    if (!canAccess(member.role, ROLES.ACCOUNTING)) return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

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
    return { success: false, error: mapPrismaError(error) };
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
    if (!canAccess(member.role, ROLES.ACCOUNTING)) return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

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
    return { success: false, error: mapPrismaError(error) };
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
    if (!canAccess(member.role, ROLES.ADMIN_ONLY)) return { success: false, error: "Solo administradores pueden dar de baja activos" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes" };

    await prisma.$transaction(async (tx) =>
      withCompanyContext(parsed.data.companyId, tx, async (tx) =>
        FixedAssetService.dispose(parsed.data, userId, tx)
      )
    );

    revalidatePath(`/company/${parsed.data.companyId}/fixed-assets`);
    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: mapPrismaError(error) };
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
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    // ADR-025: ROLES.ALL — todos los miembros pueden consultar el resumen de activos
    if (!canAccess(member.role, ROLES.ALL)) return { success: false, error: "No autorizado" };

    const assets = await FixedAssetService.getSummary(companyId);
    return { success: true, data: assets };
  } catch (error) {
    return { success: false, error: mapPrismaError(error) };
  }
}

// ─── Tabla de depreciación de un activo ───────────────────────────────────────

type SerializedSchedule = {
  asset: { name: string };
  projected: { year: number; month: number; amount: string; accumulated: string; bookValue: string }[];
  posted: { periodYear: number; periodMonth: number }[];
};

export async function getDepreciationScheduleAction(
  assetId: string,
  companyId: string,
): Promise<ActionResult<SerializedSchedule>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    // ADR-025: ROLES.ALL — todos los miembros pueden ver la tabla de depreciación
    if (!canAccess(member.role, ROLES.ALL)) return { success: false, error: "No autorizado" };

    const schedule = await FixedAssetService.getSchedule(assetId, companyId);

    // Serializar Decimal → string antes de cruzar el boundary Server→Client
    return {
      success: true,
      data: {
        asset: { name: schedule.asset.name },
        projected: schedule.projected.map((r) => ({
          year: r.year,
          month: r.month,
          amount: r.amount.toFixed(2),
          accumulated: r.accumulated.toFixed(2),
          bookValue: r.bookValue.toFixed(2),
        })),
        posted: schedule.posted.map((p) => ({
          periodYear: p.periodYear,
          periodMonth: p.periodMonth,
        })),
      },
    };
  } catch (error) {
    return { success: false, error: mapPrismaError(error) };
  }
}

// ─── Helpers para catch-up ────────────────────────────────────────────────────

function computeCatchUpMonths(
  acquisitionDate: Date,
): { startYear: number; startMonth: number; nowYear: number; nowMonth: number } {
  const acqDate = new Date(acquisitionDate);
  const acqYear = acqDate.getUTCFullYear();
  const acqMonth = acqDate.getUTCMonth() + 1;
  const startMonth = acqMonth === 12 ? 1 : acqMonth + 1;
  const startYear = acqMonth === 12 ? acqYear + 1 : acqYear;
  const now = new Date();
  return { startYear, startMonth, nowYear: now.getFullYear(), nowMonth: now.getMonth() + 1 };
}

const MONTH_NAMES = ["","Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// ─── Poner al día: un activo ──────────────────────────────────────────────────

export async function catchUpAssetDepreciationAction(
  input: unknown,
): Promise<ActionResult<{ processed: number; skipped: number; errors: string[]; noPeriods?: boolean; nextPeriodLabel?: string }>> {
  const parsed = CatchUpAssetSchema.safeParse(input);
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
    if (!canAccess(member.role, ROLES.ACCOUNTING)) return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

    const asset = await prisma.fixedAsset.findFirst({
      where: { id: parsed.data.assetId, companyId: parsed.data.companyId },
    });
    if (!asset) return { success: false, error: "Activo no encontrado" };
    if (asset.status !== "ACTIVE") return { success: false, error: "El activo no está activo" };

    const { startYear, startMonth, nowYear, nowMonth } = computeCatchUpMonths(asset.acquisitionDate);

    // Activo adquirido este mes o en el futuro — aún no tiene períodos depreciables
    if (startYear > nowYear || (startYear === nowYear && startMonth > nowMonth)) {
      return {
        success: true,
        data: {
          processed: 0,
          skipped: 0,
          errors: [],
          noPeriods: true,
          nextPeriodLabel: `${MONTH_NAMES[startMonth]} ${startYear}`,
        },
      };
    }

    let curYear = startYear;
    let curMonth = startMonth;
    let processed = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Cada mes en su propio $transaction — evita timeout en activos con muchos períodos
    while (curYear < nowYear || (curYear === nowYear && curMonth <= nowMonth)) {
      const y = curYear;
      const m = curMonth;
      try {
        const result = await prisma.$transaction(async (tx) =>
          withCompanyContext(parsed.data.companyId, tx, async (tx) =>
            FixedAssetService.postDepreciation(parsed.data.assetId, parsed.data.companyId, y, m, userId, tx)
          )
        );
        if (result.created) processed++;
        else skipped++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error desconocido";
        if (msg.includes("totalmente depreciado") || msg.includes("FULLY_DEPRECIATED")) break;
        errors.push(`${y}/${String(m).padStart(2, "0")}: ${msg}`);
      }

      curMonth++;
      if (curMonth > 12) { curMonth = 1; curYear++; }
    }

    revalidatePath(`/company/${parsed.data.companyId}/fixed-assets`);
    return { success: true, data: { processed, skipped, errors } };
  } catch (error) {
    return { success: false, error: mapPrismaError(error) };
  }
}

// ─── Poner al día: todos los activos ─────────────────────────────────────────

export async function catchUpAllAssetsDepreciationAction(
  input: unknown,
): Promise<ActionResult<{ totalProcessed: number; totalSkipped: number; assetErrors: Record<string, string[]> }>> {
  const parsed = CatchUpAllAssetsSchema.safeParse(input);
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
    if (!canAccess(member.role, ROLES.ACCOUNTING)) return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

    const assets = await prisma.fixedAsset.findMany({
      where: { companyId: parsed.data.companyId, status: "ACTIVE", deletedAt: null },
    });

    let totalProcessed = 0;
    let totalSkipped = 0;
    const assetErrors: Record<string, string[]> = {};

    for (const asset of assets) {
      const { startYear, startMonth, nowYear, nowMonth } = computeCatchUpMonths(asset.acquisitionDate);

      // Skip assets with no depreciable periods yet
      if (startYear > nowYear || (startYear === nowYear && startMonth > nowMonth)) continue;

      let curYear = startYear;
      let curMonth = startMonth;

      while (curYear < nowYear || (curYear === nowYear && curMonth <= nowMonth)) {
        const y = curYear;
        const m = curMonth;
        try {
          const result = await prisma.$transaction(async (tx) =>
            withCompanyContext(parsed.data.companyId, tx, async (tx) =>
              FixedAssetService.postDepreciation(asset.id, parsed.data.companyId, y, m, userId, tx)
            )
          );
          if (result.created) totalProcessed++;
          else totalSkipped++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Error desconocido";
          if (msg.includes("totalmente depreciado") || msg.includes("FULLY_DEPRECIATED")) break;
          if (!assetErrors[asset.name]) assetErrors[asset.name] = [];
          assetErrors[asset.name]!.push(`${y}/${String(m).padStart(2, "0")}: ${msg}`);
        }

        curMonth++;
        if (curMonth > 12) { curMonth = 1; curYear++; }
      }
    }

    revalidatePath(`/company/${parsed.data.companyId}/fixed-assets`);
    return { success: true, data: { totalProcessed, totalSkipped, assetErrors } };
  } catch (error) {
    return { success: false, error: mapPrismaError(error) };
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

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes" };

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
    return { success: false, error: mapPrismaError(error) };
  }
}
