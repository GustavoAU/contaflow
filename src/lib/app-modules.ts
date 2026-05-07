/**
 * app-modules.ts — Permisos Granulares
 *
 * Fuente de verdad de los módulos de ContaFlow y qué roles tienen acceso
 * por defecto (baseRoles). Los grants en RolePermission son ADITIVOS:
 * amplían el acceso más allá del rol base, nunca lo restringen.
 *
 * Módulos grantables: solo los que tienen sentido ampliar (excluye 'settings').
 * OWNER y ADMIN siempre tienen acceso total — no se les puede quitar.
 */

import type { UserRole } from "@prisma/client";

export const MODULE_KEYS = [
  "accounting",
  "invoicing",
  "banking",
  "payroll",
  "inventory",
  "orders",
  "reports",
] as const;

export type AppModule = (typeof MODULE_KEYS)[number];

export interface ModuleConfig {
  label: string;
  description: string;
  /** Roles que tienen acceso sin ningún grant explícito */
  baseRoles: UserRole[];
}

export const MODULE_CONFIG: Record<AppModule, ModuleConfig> = {
  accounting: {
    label: "Contabilidad",
    description: "Asientos, Plan de Cuentas, INPC, Cierre Fiscal",
    baseRoles: ["OWNER", "ADMIN", "ACCOUNTANT"],
  },
  invoicing: {
    label: "Facturación",
    description: "Libros IVA, Retenciones, Activos Fijos",
    baseRoles: ["OWNER", "ADMIN", "ACCOUNTANT", "ADMINISTRATIVE"],
  },
  banking: {
    label: "Banca y Pagos",
    description: "Conciliación Bancaria, Pagos, Lotes de Pago",
    baseRoles: ["OWNER", "ADMIN", "ACCOUNTANT", "ADMINISTRATIVE", "VIEWER"],
  },
  payroll: {
    label: "Nómina",
    description: "Empleados, corridas de nómina, prestaciones, IVSS/INCES",
    baseRoles: ["OWNER", "ADMIN", "ACCOUNTANT"],
  },
  inventory: {
    label: "Inventario",
    description: "Productos, movimientos físicos, valoración CPP",
    baseRoles: ["OWNER", "ADMIN", "ACCOUNTANT", "ADMINISTRATIVE"],
  },
  orders: {
    label: "Compras y Ventas",
    description: "Órdenes de compra/venta, cotizaciones, proveedores, clientes",
    baseRoles: ["OWNER", "ADMIN", "ACCOUNTANT", "ADMINISTRATIVE"],
  },
  reports: {
    label: "Reportes",
    description: "Declaración IVA, estados financieros, exportar datos",
    baseRoles: ["OWNER", "ADMIN", "ACCOUNTANT", "SENIAT"],
  },
};

/**
 * Roles que pueden recibir grants (OWNER y ADMIN ya tienen todo;
 * SENIAT tiene acceso de auditoría fijo por ADR-019).
 */
export const GRANTABLE_ROLES: UserRole[] = [
  "ACCOUNTANT",
  "ADMINISTRATIVE",
  "VIEWER",
];

/** Verifica si un rol tiene acceso base a un módulo (sin considerar grants). */
export function hasBaseAccess(role: UserRole, module: AppModule): boolean {
  return MODULE_CONFIG[module].baseRoles.includes(role);
}

/**
 * Verifica acceso considerando base + grants.
 * @param grants - Set de strings "ROLE:module" para la empresa actual
 */
export function canAccessModule(
  role: UserRole,
  module: AppModule,
  grants: Set<string>
): boolean {
  // OWNER y ADMIN siempre tienen acceso total
  if (role === "OWNER" || role === "ADMIN") return true;
  return hasBaseAccess(role, module) || grants.has(`${role}:${module}`);
}

/** Convierte el array de RolePermission de la BD a un Set rápido. */
export function toGrantSet(
  permissions: { role: string; module: string }[]
): Set<string> {
  return new Set(permissions.map((p) => `${p.role}:${p.module}`));
}
