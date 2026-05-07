import prisma from "@/lib/prisma";
import { toGrantSet } from "@/lib/app-modules";
import type { AppModule } from "@/lib/app-modules";
import type { UserRole } from "@prisma/client";

export const RolePermissionService = {
  /** Devuelve todos los grants de una empresa como Set "ROLE:module". */
  async getGrants(companyId: string): Promise<Set<string>> {
    const rows = await prisma.rolePermission.findMany({
      where: { companyId },
      select: { role: true, module: true },
    });
    return toGrantSet(rows);
  },

  /** Devuelve los módulos grantados para un rol específico. */
  async getGrantedModules(companyId: string, role: UserRole): Promise<string[]> {
    const rows = await prisma.rolePermission.findMany({
      where: { companyId, role },
      select: { module: true },
    });
    return rows.map((r) => r.module);
  },

  /** Agrega un grant. Idempotente gracias al @@unique. */
  async grant(companyId: string, role: UserRole, module: AppModule): Promise<void> {
    await prisma.rolePermission.upsert({
      where: { companyId_role_module: { companyId, role, module } },
      create: { id: crypto.randomUUID(), companyId, role, module },
      update: {},
    });
  },

  /** Elimina un grant. No falla si no existía. */
  async revoke(companyId: string, role: UserRole, module: AppModule): Promise<void> {
    await prisma.rolePermission.deleteMany({
      where: { companyId, role, module },
    });
  },
};
