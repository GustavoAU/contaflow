"use server";

// src/modules/income-distribution/actions/income-distribution.actions.ts

import { Decimal } from "decimal.js";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import {
  CreateIncomeDistributionSchema,
  ApplyDistributionSchema,
  VoidDistributionSchema,
} from "../schemas/income-distribution.schema";
import {
  createDistribution,
  applyDistribution,
  voidDistribution,
  listDistributions,
  getDistributionById,
  buildIdempotencyKey,
  computeTotalVes,
  type IncomeDistributionSummary,
} from "../services/IncomeDistributionService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── Guard compartido ─────────────────────────────────────────────────────────

async function guardAccounting(
  companyId: string,
): Promise<{ userId: string; ipAddress: string | null; userAgent: string | null } | { success: false; error: string }> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ACCOUNTING,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  return { userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent };
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function createDistributionAction(
  rawInput: unknown,
): Promise<ActionResult<IncomeDistributionSummary>> {
  const parsed = CreateIncomeDistributionSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const guard = await guardAccounting(parsed.data.companyId);
  if ("error" in guard) return guard;

  try {
    const lines = parsed.data.lines.map((l) => ({
      ...l,
      percentageShare: new Decimal(l.percentageShare),
    }));

    const totalOriginal = new Decimal(parsed.data.totalAmountOriginal);
    const rate = new Decimal(parsed.data.exchangeRate);
    const totalVes = computeTotalVes(totalOriginal, rate);

    const idempotencyKey = buildIdempotencyKey(
      parsed.data.companyId,
      new Date(parsed.data.date),
      totalVes,
      lines,
    );

    const dist = await createDistribution({
      companyId: parsed.data.companyId,
      date: new Date(parsed.data.date),
      description: parsed.data.description,
      currencyCode: parsed.data.currencyCode,
      totalAmountOriginal: totalOriginal,
      exchangeRate: rate,
      originAccountId: parsed.data.originAccountId,
      lines,
      createdBy: guard.userId,
      idempotencyKey,
      ipAddress: guard.ipAddress,
      userAgent: guard.userAgent,
    });

    return { success: true, data: dist };
  } catch (err) {
    return toActionError(err);
  }
}

export async function applyDistributionAction(
  rawInput: unknown,
): Promise<ActionResult<IncomeDistributionSummary>> {
  const parsed = ApplyDistributionSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const guard = await guardAccounting(parsed.data.companyId);
  if ("error" in guard) return guard;

  try {
    const dist = await applyDistribution(
      parsed.data.distributionId,
      parsed.data.companyId,
      guard.userId,
      guard.ipAddress,
      guard.userAgent,
    );
    return { success: true, data: dist };
  } catch (err) {
    return toActionError(err);
  }
}

export async function voidDistributionAction(
  rawInput: unknown,
): Promise<ActionResult<IncomeDistributionSummary>> {
  const parsed = VoidDistributionSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const guard = await guardAccounting(parsed.data.companyId);
  if ("error" in guard) return guard;

  try {
    const dist = await voidDistribution(
      parsed.data.distributionId,
      parsed.data.companyId,
      parsed.data.voidReason,
      guard.userId,
      guard.ipAddress,
      guard.userAgent,
    );
    return { success: true, data: dist };
  } catch (err) {
    return toActionError(err);
  }
}

export async function listDistributionsAction(
  companyId: string,
  cursor?: string,
): Promise<ActionResult<{ distributions: IncomeDistributionSummary[]; nextCursor: string | null }>> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  try {
    const result = await listDistributions(companyId, cursor);
    return { success: true, data: result };
  } catch (err) {
    return toActionError(err);
  }
}

export async function getDistributionByIdAction(
  distributionId: string,
  companyId: string,
): Promise<ActionResult<IncomeDistributionSummary | null>> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  try {
    const dist = await getDistributionById(distributionId, companyId);
    return { success: true, data: dist };
  } catch (err) {
    return toActionError(err);
  }
}
