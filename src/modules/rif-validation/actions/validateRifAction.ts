"use server";

// src/modules/rif-validation/actions/validateRifAction.ts

import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { checkRateLimit, limiters, redis } from "@/lib/ratelimit";
import { validateVenezuelanRif } from "@/lib/fiscal-validators";
import prisma from "@/lib/prisma";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RifValidationData = {
  formatValid: boolean;
  legalName: string | null;
  seniatVerified: boolean;
};

export type RifValidationResult =
  | { success: true; data: RifValidationData }
  | { success: false; error: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 86_400; // 24 h — RIF de una empresa no cambia
const SENIAT_TIMEOUT_MS = 3_000;  // 3 s con AbortController (UX)
const CACHE_PREFIX = "rif:seniat:";

// ─── Input schema ─────────────────────────────────────────────────────────────

const Schema = z.object({
  companyId: z.string().min(1, { error: "companyId requerido" }),
  rif: z
    .string()
    .min(1, { error: "RIF requerido" })
    .max(20, { error: "RIF demasiado largo" }),
});

// ─── SENIAT scraper ───────────────────────────────────────────────────────────

/**
 * Intenta obtener la razón social desde el portal público SENIAT.
 *
 * El portal es inestable y puede:
 *  - Requerir CAPTCHA en requests programáticos
 *  - Estar caído (alta frecuencia en Venezuela)
 *  - Bloquear IPs fuera del país
 *
 * En TODOS esos casos retorna null — el caller hace fallback graceful.
 * Timeout estricto de 3 s via AbortController para no degradar UX.
 */
async function fetchLegalNameFromSeniat(rif: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SENIAT_TIMEOUT_MS);

  try {
    // Portal público de consulta de contribuyentes SENIAT
    const url =
      `https://contribuyente.seniat.gob.ve/portal/page/portal/` +
      `MANEJADOR_CONTENIDO_SENIAT/04CONSULTAS/4.01INFO_CONTRIBUYENTES` +
      `?format_id=1&rif=${encodeURIComponent(rif)}`;

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-VE,es;q=0.9",
      },
    });

    if (!res.ok) return null;

    const html = await res.text();

    // Múltiples patrones — el portal SENIAT ha cambiado su HTML varias veces
    const patterns = [
      // Patrón moderno: <td ...>DENOMINACION SOCIAL</td><td ...>EMPRESA CA</td>
      /DENOMINACI[OÓ]N\s+(?:SOCIAL|COMERCIAL)[^<]*<\/[^>]+>\s*<[^>]+>\s*([^<]{3,80})/i,
      // Patrón legacy con span
      /Raz[oó]n\s+Social[^:]*:\s*<[^>]+>\s*([^<]{3,80})/i,
      // Patrón tabla simple
      /<td[^>]*>\s*([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ\s\.,&\-]{2,79}(?:C\.?A\.?|S\.?A\.?|S\.?R\.?L\.?|C\.?V\.?)?)\s*<\/td>/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        const name = match[1].trim().replace(/\s+/g, " ");
        // Filtrar falsos positivos (textos de navegación, labels, etc.)
        if (name.length >= 3 && !/^(denominaci|raz[oó]n|social|rif|nit|fecha)/i.test(name)) {
          return name;
        }
      }
    }

    return null;
  } catch {
    // AbortError (timeout), NetworkError, o cualquier excepción → fallback
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Redis cache helpers ──────────────────────────────────────────────────────

async function getCachedResult(rif: string): Promise<RifValidationData | null> {
  if (!redis) return null;
  try {
    const cached = await redis.get<RifValidationData>(`${CACHE_PREFIX}${rif}`);
    return cached ?? null;
  } catch {
    return null;
  }
}

async function setCachedResult(rif: string, data: RifValidationData): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(`${CACHE_PREFIX}${rif}`, data, { ex: CACHE_TTL_SECONDS });
  } catch {
    // Fallo de caché no es bloqueante
  }
}

// ─── Server Action ────────────────────────────────────────────────────────────

/**
 * Valida un RIF venezolano en dos capas:
 *  1. Formato local (VEN_RIF_REGEX) — instantáneo, siempre funciona
 *  2. Consulta portal SENIAT — obtiene razón social legal, fallback graceful
 *
 * ADR-006 D-1: auth → rateLimit → safeParse → companyMember → lógica
 *
 * @returns
 *  - `formatValid: false` → RIF con formato incorrecto
 *  - `formatValid: true, seniatVerified: false` → formato OK, SENIAT no disponible
 *  - `formatValid: true, seniatVerified: true, legalName: string` → confirmado
 */
export async function validateRifAction(
  companyId: string,
  rif: string,
): Promise<RifValidationResult> {
  // 1. Autenticación
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  // 2. Rate limit (5/min — SENIAT puede bloquear IPs con demasiados requests)
  const rl = await checkRateLimit(userId, limiters.rif);
  if (!rl.allowed) {
    return { success: false, error: rl.error ?? "Demasiadas solicitudes. Intenta más tarde." };
  }

  // 3. Validar input
  const parsed = Schema.safeParse({ companyId, rif });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  // 4. Verificar membresía (cualquier rol puede consultar RIFs)
  const member = await prisma.companyMember.findFirst({
    where: { companyId: parsed.data.companyId, userId },
    select: { role: true },
  });
  if (!member) {
    return { success: false, error: "Empresa no encontrada o acceso denegado" };
  }

  const normalizedRif = parsed.data.rif.trim().toUpperCase();

  // 5. Capa 1: validación de formato local
  if (!validateVenezuelanRif(normalizedRif)) {
    return {
      success: true,
      data: { formatValid: false, legalName: null, seniatVerified: false },
    };
  }

  // 6. Cache hit (evita requests redundantes a SENIAT)
  const cached = await getCachedResult(normalizedRif);
  if (cached) return { success: true, data: cached };

  // 7. Capa 2: consulta SENIAT (fallback graceful si no responde)
  const legalName = await fetchLegalNameFromSeniat(normalizedRif);
  const result: RifValidationData = {
    formatValid: true,
    legalName,
    seniatVerified: legalName !== null,
  };

  // 8. Cachear resultado (seniatVerified true o false — ambos son válidos para cachear)
  await setCachedResult(normalizedRif, result);

  return { success: true, data: result };
}
