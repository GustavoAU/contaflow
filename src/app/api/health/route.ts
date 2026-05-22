/**
 * GET /api/health
 *
 * Health check endpoint para status pages / uptime monitors (Instatus, UptimeRobot, etc.).
 * Ruta pública — configurada en src/middleware.ts.
 *
 * Retorna 200 si todos los servicios configurados están saludables.
 * Retorna 503 si algún servicio falla.
 *
 * Respuesta: { ok, db, redis, timestamp, version }
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/ratelimit";

// No ejecutar en el Edge runtime — Prisma requiere Node.js
export const runtime = "nodejs";

// No cachear — cada llamada debe ser un check real
export const dynamic = "force-dynamic";

interface HealthStatus {
  ok: boolean;
  db: "ok" | "error";
  redis: "ok" | "error" | "not_configured";
  qstash: "configured" | "not_configured";
  timestamp: string;
  version: string;
}

export async function GET(): Promise<NextResponse<HealthStatus>> {
  const checks = await Promise.allSettled([
    checkDb(),
    checkRedis(),
  ]);

  const dbOk = checks[0].status === "fulfilled" && checks[0].value;
  const redisResult = checks[1].status === "fulfilled" ? checks[1].value : "error";
  const qstashConfigured = !!process.env.QSTASH_TOKEN;

  const ok = dbOk && (redisResult !== "error");

  const body: HealthStatus = {
    ok,
    db: dbOk ? "ok" : "error",
    redis: redisResult,
    qstash: qstashConfigured ? "configured" : "not_configured",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? "0.1.0",
  };

  return NextResponse.json(body, { status: ok ? 200 : 503 });
}

async function checkDb(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<HealthStatus["redis"]> {
  if (!redis) return "not_configured";
  try {
    const pong = await redis.ping();
    return pong === "PONG" ? "ok" : "error";
  } catch {
    return "error";
  }
}
