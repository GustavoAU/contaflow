/**
 * GET /api/health
 *
 * Health check endpoint para status pages / uptime monitors (Instatus, UptimeRobot, etc.).
 * Ruta pública — configurada en src/middleware.ts.
 *
 * Respuesta pública (sin token): { ok } — solo el código HTTP importa al monitor.
 * Respuesta autorizada (Bearer HEALTH_CHECK_SECRET): detalle completo por servicio.
 *
 * Retorna 200 si todos los servicios configurados están saludables.
 * Retorna 503 si algún servicio falla.
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FullHealthStatus {
  ok: boolean;
  db: "ok" | "error";
  redis: "ok" | "error" | "not_configured";
  qstash: "configured" | "not_configured";
  timestamp: string;
  version: string;
}

export async function GET(req: Request): Promise<NextResponse> {
  const checks = await Promise.allSettled([
    checkDb(),
    checkRedis(),
  ]);

  const dbOk = checks[0].status === "fulfilled" && checks[0].value;
  const redisResult = checks[1].status === "fulfilled" ? checks[1].value : "error";
  const ok = dbOk && redisResult !== "error";
  const status = ok ? 200 : 503;

  // Detalles de infraestructura solo para monitores autorizados con token secreto.
  // HEALTH_CHECK_SECRET se configura en Vercel env vars y en el panel del uptime monitor.
  const secret = process.env.HEALTH_CHECK_SECRET;
  const authHeader = req.headers.get("authorization");
  const isAuthorized = secret && authHeader === `Bearer ${secret}`;

  if (isAuthorized) {
    const body: FullHealthStatus = {
      ok,
      db: dbOk ? "ok" : "error",
      redis: redisResult,
      qstash: process.env.QSTASH_TOKEN ? "configured" : "not_configured",
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? "unknown",
    };
    return NextResponse.json(body, { status });
  }

  return NextResponse.json({ ok }, { status });
}

async function checkDb(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<FullHealthStatus["redis"]> {
  if (!redis) return "not_configured";
  try {
    const pong = await redis.ping();
    return pong === "PONG" ? "ok" : "error";
  } catch {
    return "error";
  }
}
