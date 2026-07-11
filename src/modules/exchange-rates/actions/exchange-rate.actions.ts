"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { Currency } from "@prisma/client";
import { UpsertExchangeRateSchema, GetRateSchema } from "../schemas/exchange-rate.schema";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { ExchangeRateService, ExchangeRateSummary } from "../services/ExchangeRateService";
import { BcvFetchService } from "../services/BcvFetchService";
import { limiters } from "@/lib/ratelimit";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── Upsert tasa BCV ──────────────────────────────────────────────────────────
export async function upsertExchangeRateAction(
  input: unknown,
): Promise<ActionResult<ExchangeRateSummary>> {
  try {
    const parsed = UpsertExchangeRateSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    const { companyId, currency, rate, date, source } = parsed.data;

    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.WRITERS,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const { userId, ipAddress, userAgent } = ctx;

    const rateDecimal = new Decimal(rate);
    const dateObj = new Date(date + "T00:00:00.000Z");

    const result = await prisma.$transaction(async (tx) => {
      const record = await ExchangeRateService.upsert(
        tx as typeof prisma,
        companyId,
        currency as Currency,
        dateObj,
        rateDecimal,
        source ?? "BCV",
        userId,
      );
      await tx.auditLog.create({
        data: {
          companyId,
          entityId: record.id,
          entityName: "ExchangeRate",
          action: "UPSERT",
          userId,
          ipAddress,
          userAgent,
          newValue: { companyId, currency, rate, date, source },
        },
      });
      return record;
    });

    revalidatePath(`/company/${companyId}/exchange-rates`);
    return { success: true, data: result };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Listar tasas ─────────────────────────────────────────────────────────────
export async function listExchangeRatesAction(
  companyId: string,
  currency?: Currency,
): Promise<ActionResult<ExchangeRateSummary[]>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY" });
    if (!ctx.ok) return ctx.error;

    const data = await ExchangeRateService.list(companyId, currency);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Fetch BCV interno — shared by USD and EUR actions ───────────────────────
type BcvFetcher = () => Promise<{ rate: Decimal; date: Date }>;

async function fetchBcvCurrencyRateInternal(
  companyId: string,
  currency: Currency,
  fetchBcv: BcvFetcher,
): Promise<ActionResult<ExchangeRateSummary>> {
  try {
    if (!companyId) return { success: false, error: "companyId requerido" };

    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.WRITERS,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const { userId, ipAddress, userAgent } = ctx;

    const { rate, date } = await fetchBcv();

    const result = await prisma.$transaction(async (tx) => {
      const record = await ExchangeRateService.upsert(
        tx as typeof prisma,
        companyId,
        currency,
        date,
        rate,
        "BCV-AUTO",
        userId,
      );
      await tx.auditLog.create({
        data: {
          companyId,
          entityId: record.id,
          entityName: "ExchangeRate",
          action: "UPSERT",
          userId,
          ipAddress,
          userAgent,
          newValue: {
            companyId,
            currency: currency as string,
            rate: rate.toString(),
            date: date.toISOString().split("T")[0],
            source: "BCV-AUTO",
          },
        },
      });
      return record;
    });

    revalidatePath(`/company/${companyId}/exchange-rates`);
    return { success: true, data: result };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Auto-fetch tasa BCV (USD) ────────────────────────────────────────────────
export async function fetchBcvRateAction(
  companyId: string,
): Promise<ActionResult<ExchangeRateSummary>> {
  return fetchBcvCurrencyRateInternal(companyId, Currency.USD, () => BcvFetchService.fetchUsdVes());
}

// ─── Auto-fetch tasa EUR (BCV) ────────────────────────────────────────────────
export async function fetchBcvEurRateAction(
  companyId: string,
): Promise<ActionResult<ExchangeRateSummary>> {
  return fetchBcvCurrencyRateInternal(companyId, Currency.EUR, () => BcvFetchService.fetchEurVes());
}

// ─── Obtener las 2 tasas más recientes (para calcular delta en el widget) ──────
export type RateWithDelta = ExchangeRateSummary & { delta: string | null };

export async function getLatestRatesWithDeltaAction(
  companyId: string,
): Promise<ActionResult<{ usd: RateWithDelta | null; eur: RateWithDelta | null }>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY" });
    if (!ctx.ok) return ctx.error;

    async function rateWithDelta(currency: Currency): Promise<RateWithDelta | null> {
      const records = await prisma.exchangeRate.findMany({
        where: { companyId, currency },
        orderBy: { date: "desc" },
        take: 2,
      });
      if (records.length === 0) return null;
      const current = records[0]!;
      const prev = records[1] ?? null;
      const delta = prev
        ? new Decimal(current.rate.toString()).minus(prev.rate.toString()).toFixed(4)
        : null;
      return { ...current, rate: current.rate.toString(), delta };
    }

    const [usd, eur] = await Promise.all([
      rateWithDelta(Currency.USD),
      rateWithDelta(Currency.EUR),
    ]);

    return { success: true, data: { usd, eur } };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Obtener tasa más reciente (para precompletar form) ───────────────────────
export async function getLatestRateAction(
  companyId: string,
  currency: Currency,
): Promise<ActionResult<ExchangeRateSummary | null>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY" });
    if (!ctx.ok) return ctx.error;

    const parsed = GetRateSchema.safeParse({
      companyId,
      currency,
      date: new Date().toISOString().split("T")[0],
    });
    if (!parsed.success) return { success: false, error: "Parámetros inválidos" };

    const data = await ExchangeRateService.getLatestRate(companyId, currency);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}
