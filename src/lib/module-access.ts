// src/lib/module-access.ts
// Verificación de acceso a módulo considerando rol base + grants granulares (ADR-025).
//
// hasModuleAccess(companyId, role, module) — usar DESPUÉS del companyMember lookup:
//
//   const member = await prisma.companyMember.findFirst({ where: { companyId, userId } });
//   if (!member) return error;
//   if (!await hasModuleAccess(companyId, member.role, "invoicing")) {
//     return { success: false, error: moduleAccessError("invoicing") };
//   }
//
// IMPORTANTE: es un gate ADICIONAL, NUNCA el único. El guard de la action (`roles:` en
// requireCompanyAction, o un `canAccess(ctx.role, ROLES.X)` explícito DESPUÉS de esta
// función) debe ser SIEMPRE restrictivo por sí solo — un grant de RolePermission da
// visibilidad de módulo, nunca debe bastar para autorizar una mutación por su cuenta.
// `roles: "MEMBER_ANY"` + solo esta función = bug de bypass de escritura para VIEWER
// (commit 9d59c2f, 2026-09-27; ver ADR-025 "Corrección 2026-09-27"). Los checks
// ADMIN_ONLY / rol base de escritura van DESPUÉS de esta función, nunca a través de ella.
//
// Optimización: OWNER/ADMIN → retorno inmediato (sin DB).
//               Roles con acceso base → retorno inmediato (sin DB).
//               Solo consulta RolePermission si el rol no tiene acceso base al módulo.

import prisma from "@/lib/prisma";
import { hasBaseAccess, MODULE_CONFIG, type AppModule } from "@/lib/app-modules";
import type { UserRole } from "@prisma/client";

/**
 * Verifica si un rol tiene acceso a un módulo, considerando acceso base + grants granulares.
 *
 * @param companyId - ID de la empresa
 * @param role      - Rol del miembro (de CompanyMember.role)
 * @param module    - Módulo a verificar (de MODULE_KEYS)
 * @returns `true` si el acceso está permitido, `false` si no
 */
export async function hasModuleAccess(
  companyId: string,
  role: UserRole,
  module: AppModule
): Promise<boolean> {
  // Fast path: OWNER/ADMIN siempre tienen acceso total
  if (role === "OWNER" || role === "ADMIN") return true;

  // Fast path: rol tiene acceso base al módulo → sin consulta de grants
  if (hasBaseAccess(role, module)) return true;

  // Solo consulta grants si el rol no tiene acceso base
  // (caso: VIEWER con grant explícito, ADMINISTRATIVE sin base en accounting, etc.)
  const grant = await prisma.rolePermission.findFirst({
    where: { companyId, role, module },
    select: { id: true },
  });

  return grant !== null;
}

/**
 * Mensaje de error estándar para acceso denegado a un módulo.
 * Usa el label en español del módulo para claridad.
 */
export function moduleAccessError(module: AppModule): string {
  const label = MODULE_CONFIG[module].label;
  return `Sin acceso al módulo de ${label}. Contacte al administrador de la empresa.`;
}
