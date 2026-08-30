/**
 * GET /api/cron/payroll-auto-draft
 *
 * Vercel Cron — el 1 y el 16 de cada mes. Deja el borrador de nómina YA
 * CALCULADO esperando revisión humana.
 *
 * **La aprobación NO se automatiza.** Genera el asiento contable y no se
 * revierte, así que la pulsa siempre una persona: esta ruta ni siquiera puede
 * llamar a `approve`, porque el servicio no lo importa.
 *
 * Horario en `vercel.json`: `0 9 1,16 * *` = 05:00 en Venezuela. Programarlo de
 * madrugada UTC lo mandaría a las 20:00–23:59 VET del día ANTERIOR — el 31 en
 * vez del 1, o sea el mes equivocado.
 *
 * Degradación graceful: una empresa que falla no tumba el lote; cada una lleva
 * su propio motivo, y los fallos inesperados van a Sentry con su `companyId`.
 *
 * PENDIENTE conocido: no existe todavía una alerta de dashboard que avise al
 * usuario de que FALTA el proceso del período. Mientras no exista, un cron caído
 * es visible en Sentry pero no en la aplicación.
 */

import { NextRequest, NextResponse } from "next/server";
import { PayrollAutoDraftService } from "@/modules/payroll/services/PayrollAutoDraftService";
import * as Sentry from "@sentry/nextjs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV === "production" && !cronSecret) {
    console.error("[cron/payroll-auto-draft] CRON_SECRET no configurado en producción");
    return NextResponse.json({ error: "CRON_SECRET requerido en producción" }, { status: 500 });
  }
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
  }

  const started = Date.now();
  let results: Awaited<ReturnType<typeof PayrollAutoDraftService.runAutoDrafts>>["results"];
  let total = 0;
  let truncated = false;
  try {
    ({ results, total, truncated } = await PayrollAutoDraftService.runAutoDrafts());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/payroll-auto-draft] Error fatal:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  const elapsed = Date.now() - started;
  const creadas = results.filter((r) => r.status === "CREADA");
  const omitidas = results.filter((r) => r.status === "OMITIDA");
  const fallidas = results.filter((r) => r.status === "FALLIDA");

  if (truncated) {
    // Inanición determinista: el orden es estable, así que las empresas que
    // caen fuera del tope no rotan — no se procesan nunca.
    Sentry.captureMessage("payroll-auto-draft: lote truncado", {
      level: "warning",
      extra: { procesadas: results.length, total },
    });
  }

  console.info(
    `[cron/payroll-auto-draft] Completado en ${elapsed}ms — ` +
    `${results.length}/${total} empresas, ${creadas.length} borradores creados, ` +
    `${omitidas.length} omitidas, ${fallidas.length} fallidas${truncated ? " (LOTE TRUNCADO)" : ""}`,
  );

  return NextResponse.json({
    ok: true,
    elapsed_ms: elapsed,
    companies: results.length,
    total_enabled: total,
    truncated,
    created: creadas.length,
    skipped: omitidas.length,
    failed: fallidas.length,
    // Sólo lo que no salió bien: nombrar a TODAS las empresas cada corte es más
    // superficie de la necesaria en un cuerpo que queda en los logs de Vercel.
    // El motivo nunca lleva datos de trabajadores (ver `clasificar`).
    details: results.filter((r) => r.status !== "CREADA").map((r) => ({
      company: r.companyName,
      status: r.status,
      period: r.periodStart ? `${r.periodStart}..${r.periodEnd}` : null,
      motivo: r.motivo,
    })),
  });
}
