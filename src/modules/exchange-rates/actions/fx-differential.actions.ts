"use server";

// src/modules/exchange-rates/actions/fx-differential.actions.ts
// ADR-027: Acciones server para cálculo y registro del diferencial cambiario (NIC 21).

import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import { Decimal } from "decimal.js";
import prisma from "@/lib/prisma";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import {
  ExchangeDifferentialService,
  type FxDiffSummary,
  type FxDiffLine,
} from "../services/ExchangeDifferentialService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

export type FxDiffLineDto = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceType: "SALE" | "PURCHASE";
  currency: string;
  outstandingForeign: string;
  originalRate: string;
  revalRate: string;
  vesAtOriginal: string;
  vesAtReval: string;
  differential: string;
};

export type FxDiffPreview = {
  lines: FxDiffLineDto[];
  netCxCMovement: string;
  netCxPMovement: string;
  totalFxGain: string;
  totalFxLoss: string;
  hasData: boolean;
};

const CalculateSchema = z.object({
  companyId: z.string().min(1),
  currency: z.enum(["USD", "EUR"]),
  revalRate: z.string().regex(/^\d+(\.\d+)?$/, "Tasa inválida"),
  revaluationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
});

const PostSchema = z.object({
  companyId: z.string().min(1),
  currency: z.enum(["USD", "EUR"]),
  revalRate: z.string().regex(/^\d+(\.\d+)?$/, "Tasa inválida"),
  revaluationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  periodId: z.string().optional(),
});

function serializeSummary(summary: FxDiffSummary): FxDiffPreview {
  const toDto = (l: FxDiffLine): FxDiffLineDto => ({
    invoiceId: l.invoiceId,
    invoiceNumber: l.invoiceNumber,
    invoiceType: l.invoiceType,
    currency: l.currency,
    outstandingForeign: l.outstandingForeign.toFixed(4),
    originalRate: l.originalRate.toFixed(4),
    revalRate: l.revalRate.toFixed(4),
    vesAtOriginal: l.vesAtOriginal.toFixed(2),
    vesAtReval: l.vesAtReval.toFixed(2),
    differential: l.differential.toFixed(2),
  });

  return {
    lines: summary.lines.map(toDto),
    netCxCMovement: summary.netCxCMovement.toFixed(2),
    netCxPMovement: summary.netCxPMovement.toFixed(2),
    totalFxGain: summary.totalFxGain.toFixed(2),
    totalFxLoss: summary.totalFxLoss.toFixed(2),
    hasData: summary.lines.length > 0,
  };
}

// ─── Calcular (previsualización) ──────────────────────────────────────────────
export async function calculateFxDifferentialAction(
  input: unknown
): Promise<ActionResult<FxDiffPreview>> {
  const parsed = CalculateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const { companyId, currency, revalRate } = parsed.data;

    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
    if (!ctx.ok) return ctx.error;

    const rate = new Decimal(revalRate);
    if (rate.lessThanOrEqualTo(0)) {
      return { success: false, error: "La tasa debe ser mayor que cero." };
    }

    const summary = await ExchangeDifferentialService.calculate(
      companyId,
      currency,
      rate,
      prisma as Parameters<typeof ExchangeDifferentialService.calculate>[3]
    );

    return { success: true, data: serializeSummary(summary) };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Registrar asiento de revaluación ────────────────────────────────────────
export async function postFxDifferentialAction(
  input: unknown
): Promise<ActionResult<{ transactionId: string; transactionNumber: string }>> {
  const parsed = PostSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const { companyId, currency, revalRate, revaluationDate, periodId } = parsed.data;

    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.ACCOUNTING,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const { userId, ipAddress, userAgent } = ctx;

    const settings = await prisma.companySettings.findUnique({
      where: { companyId },
      select: {
        arAccountId: true,
        apAccountId: true,
        fxGainAccountId: true,
        fxLossAccountId: true,
      },
    });

    if (!settings?.fxGainAccountId || !settings.fxLossAccountId) {
      return {
        success: false,
        error: "Configure las cuentas de Ganancia y Pérdida Cambiaria en Configuración → Libro Mayor.",
      };
    }
    if (!settings.arAccountId || !settings.apAccountId) {
      return {
        success: false,
        error: "Configure las cuentas CxC y CxP en Configuración → Libro Mayor.",
      };
    }

    const rate = new Decimal(revalRate);
    if (rate.lessThanOrEqualTo(0)) {
      return { success: false, error: "La tasa debe ser mayor que cero." };
    }

    const dateObj = new Date(revaluationDate + "T00:00:00.000Z");
    const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
    const yyyy = dateObj.getFullYear();
    const txNumber = `FX-REVAL-${yyyy}${mm}`;

    // Guard: evitar doble-registro del mismo período
    const existing = await prisma.transaction.findFirst({
      where: { companyId, number: txNumber },
      select: { id: true },
    });
    if (existing) {
      return {
        success: false,
        error: `Ya existe un asiento de revaluación para ${mm}/${yyyy} (${txNumber}). Anule el anterior antes de registrar uno nuevo.`,
      };
    }

    const result = await prisma.$transaction(async (db) => {
      const summary = await ExchangeDifferentialService.calculate(
        companyId,
        currency,
        rate,
        db
      );

      const transactionId = await ExchangeDifferentialService.post(
        summary,
        {
          arAccountId: settings.arAccountId!,
          apAccountId: settings.apAccountId!,
          fxGainAccountId: settings.fxGainAccountId!,
          fxLossAccountId: settings.fxLossAccountId!,
        },
        companyId,
        userId,
        dateObj,
        periodId,
        db
      );

      await db.auditLog.create({
        data: {
          companyId,
          entityId: transactionId,
          entityName: "FxRevaluation",
          action: "CREATE",
          userId,
          ipAddress,
          userAgent,
          newValue: {
            currency,
            revalRate,
            revaluationDate,
            transactionNumber: txNumber,
            linesCount: summary.lines.length,
            totalFxGain: summary.totalFxGain.toFixed(2),
            totalFxLoss: summary.totalFxLoss.toFixed(2),
          },
        },
      });

      return { transactionId, transactionNumber: txNumber };
    });

    revalidatePath(`/company/${companyId}/accounting`);
    revalidatePath(`/company/${companyId}/fx-revaluation`);
    return { success: true, data: result };
  } catch (err) {
    return toActionError(err);
  }
}
