"use server";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { MODULE_KEYS } from "@/lib/app-modules";
import type { AppModule } from "@/lib/app-modules";
import type { UserRole } from "@prisma/client";

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

// role enum = definitive guard — OWNER/ADMIN/SENIAT cannot be grant targets
const ToggleSchema = z.object({
  companyId: z.string().min(1),
  role: z.enum(["ACCOUNTANT", "ADMINISTRATIVE", "VIEWER"] as const),
  module: z.enum(MODULE_KEYS),
});

async function getActorMember(companyId: string) {
  const { userId } = await auth();
  if (!userId) return null;
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  return member ? { ...member, userId } : null;
}

async function getIpAndUa(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const h = await headers();
  const ipAddress = h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? null;
  const userAgent = h.get("user-agent") ?? null;
  return { ipAddress, userAgent };
}

/** Devuelve los grants de una empresa — solo ADMIN/OWNER. */
export async function getGrantsAction(
  companyId: string
): Promise<ActionResult<{ role: string; module: string }[]>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autenticado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Sin acceso" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Sin acceso" };

  const rows = await prisma.rolePermission.findMany({
    where: { companyId },
    select: { role: true, module: true },
  });
  return { success: true, data: rows };
}

/** Activa un grant (módulo adicional para un rol en esta empresa). */
export async function grantPermissionAction(input: {
  companyId: string;
  role: UserRole;
  module: AppModule;
}): Promise<ActionResult> {
  const parsed = ToggleSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Datos inválidos" };

  const { companyId, role, module } = parsed.data;

  const actor = await getActorMember(companyId);
  if (!actor) return { success: false, error: "Sin acceso" };
  if (!canAccess(actor.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Solo ADMIN o OWNER pueden modificar permisos" };

  const { allowed } = await checkRateLimit(actor.userId, limiters.fiscal);
  if (!allowed) return { success: false, error: "Demasiadas solicitudes. Intenta más tarde." };

  const { ipAddress, userAgent } = await getIpAndUa();

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.upsert({
      where: { companyId_role_module: { companyId, role, module } },
      create: { id: crypto.randomUUID(), companyId, role, module },
      update: {},
    });
    await tx.auditLog.create({
      data: {
        id: crypto.randomUUID(),
        companyId,
        entityId: `${companyId}:${role}:${module}`,
        entityName: "RolePermission",
        action: "GRANT",
        userId: actor.userId,
        newValue: { role, module },
        ipAddress,
        userAgent,
      },
    });
  });

  revalidatePath(`/company/${companyId}`);
  return { success: true, data: undefined };
}

/** Elimina un grant. */
export async function revokePermissionAction(input: {
  companyId: string;
  role: UserRole;
  module: AppModule;
}): Promise<ActionResult> {
  const parsed = ToggleSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Datos inválidos" };

  const { companyId, role, module } = parsed.data;

  const actor = await getActorMember(companyId);
  if (!actor) return { success: false, error: "Sin acceso" };
  if (!canAccess(actor.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Solo ADMIN o OWNER pueden modificar permisos" };

  const { allowed } = await checkRateLimit(actor.userId, limiters.fiscal);
  if (!allowed) return { success: false, error: "Demasiadas solicitudes. Intenta más tarde." };

  const { ipAddress, userAgent } = await getIpAndUa();

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { companyId, role, module } });
    await tx.auditLog.create({
      data: {
        id: crypto.randomUUID(),
        companyId,
        entityId: `${companyId}:${role}:${module}`,
        entityName: "RolePermission",
        action: "REVOKE",
        userId: actor.userId,
        newValue: { role, module },
        ipAddress,
        userAgent,
      },
    });
  });

  revalidatePath(`/company/${companyId}`);
  return { success: true, data: undefined };
}
