/**
 * GET /api/cron/daily-notifications
 *
 * Vercel Cron Job — ejecuta diariamente a las 08:00 UTC-4 (12:00 UTC, hora Venezuela).
 * Verifica el header Authorization: Bearer CRON_SECRET que Vercel inyecta automáticamente.
 *
 * Flujo:
 *   1. Verifica firma Vercel (CRON_SECRET)
 *   2. Llama a NotificationEmailService.sendDailyDigests()
 *   3. Retorna resumen JSON de emails enviados
 *
 * Degradación graceful:
 *   - Sin RESEND_API_KEY → no envía emails, retorna 200 con ok:false
 *   - Sin CRON_SECRET → acepta en development, rechaza en production
 */

import { NextRequest, NextResponse } from "next/server";
import { NotificationEmailService } from "@/modules/notifications/services/NotificationEmailService";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // segundos — suficiente para N empresas

export async function GET(request: NextRequest) {
  // 1. Verificar autorización Vercel Cron
  const cronSecret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV === "production" && !cronSecret) {
    console.error("[cron/daily-notifications] CRON_SECRET no configurado en producción");
    return NextResponse.json({ error: "CRON_SECRET requerido en producción" }, { status: 500 });
  }

  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
  }

  // 2. Ejecutar notificaciones
  const started = Date.now();
  let results;
  try {
    results = await NotificationEmailService.sendDailyDigests();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/daily-notifications] Error fatal:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  const elapsed = Date.now() - started;
  const sent = results.filter((r) => r.emailsSent > 0).length;
  const skipped = results.filter((r) => r.skipped).length;
  const errors = results.filter((r) => r.errors.length > 0 && !r.skipped);

  console.info(
    `[cron/daily-notifications] Completado en ${elapsed}ms — ` +
    `${results.length} empresas, ${sent} con emails enviados, ${skipped} sin tareas, ${errors.length} errores`,
  );

  return NextResponse.json({
    ok: true,
    elapsed_ms: elapsed,
    companies: results.length,
    with_tasks: results.filter((r) => r.taskCount > 0).length,
    emails_sent: sent,
    skipped,
    errors: errors.map((r) => ({ company: r.companyName, errors: r.errors })),
  });
}
