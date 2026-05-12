"use server";

// src/modules/income-distribution/actions/income-distribution.actions.ts

import { headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { Decimal } from "decimal.js";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import prisma from "@/lib/prisma";
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

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ─── Guard compartido ─────────────────────────────────────────────────────────

async function guardAccounting(
  companyId: string,
): Promise<{ userId: string; ipAddress: string | null; userAgent: string | null } | { success: false; error: string }> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes. Intente más tarde." };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Acceso denegado" };

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

  return { userId, ipAddress, userAgent };
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
    if (err instanceof Error) return { success: false, error: err.message };
    return { success: false, error: "Error al crear la distribución" };
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
    if (err instanceof Error) return { success: false, error: err.message };
    return { success: false, error: "Error al aplicar la distribución" };
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
    if (err instanceof Error) return { success: false, error: err.message };
    return { success: false, error: "Error al anular la distribución" };
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
    if (err instanceof Error) return { success: false, error: err.message };
    return { success: false, error: "Error al listar las distribuciones" };
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
    if (err instanceof Error) return { success: false, error: err.message };
    return { success: false, error: "Error al obtener la distribución" };
  }
}
