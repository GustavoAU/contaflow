/**
 * GET /api/cron/apply-plan-changes
 *
 * Vercel Cron Job — diario. Verifica el header Authorization: Bearer CRON_SECRET.
 * Aplica los PlanChangeRequest con status=CONFIRMED y effectiveDate <= now().
 * Guard anti-doble-apply: compare-and-swap CONFIRMED → APPLYING (ADR-040 D-5).
 *
 * Auth: mismo patrón que /api/cron/billing-lifecycle
 *   - Sin CRON_SECRET en production → 500
 *   - Con CRON_SECRET → exige Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { applyDuePlanChanges } from "@/modules/billing/services/PlanChangeService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV === "production" && !cronSecret) {
    console.error("[cron/apply-plan-changes] CRON_SECRET no configurado en producción");
    return NextResponse.json({ error: "CRON_SECRET requerido en producción" }, { status: 500 });
  }

  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
  }

  try {
    const { applied, errors } = await applyDuePlanChanges();
    return NextResponse.json({ ok: true, applied, errors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
