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
import type { ActionResult } from "@/lib/action-result";

export type GuardOptions = {
  /**
   * Roles permitidos — usar constantes de ROLES (auth-helpers).
   * Omitir = solo membresía (lecturas que hoy no llaman canAccess; incluye SENIAT).
   */
  roles?: UserRole[];
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
  /** Retornable directamente desde la action: `if (!ctx.ok) return ctx.error;` */
  error: ActionResult<never>;
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

  // 4. Rol — si se omite roles, la membresía basta (lecturas legacy sin canAccess)
  if (opts.roles && !canAccess(member.role, opts.roles)) return fail("No autorizado");

  // 5. Contexto de red (R-6) — solo si la action lo necesita para AuditLog
  const net = opts.captureNet ? await netContext() : { ipAddress: null, userAgent: null };

  return { ok: true, userId, role: member.role, ...net };
}
