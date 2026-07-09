"use server";
// src/modules/analytics/actions/p2034-counters.actions.ts

import { ROLES } from "@/lib/auth-helpers";
import { redis } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

export type P2034DayCount = { date: string; count: number };

export async function getP2034CountersAction(
  companyId: string,
): Promise<ActionResult<P2034DayCount[]>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ADMIN_ONLY });
    if (!ctx.ok) return ctx.error;

    if (!redis) return { success: true, data: [] };

    try {
      const today = new Date();
      const dates = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        return d.toISOString().slice(0, 10);
      });

      const keys = dates.map((date) => `p2034:${companyId}:${date}`);
      const raw = (await redis.mget(...keys)) as (number | null)[];

      return {
        success: true,
        data: dates.map((date, i) => ({ date, count: raw[i] ?? 0 })),
      };
    } catch {
      return { success: true, data: [] };
    }
  } catch (error) {
    return toActionError(error);
  }
}
