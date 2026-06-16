/**
 * GET /api/cron/billing-lifecycle
 *
 * Vercel Cron Job — diario. Verifica el header Authorization: Bearer CRON_SECRET.
 *
 * Flujo:
 *   1. Verifica firma Vercel (CRON_SECRET)
 *   2. runBillingLifecycle(): marca EXPIRED las suscripciones vencidas + envía
 *      recordatorios de renovación 7 y 3 días antes (email + WhatsApp enchufable)
 *   3. Retorna resumen JSON
 *
 * Degradación graceful:
 *   - Sin RESEND_API_KEY → no envía emails (no-op)
 *   - Sin credenciales WhatsApp → no envía WhatsApp (no-op)
 *   - Sin CRON_SECRET → acepta en development, rechaza en production
 */

import { NextRequest, NextResponse } from "next/server";
import { runBillingLifecycle } from "@/modules/billing/services/SubscriptionService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV === "production" && !cronSecret) {
    console.error("[cron/billing-lifecycle] CRON_SECRET no configurado en producción");
    return NextResponse.json({ error: "CRON_SECRET requerido en producción" }, { status: 500 });
  }

  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
  }

  const started = Date.now();
  try {
    const result = await runBillingLifecycle();
    const elapsed = Date.now() - started;
    console.info(
      `[cron/billing-lifecycle] Completado en ${elapsed}ms — ` +
        `${result.expiredMarked} EXPIRED, ${result.reminders7Sent} avisos 7d, ` +
        `${result.reminders3Sent} avisos 3d, ${result.errors.length} errores`,
    );
    return NextResponse.json({ ok: true, elapsed_ms: elapsed, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/billing-lifecycle] Error fatal:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
