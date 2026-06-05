/**
 * GET /api/cron/apply-plan-changes
 *
 * Vercel Cron Job — corre el día 1 de cada mes a las 00:05 UTC.
 * Aplica los PlanChangeRequest con status=CONFIRMED y effectiveDate <= now().
 * Guard anti-doble-apply: compare-and-swap CONFIRMED → APPLYING (ADR-032 D-5).
 */

import { NextRequest, NextResponse } from "next/server";
import { applyDuePlanChanges } from "@/modules/billing/services/PlanChangeService";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { applied, errors } = await applyDuePlanChanges();
    return NextResponse.json({ ok: true, applied, errors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
