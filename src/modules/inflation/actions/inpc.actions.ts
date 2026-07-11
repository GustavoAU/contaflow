// src/modules/inflation/actions/inpc.actions.ts
"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { withCompanyContext } from "@/lib/prisma-rls";
import { limiters } from "@/lib/ratelimit";
import { FiscalYearCloseService } from "@/modules/fiscal-close/services/FiscalYearCloseService";
import { INPCService } from "../services/INPCService";
import {
  UpsertINPCRateSchema,
  RunInflationAdjustmentSchema,
  SetInflationBaseSchema,
} from "../schemas/inpc.schema";
import type { AdjustmentPreviewRow, RepomoPreview, InflationAdjustmentSummary } from "../services/INPCService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

export type SerializedPreviewRow = {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  originalBalance: string;
  cumulativeIndex: string;
  adjustmentAmount: string;
  periodInpc: string;
  baseInpc: string;
};

export type SerializedRepomo = {
  netMonetaryPosition: string;
  factor: string;
  repomoAmount: string; // positivo = pérdida (gasto), negativo = ganancia (ingreso)
};

export type SerializedPreviewResult = {
  rows: SerializedPreviewRow[];
  repomo: SerializedRepomo | null;
};

export type SerializedAdjustmentSummary = {
  adjustedAccounts: number;
  totalAdjustment: string;
  transactionId: string;
  factor: string;
  repomo: string | null;
};

function serializePreviewRow(r: AdjustmentPreviewRow): SerializedPreviewRow {
  return {
    accountId: r.accountId,
    accountCode: r.accountCode,
    accountName: r.accountName,
    accountType: r.accountType,
    originalBalance: r.originalBalance.toFixed(2),
    cumulativeIndex: r.cumulativeIndex.toFixed(6),
    adjustmentAmount: r.adjustmentAmount.toFixed(2),
    periodInpc: r.periodInpc.toFixed(2),
    baseInpc: r.baseInpc.toFixed(2),
  };
}

function serializeRepomo(r: RepomoPreview): SerializedRepomo {
  return {
    netMonetaryPosition: r.netMonetaryPosition.toFixed(2),
    factor: r.factor.toFixed(6),
    repomoAmount: r.repomoAmount.toFixed(2),
  };
}

function serializeSummary(s: InflationAdjustmentSummary): SerializedAdjustmentSummary {
  return {
    adjustedAccounts: s.adjustedAccounts,
    totalAdjustment: s.totalAdjustment.toFixed(2),
    transactionId: s.transactionId,
    factor: s.factor.toFixed(6),
    repomo: s.repomo?.toFixed(2) ?? null,
  };
}

// ─── Upsert índice INPC mensual ────────────────────────────────────────────────

