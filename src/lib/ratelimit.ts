// src/lib/ratelimit.ts
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const redis = process.env.UPSTASH_REDIS_REST_URL
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

export const limiters = {
  // Mutaciones fiscales: facturas, retenciones, IGTF, cuentas — 30 por minuto por usuario
  fiscal: redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(30, "1 m"),
        prefix: "rl:fiscal",
      })
    : null,
  // OCR con Groq — llamadas costosas: 10 por minuto por usuario
  ocr: redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(10, "1 m"),
        prefix: "rl:ocr",
      })
    : null,
};

export async function checkRateLimit(
  identifier: string,
  limiter: Ratelimit | null
): Promise<{ allowed: true } | { allowed: false; error: string }> {
  if (!limiter) return { allowed: true };
  try {
    const { success, reset } = await limiter.limit(identifier);
    if (!success) {
      const retryIn = Math.ceil((reset - Date.now()) / 1000);
      return {
        allowed: false,
        error: `Demasiadas solicitudes. Intenta de nuevo en ${retryIn} segundos.`,
      };
    }
    return { allowed: true };
  } catch {
    // Si Redis falla, permitir el request — no bloquear al usuario por infra
    return { allowed: true };
  }
}
