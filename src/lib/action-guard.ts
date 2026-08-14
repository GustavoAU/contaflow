// src/lib/action-guard.ts
// Guard canónico de Server Actions (ADR-041) — ejecuta el ritual completo que antes
// se copiaba a mano ~30 líneas en cada action (167 veces en 60 archivos):
//
//   auth() → rate limit → companyMember lookup → canAccess(rol) [→ ipAddress/userAgent]
//
// Uso:
//   const ctx = await requireCompanyAction(companyId, {
//     roles: ROLES.ACCOUNTING,
//     limiter: limiters.fiscal,
//     captureNet: true,          // solo si la action escribe AuditLog (R-6)
//   });
//   if (!ctx.ok) return ctx.error;
//   // ctx.userId, ctx.role, ctx.ipAddress, ctx.userAgent
//
// Invariante (ADR-041 D-4): este helper NUNCA relaja un guard. Checks más
// restrictivos (ADMIN_ONLY sobre un subconjunto de operaciones, step-up 2FA,
// hasModuleAccess de ADR-025) van DESPUÉS del helper, no dentro.
//
// Rate limit: usa fiscalKey(companyId, userId) — cuota por (empresa × usuario),
// cerrando la deuda técnica documentada en ratelimit.ts (las actions legacy
// pasaban solo userId).
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import type { UserRole } from "@prisma/client";
import type { Ratelimit } from "@upstash/ratelimit";
import prisma from "@/lib/prisma";
import { canAccess } from "@/lib/auth-helpers";
import { checkRateLimit, fiscalKey } from "@/lib/ratelimit";
import { netContext } from "@/lib/net-context";
import { isSupportedCountry, type CountryCode } from "@/lib/countries";

export type GuardOptions = {
  /**
   * Roles permitidos — usar constantes de ROLES (auth-helpers), OBLIGATORIO.
   * `"MEMBER_ANY"` = solo membresía, sin canAccess (lecturas legacy; incluye SENIAT).
   * Security-agent MEDIUM (2026-07-05): el sentinel explícito hace imposible relajar
   * authz por omisión silenciosa — el compilador fuerza la decisión en cada call-site.
   */
  roles: UserRole[] | "MEMBER_ANY";
  /** Limiter a aplicar (p.ej. limiters.fiscal). Omitir = sin rate limit (solo lecturas baratas) */
  limiter?: Ratelimit | null;
  /** Capturar ipAddress/userAgent para AuditLog (R-6). Default false */
  captureNet?: boolean;
};

export type GuardContext = {
  ok: true;
  userId: string;
  role: UserRole;
  /**
   * País de la empresa (ADR-042 D-2) — la clave para despachar config fiscal:
   * `getFiscalConfig(ctx.country)`, schema factories, timezone, capabilities.
   * Sale del MISMO findFirst de membresía; no añade round-trip.
   */
  country: CountryCode;
  ipAddress: string | null;
  userAgent: string | null;
};

export type GuardFailure = {
  ok: false;
  /**
   * Retornable directamente desde la action: `if (!ctx.ok) return ctx.error;`
   * Tipado como la rama de fallo pura (no `ActionResult<never>`) para que sea
   * asignable tanto a `ActionResult<T>` como a returns con forma custom
   * (`{ success: true; url: string } | { success: false; error: string }`).
   */
  error: { success: false; error: string };
};

function fail(error: string): GuardFailure {
  return { ok: false, error: { success: false, error } };
}

/**
 * Guard para Server Actions **sin empresa** — el hueco documentado de ADR-041.
 *
 * Ejecuta `auth()` → rate limit por `user:<userId>` → [`netContext()`]. Es el
 * hogar del ritual para el alta de empresa, el checkout previo y cualquier otra
 * action anterior a que exista un `companyId`. Sin este helper, el siguiente caso
 * vuelve a copiar el ritual a mano — y este proyecto ya pagó esa factura once
 * veces con la IP spoofeable (ADR-041).
 *
 * **No acepta `roles` a propósito**: no hay membresía que evaluar, y que el tipo
 * lo impida hace imposible confundirlo con `requireCompanyAction`.
 */
export type UserGuardOptions = {
  /** Limiter a aplicar. Para el alta de empresa: `limiters.companyCreate` (ADR-043 D-4) */
  limiter?: Ratelimit | null;
  /** Capturar ipAddress/userAgent para AuditLog (R-6). Default false */
  captureNet?: boolean;
};

export type UserGuardContext = {
  ok: true;
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export async function requireUserAction(
  opts: UserGuardOptions = {},
): Promise<UserGuardContext | GuardFailure> {
  const { userId } = await auth();
  if (!userId) return fail("No autorizado");

  // Clave por userId de Clerk: autoritativo y no spoofeable. NO por IP — el CGNAT
  // móvil venezolano colisiona usuarios legítimos, y la action ya exige sesión.
  if (opts.limiter !== undefined) {
    const rl = await checkRateLimit(`user:${userId}`, opts.limiter);
    if (!rl.allowed) return fail(rl.error ?? "Demasiadas solicitudes, intenta más tarde");
  }

  const net = opts.captureNet ? await netContext() : { ipAddress: null, userAgent: null };

  return { ok: true, userId, ...net };
}

export async function requireCompanyAction(
  companyId: string,
  opts: GuardOptions,
): Promise<GuardContext | GuardFailure> {
  // 1. Autenticación
  const { userId } = await auth();
  if (!userId) return fail("No autorizado");

  // 2. Rate limit — por (empresa × usuario), no cuota global del usuario
  if (opts.limiter !== undefined) {
    const rl = await checkRateLimit(fiscalKey(companyId, userId), opts.limiter);
    if (!rl.allowed) return fail(rl.error ?? "Demasiadas solicitudes, intenta más tarde");
  }

  // 3. Membresía — companyId autoritativo desde BD, nunca del body (ADR-004)
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true, company: { select: { country: true } } },
  });
  if (!member) return fail("Empresa no encontrada o acceso denegado");

  // 4. Rol — "MEMBER_ANY" = la membresía basta (lecturas legacy sin canAccess)
  if (opts.roles !== "MEMBER_ANY" && !canAccess(member.role, opts.roles)) {
    return fail("No autorizado");
  }

  // 5. País (ADR-042 D-2). Fallback "VEN" — cubre dos casos: (a) los ~160 mocks
  // legacy de tests que devuelven solo { role } sin company anidada, y (b) un
  // valor no soportado en BD. El guard no puede lanzar: tumbaría TODAS las
  // actions de esa empresa (getFiscalConfig sí lanza, a propósito).
  const rawCountry = member.company?.country;
  let country: CountryCode = "VEN";
  if (rawCountry) {
    if (isSupportedCountry(rawCountry)) {
      country = rawCountry;
    } else {
      // LOW-1 (auditoría MP-4): los dos casos del fallback son muy distintos y
      // colapsaban al mismo silencio. Este es un INCIDENTE DE INTEGRIDAD: hay una
      // fila con un country que ninguna capa de la app debería haber podido
      // escribir (schema.prisma: String libre, sin enum ni CHECK), y la respuesta
      // es aplicar régimen fiscal venezolano. Degradar sí, callar no.
      Sentry.captureMessage("Company.country no soportado — degradando a VEN", {
        level: "warning",
        tags: { companyId, country: rawCountry }, // sin PII fiscal
      });
    }
  }

  // 6. Contexto de red (R-6) — solo si la action lo necesita para AuditLog
  const net = opts.captureNet ? await netContext() : { ipAddress: null, userAgent: null };

  return { ok: true, userId, role: member.role, country, ...net };
}
