/**
 * GET /api/cron/seniat-outbox — ADR-019 Addendum D-1.1b
 *
 * Poller de huérfanos del outbox PA-121 (relay). Rescata SeniatSubmission en
 * PENDING con attempts = 0 (nunca entraron a QStash: el publish post-commit
 * falló o QSTASH_TOKEN no estaba configurado) y las re-publica.
 *
 * - attempts = 0 evita competir con el ciclo de reintentos del webhook QStash
 *   (que incrementa attempts en cada transmit fallido).
 * - createdAt < now() - 10min da margen al publish post-commit normal.
 * - Idempotente: transmit() descarta duplicados (status IN [SENT, ACKNOWLEDGED]).
 * - Auth: CRON_SECRET (mismo patrón que daily-notifications). Ruta pública en
 *   middleware vía /api/cron/(.*) — la autenticación es el secret, no Clerk.
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { SeniatReportingService } from "@/modules/invoices/services/SeniatReportingService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORPHAN_AGE_MS = 10 * 60 * 1000; // 10 minutos
const BATCH_SIZE = 50;

export async function GET(request: NextRequest) {
  // 1. Verificar autorización Vercel Cron
  const cronSecret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV === "production" && !cronSecret) {
    console.error("[cron/seniat-outbox] CRON_SECRET no configurado en producción");
    return NextResponse.json({ error: "CRON_SECRET requerido en producción" }, { status: 500 });
  }

  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
  }

  // 2. Sin QStash configurado no hay nada que publicar — no-op explícito
  if (!process.env.QSTASH_TOKEN) {
    return NextResponse.json({ ok: true, published: 0, skipped: "QSTASH_TOKEN no configurado" });
  }

  // 3. Buscar huérfanos: PENDING nunca publicados, con margen de 10 min.
  // ADR-004-EXCEPTION: query cross-company de sistema (cron autenticado por
  // CRON_SECRET, no request de usuario) — precedente AuditLogService.
  // Usa el índice @@index([status, createdAt]).
  const cutoff = new Date(Date.now() - ORPHAN_AGE_MS);
  const orphans = await prisma.seniatSubmission.findMany({
    where: {
      status: "PENDING",
      attempts: 0,
      createdAt: { lt: cutoff },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  let published = 0;
  for (const orphan of orphans) {
    // publishSubmission nunca lanza — false cuenta como no publicado
    if (await SeniatReportingService.publishSubmission(orphan.id)) {
      published++;
    }
  }

  console.info(
    `[cron/seniat-outbox] ${orphans.length} huérfanas encontradas, ${published} re-publicadas a QStash`,
  );

  return NextResponse.json({
    ok: true,
    found: orphans.length,
    published,
  });
}
