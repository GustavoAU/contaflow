// src/modules/fixed-assets/actions/fixed-asset.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

import prisma from "@/lib/prisma";
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
  PostINPCRestatementSchema,
} from "../schemas/fixed-asset.schema";
import { generateDepreciationSchedule } from "../services/FixedAssetService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

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
    return toActionError(error);
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

    // Guard: período mensual cerrado (R-3 — CLAUDE.md)
    const periodClosed = await prisma.accountingPeriod.findFirst({
      where: {
        companyId: parsed.data.companyId,
        year:      parsed.data.year,
        month:     parsed.data.month,
        status:    "CLOSED",
      },
    });
    if (periodClosed) {
      return {
        success: false,
        error: `El período ${parsed.data.year}/${String(parsed.data.month).padStart(2, "0")} está cerrado.`,
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
    return toActionError(error);
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

    // Guard R-3: año fiscal cerrado
    const disposalYear = parsed.data.disposalDate.getFullYear();
    const yearClosed = await FiscalYearCloseService.isFiscalYearClosed(
      parsed.data.companyId,
      disposalYear,
    );
    if (yearClosed) {
      return {
        success: false,
        error: `El ejercicio económico ${disposalYear} está cerrado. No se puede dar de baja un activo en un ejercicio cerrado.`,
      };
    }

    // Guard R-3: período mensual cerrado
    const disposalMonth = parsed.data.disposalDate.getMonth() + 1;
    const periodClosed = await prisma.accountingPeriod.findFirst({
      where: {
        companyId: parsed.data.companyId,
        year:      disposalYear,
        month:     disposalMonth,
        status:    "CLOSED",
      },
    });
    if (periodClosed) {
      return {
        success: false,
        error: `El período ${disposalYear}/${String(disposalMonth).padStart(2, "0")} está cerrado.`,
      };
    }

    await prisma.$transaction(async (tx) =>
      withCompanyContext(parsed.data.companyId, tx, async (tx) =>
        FixedAssetService.dispose(parsed.data, userId, tx)
      )
    );

    revalidatePath(`/company/${parsed.data.companyId}/fixed-assets`);
    return { success: true, data: undefined };
  } catch (error) {
    return toActionError(error);
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
    return toActionError(error);
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
    return toActionError(error);
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
): Promise<ActionResult<{ processed: number; skipped: number; errors: string[]; noPeriods?: boolean; nextPeriodLabel?: string; closedYearCount?: number }>> {
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

    // Pre-cargar períodos mensuales cerrados (R-3)
    const closedPeriods = await prisma.accountingPeriod.findMany({
      where: { companyId: parsed.data.companyId, status: "CLOSED" },
      select: { year: true, month: true },
    });
    const closedSet = new Set(closedPeriods.map((p) => `${p.year}-${p.month}`));

    // F2/VEN-NIF 8: pre-cargar ejercicios fiscales cerrados
    const closedFiscalYears = await prisma.fiscalYearClose.findMany({
      where: { companyId: parsed.data.companyId },
      select: { year: true },
    });
    const closedYearSet = new Set(closedFiscalYears.map((y) => y.year));

    let curYear = startYear;
    let curMonth = startMonth;
    let processed = 0;
    let skipped = 0;
    const errors: string[] = [];
    // Períodos pendientes en ejercicios cerrados → un solo asiento VEN-NIF 8
    const closedYearPending: { year: number; month: number }[] = [];

    // Cada mes en su propio $transaction — evita timeout en activos con muchos períodos
    while (curYear < nowYear || (curYear === nowYear && curMonth <= nowMonth)) {
      const y = curYear;
      const m = curMonth;
      // Avanzar cursor antes del continue para no entrar en loop infinito
      curMonth++;
      if (curMonth > 12) { curMonth = 1; curYear++; }

      // Saltar períodos mensuales cerrados (R-3 — CLAUDE.md)
      if (closedSet.has(`${y}-${m}`)) { skipped++; continue; }

      // VEN-NIF 8: ejercicio fiscal cerrado → acumular para un solo asiento correctivo
      if (closedYearSet.has(y)) {
        const existing = await prisma.depreciationEntry.findUnique({
          where: { fixedAssetId_periodYear_periodMonth: { fixedAssetId: parsed.data.assetId, periodYear: y, periodMonth: m } },
        });
        if (!existing) closedYearPending.push({ year: y, month: m });
        else skipped++;
        continue;
      }

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
    }

    // VEN-NIF 8: un asiento consolidado para todos los períodos de ejercicios cerrados
    let closedYearCount = 0;
    if (closedYearPending.length > 0) {
      try {
        const result = await prisma.$transaction(async (tx) =>
          withCompanyContext(parsed.data.companyId, tx, async (tx) =>
            FixedAssetService.postClosedYearCatchUpDepreciation(
              parsed.data.assetId,
              parsed.data.companyId,
              closedYearPending,
              userId,
              tx,
            )
          )
        );
        closedYearCount = result.processed;
        processed += result.processed;
        skipped += (closedYearPending.length - result.processed);
      } catch (e) {
        errors.push(`VEN-NIF 8 ajuste: ${e instanceof Error ? e.message : "Error desconocido"}`);
      }
    }

    revalidatePath(`/company/${parsed.data.companyId}/fixed-assets`);
    return { success: true, data: { processed, skipped, errors, closedYearCount } };
  } catch (error) {
    return toActionError(error);
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

    // Pre-cargar períodos mensuales cerrados R-3 (una sola query para todos los activos)
    const closedPeriodsAll = await prisma.accountingPeriod.findMany({
      where: { companyId: parsed.data.companyId, status: "CLOSED" },
      select: { year: true, month: true },
    });
    const closedSetAll = new Set(closedPeriodsAll.map((p) => `${p.year}-${p.month}`));

    // F2/VEN-NIF 8: ejercicios fiscales cerrados
    const closedFiscalYearsAll = await prisma.fiscalYearClose.findMany({
      where: { companyId: parsed.data.companyId },
      select: { year: true },
    });
    const closedYearSetAll = new Set(closedFiscalYearsAll.map((y) => y.year));

    let totalProcessed = 0;
    let totalSkipped = 0;
    const assetErrors: Record<string, string[]> = {};

    for (const asset of assets) {
      const { startYear, startMonth, nowYear, nowMonth } = computeCatchUpMonths(asset.acquisitionDate);

      // Skip assets with no depreciable periods yet
      if (startYear > nowYear || (startYear === nowYear && startMonth > nowMonth)) continue;

      let curYear = startYear;
      let curMonth = startMonth;
      const closedYearPendingAsset: { year: number; month: number }[] = [];

      while (curYear < nowYear || (curYear === nowYear && curMonth <= nowMonth)) {
        const y = curYear;
        const m = curMonth;
        // Avanzar cursor antes del continue para no entrar en loop infinito
        curMonth++;
        if (curMonth > 12) { curMonth = 1; curYear++; }

        // Saltar períodos mensuales cerrados (R-3 — CLAUDE.md)
        if (closedSetAll.has(`${y}-${m}`)) { totalSkipped++; continue; }

        // VEN-NIF 8: ejercicio fiscal cerrado → acumular para asiento consolidado
        if (closedYearSetAll.has(y)) {
          const existing = await prisma.depreciationEntry.findUnique({
            where: { fixedAssetId_periodYear_periodMonth: { fixedAssetId: asset.id, periodYear: y, periodMonth: m } },
          });
          if (!existing) closedYearPendingAsset.push({ year: y, month: m });
          else totalSkipped++;
          continue;
        }

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
      }

      // VEN-NIF 8: asiento consolidado por activo con períodos de ejercicios cerrados
      if (closedYearPendingAsset.length > 0) {
        try {
          const result = await prisma.$transaction(async (tx) =>
            withCompanyContext(parsed.data.companyId, tx, async (tx) =>
              FixedAssetService.postClosedYearCatchUpDepreciation(
                asset.id,
                parsed.data.companyId,
                closedYearPendingAsset,
                userId,
                tx,
              )
            )
          );
          totalProcessed += result.processed;
          totalSkipped += (closedYearPendingAsset.length - result.processed);
        } catch (e) {
          if (!assetErrors[asset.name]) assetErrors[asset.name] = [];
          assetErrors[asset.name]!.push(`VEN-NIF 8: ${e instanceof Error ? e.message : "Error desconocido"}`);
        }
      }
    }

    revalidatePath(`/company/${parsed.data.companyId}/fixed-assets`);
    return { success: true, data: { totalProcessed, totalSkipped, assetErrors } };
  } catch (error) {
    return toActionError(error);
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
    return toActionError(error);
  }
}

