"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction, type GuardContext } from "@/lib/action-guard";
import { MODULE_KEYS } from "@/lib/app-modules";
import type { AppModule } from "@/lib/app-modules";
import type { UserRole } from "@prisma/client";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// role enum = definitive guard — OWNER/ADMIN/SENIAT cannot be grant targets
const ToggleSchema = z.object({
  companyId: z.string().min(1),
  role: z.enum(["ACCOUNTANT", "ADMINISTRATIVE", "VIEWER"] as const),
  module: z.enum(MODULE_KEYS),
});

type PermGuardResult =
  | { actor: GuardContext }
  | { success: false; error: string };

async function guardAdminPermission(companyId: string): Promise<PermGuardResult> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  return { actor: ctx };
}

/** Devuelve los grants de una empresa — solo ADMIN/OWNER. */
export async function getGrantsAction(
  companyId: string
): Promise<ActionResult<{ role: string; module: string }[]>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ADMIN_ONLY });
    if (!ctx.ok) return ctx.error;

    const rows = await prisma.rolePermission.findMany({
      where: { companyId },
      select: { role: true, module: true },
    });
    return { success: true, data: rows };
  } catch (err) {
    return toActionError(err);
  }
}

/** Activa un grant (módulo adicional para un rol en esta empresa). */
export async function grantPermissionAction(input: {
  companyId: string;
  role: UserRole;
  module: AppModule;
}): Promise<ActionResult<void>> {
  const parsed = ToggleSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Datos inválidos" };

  const { companyId, role, module } = parsed.data;

  const g = await guardAdminPermission(companyId);
  if ("success" in g) return g;

  try {
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
          userId: g.actor.userId,
          newValue: { role, module },
          ipAddress: g.actor.ipAddress,
          userAgent: g.actor.userAgent,
        },
      });
    });

    revalidatePath(`/company/${companyId}`);
    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

/** Elimina un grant. */
export async function revokePermissionAction(input: {
  companyId: string;
  role: UserRole;
  module: AppModule;
}): Promise<ActionResult<void>> {
  const parsed = ToggleSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Datos inválidos" };

  const { companyId, role, module } = parsed.data;

  const g = await guardAdminPermission(companyId);
  if ("success" in g) return g;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { companyId, role, module } });
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          companyId,
          entityId: `${companyId}:${role}:${module}`,
          entityName: "RolePermission",
          action: "REVOKE",
          userId: g.actor.userId,
          newValue: { role, module },
          ipAddress: g.actor.ipAddress,
          userAgent: g.actor.userAgent,
        },
      });
    });

    revalidatePath(`/company/${companyId}`);
    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}
