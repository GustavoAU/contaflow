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
import type { UserRole } from "@prisma/client";
import type { Ratelimit } from "@upstash/ratelimit";
import prisma from "@/lib/prisma";
import { canAccess } from "@/lib/auth-helpers";
import { checkRateLimit, fiscalKey } from "@/lib/ratelimit";
import { netContext } from "@/lib/net-context";

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
    select: { role: true },
  });
  if (!member) return fail("Empresa no encontrada o acceso denegado");

  // 4. Rol — "MEMBER_ANY" = la membresía basta (lecturas legacy sin canAccess)
  if (opts.roles !== "MEMBER_ANY" && !canAccess(member.role, opts.roles)) {
    return fail("No autorizado");
  }

  // 5. Contexto de red (R-6) — solo si la action lo necesita para AuditLog
  const net = opts.captureNet ? await netContext() : { ipAddress: null, userAgent: null };

  return { ok: true, userId, role: member.role, ...net };
}