// ─── Reajuste por Inflación INPC — Activos Fijos (FC-01 / Art. 173 ISLR) ──────

export async function postFixedAssetINPCRestatementAction(
  input: unknown,
): Promise<ActionResult<{ processed: number; skipped: number; totalAdjustment: string }>> {
  const parsed = PostINPCRestatementSchema.safeParse(input);
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
    if (!canAccess(member.role, ROLES.ACCOUNTING))
      return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

    // Guard R-3: año fiscal cerrado
    const yearClosed = await FiscalYearCloseService.isFiscalYearClosed(
      parsed.data.companyId,
      parsed.data.periodYear,
    );
    if (yearClosed)
      return { success: false, error: `El ejercicio económico ${parsed.data.periodYear} está cerrado.` };

    // Guard R-3: período mensual cerrado
    const periodClosed = await prisma.accountingPeriod.findFirst({
      where: {
        companyId: parsed.data.companyId,
        year:      parsed.data.periodYear,
        month:     parsed.data.periodMonth,
        status:    "CLOSED",
      },
    });
    if (periodClosed)
      return {
        success: false,
        error: `El período ${parsed.data.periodYear}/${String(parsed.data.periodMonth).padStart(2, "0")} está cerrado.`,
      };

    const result = await prisma.$transaction(async (tx) =>
      withCompanyContext(parsed.data.companyId, tx, async (tx) =>
        FixedAssetService.postINPCRestatement(parsed.data, userId, tx),
      ),
    );

    revalidatePath(`/company/${parsed.data.companyId}/fixed-assets`);
    return {
      success: true,
      data: {
        processed:       result.processed,
        skipped:         result.skipped,
        totalAdjustment: result.totalAdjustment.toFixed(2),
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Conciliación GL vs. Módulo (FU-03) ───────────────────────────────────────

export type GLReconciliationResultRow = {
  accDepreciationAccountId: string;
  accountCode:  string;
  accountName:  string;
  moduleTotal:  string;   // Decimal → string (toFixed 2)
  glTotal:      string;
  difference:   string;
  assetCount:   number;
};

export async function getFixedAssetGLReconciliationAction(
  companyId: string,
): Promise<ActionResult<GLReconciliationResultRow[]>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.ACCOUNTING))
      return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

    const rows = await FixedAssetService.getGLReconciliation(companyId);
    return {
      success: true,
      data: rows.map((r) => ({
        accDepreciationAccountId: r.accDepreciationAccountId,
        accountCode: r.accountCode,
        accountName: r.accountName,
        moduleTotal: r.moduleTotal.toFixed(2),
        glTotal:     r.glTotal.toFixed(2),
        difference:  r.difference.toFixed(2),
        assetCount:  r.assetCount,
      })),
    };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── N3: Historial INPC por activo ────────────────────────────────────────────

export type INPCRestatementHistoryRow = {
  id:                string;
  assetId:           string;
  assetName:         string;
  inpcPeriodYear:    number;
  inpcPeriodMonth:   number;
  factor:            string;
  adjustmentAmount:  string;
  previousBookValue: string;
  newRestatedValue:  string;
  createdAt:         string;
};

export async function getFixedAssetINPCHistoryAction(
  companyId: string,
  assetId?: string,
): Promise<ActionResult<INPCRestatementHistoryRow[]>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.ACCOUNTING))
      return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

    const rows = await FixedAssetService.getINPCRestatementHistory(companyId, assetId);
    return {
      success: true,
      data: rows.map((r) => ({
        id:                r.id,
        assetId:           r.assetId,
        assetName:         r.assetName,
        inpcPeriodYear:    r.inpcPeriodYear,
        inpcPeriodMonth:   r.inpcPeriodMonth,
        factor:            r.factor.toFixed(6),
        adjustmentAmount:  r.adjustmentAmount.toFixed(2),
        previousBookValue: r.previousBookValue.toFixed(2),
        newRestatedValue:  r.newRestatedValue.toFixed(2),
        createdAt:         r.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── N4: Importar desde Compras — lista gastos CONFIRMED para pre-llenar formulario ─

export type ExpenseForAssetImport = {
  id:            string;
  concept:       string;
  amount:        string;   // Decimal → string
  currency:      string;
  invoiceNumber: string | null;
  invoiceDate:   string | null;  // ISO date
  vendorName:    string | null;
  vendorRif:     string | null;
};

export async function getExpensesForAssetImportAction(
  companyId: string,
): Promise<ActionResult<ExpenseForAssetImport[]>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.ACCOUNTING))
      return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

    const expenses = await prisma.expense.findMany({
      where: { companyId, status: "CONFIRMED", deletedAt: null },
      include: { vendor: { select: { name: true, rif: true } } },
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      take: 50,
    });

    return {
      success: true,
      data: expenses.map((e) => ({
        id:            e.id,
        concept:       e.concept,
        amount:        e.amount.toFixed(2),
        currency:      e.currency,
        invoiceNumber: e.invoiceNumber ?? null,
        invoiceDate:   e.invoiceDate ? e.invoiceDate.toISOString().slice(0, 10) : null,
        vendorName:    e.vendor?.name ?? e.supplierName ?? null,
        vendorRif:     e.vendor?.rif ?? null,
      })),
    };
  } catch (error) {
    return toActionError(error);
  }
}
