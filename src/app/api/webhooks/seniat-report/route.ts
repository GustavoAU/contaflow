/**
 * POST /api/webhooks/seniat-report
 *
 * Worker QStash para transmisión PA-121 al SENIAT (ADR-019 D-1).
 * Verifica firma QStash antes de procesar — nunca procesa sin firma válida.
 * Ruta pública (sin Clerk) — configurada en src/middleware.ts.
 */

import { Receiver } from "@upstash/qstash";
import { NextRequest, NextResponse } from "next/server";
import { SeniatReportingService } from "@/modules/invoices/services/SeniatReportingService";
import { checkRateLimit, limiters } from "@/lib/ratelimit";

export async function POST(request: NextRequest) {
  // 1. Rate limit de defensa profunda (ADR-019 MEDIUM finding — limiters.qstash)
  const rl = await checkRateLimit("qstash:seniat-report", limiters.qstash);
  if (!rl.allowed) {
    return NextResponse.json({ error: rl.error }, { status: 429 });
  }

  // 2. Verificar firma QStash (ADR-019 CRITICAL C-2)
  const signingKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (process.env.NODE_ENV !== "development") {
    if (!signingKey || !nextSigningKey) {
      console.error("[seniat-report] QSTASH_CURRENT_SIGNING_KEY o QSTASH_NEXT_SIGNING_KEY no configurados");
      return NextResponse.json({ error: "Configuración de firma ausente" }, { status: 500 });
    }

    const receiver = new Receiver({
      currentSigningKey: signingKey,
      nextSigningKey: nextSigningKey,
    });

    const body = await request.text();
    const signature = request.headers.get("upstash-signature") ?? "";

    const isValid = await receiver.verify({ signature, body }).catch(() => false);
    if (!isValid) {
      return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
    }

    // Parsear el body ya leído — guard B6 (auditoría 2026-06)
    let data: { submissionId?: string };
    try {
      data = JSON.parse(body) as { submissionId?: string };
    } catch {
      return NextResponse.json({ error: "Body inválido" }, { status: 400 });
    }
    return handleTransmit(data.submissionId);
  }

  // En desarrollo: omitir verificación de firma
  const data = (await request.json()) as { submissionId?: string };
  return handleTransmit(data.submissionId);
}

async function handleTransmit(submissionId: string | undefined) {
  if (!submissionId) {
    return NextResponse.json({ error: "submissionId requerido" }, { status: 400 });
  }

  const result = await SeniatReportingService.transmit(submissionId);

  if (!result.success) {
    // Retornar 500 para que QStash reintente con backoff exponencial
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, referenceId: result.referenceId });
}