export async function upsertINPCRateAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = UpsertINPCRateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  try {
    const ctx = await requireCompanyAction(parsed.data.companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const { userId, ipAddress, userAgent } = ctx;

    const result = await prisma.$transaction(async (tx) =>
      withCompanyContext(parsed.data.companyId, tx, async (tx) =>
        INPCService.upsertRate(parsed.data, userId, tx, ipAddress, userAgent)
      )
    );

    revalidatePath(`/company/${parsed.data.companyId}/inflation`);
    return { success: true, data: result };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Listar índices INPC ───────────────────────────────────────────────────────

export async function getINPCRatesAction(companyId: string): Promise<ActionResult<{ id: string; year: number; month: number; indexValue: string; source: string | null; createdAt: string }[]>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
    if (!ctx.ok) return ctx.error;

    const rates = await prisma.$transaction(async (tx) =>
      INPCService.getRates(companyId, tx)
    );
    return { success: true, data: rates.map((r) => ({ ...r, indexValue: r.indexValue.toFixed(6), createdAt: r.createdAt.toISOString() })) };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Configurar período base ───────────────────────────────────────────────────

export async function setInflationBaseAction(input: unknown): Promise<ActionResult<void>> {
  const parsed = SetInflationBaseSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  try {
    const ctx = await requireCompanyAction(parsed.data.companyId, {
      roles: ROLES.ADMIN_ONLY,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const { userId, ipAddress, userAgent } = ctx;

    await prisma.$transaction(async (tx) =>
      withCompanyContext(parsed.data.companyId, tx, async (tx) =>
        INPCService.setInflationBase(parsed.data, userId, tx, ipAddress, userAgent)
      )
    );

    revalidatePath(`/company/${parsed.data.companyId}/inflation`);
    return { success: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Preview del ajuste (sin escribir en BD) ───────────────────────────────────

export async function previewInflationAdjustmentAction(
  input: unknown,
): Promise<ActionResult<SerializedPreviewResult>> {
  const parsed = RunInflationAdjustmentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  try {
    const ctx = await requireCompanyAction(parsed.data.companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
    });
    if (!ctx.ok) return ctx.error;

    const result = await prisma.$transaction(async (tx) =>
      INPCService.previewAdjustment(
        parsed.data.companyId,
        parsed.data.periodYear,
        parsed.data.periodMonth,
        parsed.data.adjustmentAccountId,
        tx,
      )
    );

    return {
      success: true,
      data: {
        rows: result.rows.map(serializePreviewRow),
        repomo: result.repomo ? serializeRepomo(result.repomo) : null,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Ejecutar ajuste por inflación ────────────────────────────────────────────

export async function runInflationAdjustmentAction(
  input: unknown,
): Promise<ActionResult<SerializedAdjustmentSummary>> {
  const parsed = RunInflationAdjustmentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };

  try {
    const ctx = await requireCompanyAction(parsed.data.companyId, {
      roles: ROLES.ADMIN_ONLY,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const { userId, ipAddress, userAgent } = ctx;

    // Guard: año fiscal cerrado (ADR-008 D-7)
    const yearClosed = await FiscalYearCloseService.isFiscalYearClosed(
      parsed.data.companyId,
      parsed.data.periodYear,
    );
    if (yearClosed) {
      return {
        success: false,
        error: `El ejercicio económico ${parsed.data.periodYear} está cerrado. No se puede registrar el ajuste.`,
      };
    }

    // Guard: verificar que existen las tasas INPC necesarias antes de ejecutar
    const company = await prisma.company.findUnique({
      where: { id: parsed.data.companyId },
      select: { inflationBaseYear: true, inflationBaseMonth: true },
    });
    if (!company?.inflationBaseYear || !company?.inflationBaseMonth) {
      return {
        success: false,
        error: "No se ha configurado el período base de inflación. Configúralo antes de ejecutar el ajuste.",
      };
    }

    const [baseRate, currentRate] = await Promise.all([
      prisma.iNPCRate.findUnique({
        where: {
          companyId_year_month: {
            companyId: parsed.data.companyId,
            year: company.inflationBaseYear,
            month: company.inflationBaseMonth,
          },
        },
      }),
      prisma.iNPCRate.findUnique({
        where: {
          companyId_year_month: {
            companyId: parsed.data.companyId,
            year: parsed.data.periodYear,
            month: parsed.data.periodMonth,
          },
        },
      }),
    ]);

    if (!baseRate) {
      return {
        success: false,
        error: `No existe tasa INPC base (${company.inflationBaseYear}/${String(company.inflationBaseMonth).padStart(2, "0")}). Cárgala antes de ejecutar el ajuste.`,
      };
    }
    if (!currentRate) {
      return {
        success: false,
        error: `No existe tasa INPC para el período ${parsed.data.periodYear}/${String(parsed.data.periodMonth).padStart(2, "0")}. Cárgala antes de ejecutar el ajuste.`,
      };
    }

    // ADR-008 D-6: Serializable isolation level
    const result = await prisma.$transaction(
      async (tx) =>
        withCompanyContext(parsed.data.companyId, tx, async (tx) =>
          INPCService.runAdjustment(parsed.data, userId, tx, ipAddress, userAgent)
        ),
      { isolationLevel: "Serializable" },
    );

    revalidatePath(`/company/${parsed.data.companyId}/inflation`);
    return { success: true, data: serializeSummary(result) };
  } catch (error) {
    return toActionError(error);
  }
}
