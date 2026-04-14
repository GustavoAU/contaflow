"use server";

// src/modules/audit/actions/audit.actions.ts
// Consulta paginada del AuditLog — solo OWNER/ADMIN

import { auth } from "@clerk/nextjs/server";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import prisma from "@/lib/prisma";
import { AuditLogService, type AuditLogFilters, type AuditLogPage } from "../services/AuditLogService";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export async function listAuditLogsAction(
  filters: Omit<AuditLogFilters, "companyId"> & { companyId: string }
): Promise<ActionResult<AuditLogPage>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: filters.companyId } },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
      return { success: false, error: "Solo OWNER y ADMIN pueden ver el registro de auditoría" };
    }

    const data = await AuditLogService.list(filters);
    return { success: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al obtener el registro de auditoría";
    return { success: false, error: msg };
  }
}

export async function getAuditEntityNamesAction(
  companyId: string
): Promise<ActionResult<string[]>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
      return { success: false, error: "No autorizado" };
    }

    const names = await AuditLogService.getDistinctEntityNames(companyId);
    return { success: true, data: names };
  } catch {
    return { success: false, error: "Error al obtener entidades" };
  }
}
