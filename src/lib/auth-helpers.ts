/**
 * auth-helpers.ts — Fase 28A
 *
 * Centraliza la lógica de autorización por rol para ContaFlow.
 * Usa el enum UserRole de Prisma como fuente de verdad.
 *
 * Jerarquía de roles:
 *   OWNER (5) > ADMIN (4) > ACCOUNTANT (3) > ADMINISTRATIVE (2) > VIEWER (1)
 *
 * Uso en Server Actions:
 *   const member = await prisma.companyMember.findFirst({ where: { companyId, userId } });
 *   if (!canAccess(member.role, ROLES.ACCOUNTING)) return { success: false, error: "Rol insuficiente" };
 */

import type { UserRole } from "@prisma/client";

// ─── Jerarquía numérica ───────────────────────────────────────────────────────

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  OWNER: 5,
  ADMIN: 4,
  ACCOUNTANT: 3,
  ADMINISTRATIVE: 2,
  VIEWER: 1,
  // SENIAT: auditor fiscal externo — no forma parte de la jerarquía operativa
  SENIAT: 0,
};

// ─── Grupos predefinidos — DRY ────────────────────────────────────────────────

export const ROLES = {
  /** Todos los roles operativos (excluye SENIAT — auditor externo sin acceso operativo) */
  ALL: ["OWNER", "ADMIN", "ACCOUNTANT", "ADMINISTRATIVE", "VIEWER"] as UserRole[],

  /** Solo propietario + administrador */
  ADMIN_ONLY: ["OWNER", "ADMIN"] as UserRole[],

  /** Módulos contables: OWNER, ADMIN, ACCOUNTANT */
  ACCOUNTING: ["OWNER", "ADMIN", "ACCOUNTANT"] as UserRole[],

  /** Módulos operativos (Fase 28+): OWNER, ADMIN, ADMINISTRATIVE */
  OPERATIONS: ["OWNER", "ADMIN", "ADMINISTRATIVE"] as UserRole[],

  /** Todos excepto VIEWER (puede escribir en su área) */
  WRITERS: ["OWNER", "ADMIN", "ACCOUNTANT", "ADMINISTRATIVE"] as UserRole[],

  /** Auditor fiscal SENIAT — solo informes de auditoría, sin acceso operativo */
  SENIAT_READ: ["SENIAT"] as UserRole[],

  /** Asignación del rol SENIAT — solo OWNER puede hacerlo (ADR-019 D-3) */
  SENIAT_ASSIGNERS: ["OWNER"] as UserRole[],
} as const;

// ─── Función principal de autorización ───────────────────────────────────────

/**
 * Verifica si un rol tiene acceso a una operación.
 *
 * @param userRole   - Rol del miembro (de CompanyMember.role)
 * @param allowedRoles - Array de roles permitidos (usar constantes de ROLES)
 * @returns true si el rol está en la lista permitida
 *
 * @example
 * if (!canAccess(member.role, ROLES.ACCOUNTING)) {
 *   return { success: false, error: "Rol insuficiente" };
 * }
 */
export function canAccess(userRole: UserRole, allowedRoles: UserRole[]): boolean {
  return allowedRoles.includes(userRole);
}

// ─── Label en español para la UI ─────────────────────────────────────────────

export const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  ACCOUNTANT: "Contador",
  ADMINISTRATIVE: "Administrativo",
  VIEWER: "Observador",
  SENIAT: "Auditor SENIAT",
};
