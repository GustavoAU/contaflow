// src/lib/ratelimit.ts
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const redis = process.env.UPSTASH_REDIS_REST_URL
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

// Exported for use in server-side cache (e.g. RIF lookup cache)
export { redis };

/**
 * Construye el identifier compuesto para mutaciones fiscales.
 *
 * Cada (empresa × usuario) tiene su propia ventana de 10/min,
 * evitando que usuarios en múltiples empresas compartan cuota
 * y que un usuario acapare la cuota global de la empresa.
 *
 * Uso:  checkRateLimit(fiscalKey(companyId, userId), limiters.fiscal)
 *
 * Migración incremental: las acciones que todavía no reciben companyId
 * en el punto del rate-limit siguen usando solo userId — deuda técnica
 * documentada en DECISIONS.md.
 */
export function fiscalKey(companyId: string, userId: string): string {
  return `${companyId}:${userId}`;
}

export const limiters = {
  // Mutaciones fiscales: facturas, retenciones, IGTF, cuentas
  // 10/min por (empresa × usuario) — previene doble-submit y spam fiscal
  // Clave: fiscalKey(companyId, userId) — ver helper arriba
  fiscal: redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(10, "1 m"),
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
  // Validación RIF SENIAT — 5 por minuto por usuario (SENIAT puede bloquear IPs)
  rif: redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(5, "1 m"),
        prefix: "rl:rif",
      })
    : null,
  // Exportación masiva — 3 por 10 minutos por usuario (ZIP generation es costoso)
  export: redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(3, "10 m"),
        prefix: "rl:export",
      })
    : null,
  // QStash callbacks — ventana fija 60/min para prevenir flood por reintento descontrolado
  qstash: redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.fixedWindow(60, "1 m"),
        prefix: "rl:qstash",
      })
    : null,
  // Sentry tunnel — 100 req/min por IP para prevenir abuso del relay
  sentry: redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(100, "1 m"),
        prefix: "rl:sentry",
      })
    : null,
  // NOWPayments IPN webhook — 20 req/min por IP para prevenir replay flood
  nowpayments: redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(20, "1 m"),
        prefix: "rl:nowpayments",
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
    // B5: limiters.fiscal falla cerrado — Redis caído bloquea mutaciones fiscales
    // para prevenir que una caída de Redis elimine la protección contra spam fiscal.
    if (limiter === limiters.fiscal) {
      return { allowed: false, error: "Servicio temporalmente no disponible. Intenta de nuevo en unos segundos." };
    }
    // Para otros limiters (ocr, export, etc.) → fail-open: no bloquear al usuario por infra
    return { allowed: true };
  }
}
