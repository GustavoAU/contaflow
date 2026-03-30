// src/modules/company/services/CompanyService.ts
import prisma from "@/lib/prisma";

export class CompanyService {
  /**
   * Crea una nueva empresa y la vincula al usuario como ADMIN.
   */
  static async createCompany(name: string, userId: string, rif?: string, address?: string) {
    // Verificar que el RIF no exista ya
    if (rif) {
      const existing = await prisma.company.findUnique({ where: { rif } });
      if (existing) throw new Error(`Ya existe una empresa con el RIF ${rif}.`);
    }

    const company = await prisma.$transaction(async (tx) => {
      const created = await tx.company.create({
        data: {
          name,
          rif,
          address,
          status: "ACTIVE",
          members: {
            create: {
              userId,
              role: "ADMIN",
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          entityId: created.id,
          entityName: "Company",
          action: "CREATE",
          userId,
          newValue: created as object,
        },
      });

      return created;
    });

    return company;
  }

  /**
   * Archiva una empresa — no la elimina físicamente.
   * Regla: no se puede archivar si tiene un período abierto.
   */
  static async archiveCompany(companyId: string, userId: string) {
    // Verificar que no haya período abierto
    const activePeriod = await prisma.accountingPeriod.findFirst({
      where: { companyId, status: "OPEN" },
    });

    if (activePeriod) {
      throw new Error(
        "No se puede archivar una empresa con un período contable abierto. Cierra el período primero."
      );
    }

    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new Error("Empresa no encontrada.");
    if (company.status === "ARCHIVED") throw new Error("La empresa ya está archivada.");

    const archived = await prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id: companyId },
        data: { status: "ARCHIVED" },
      });

      await tx.auditLog.create({
        data: {
          entityId: companyId,
          entityName: "Company",
          action: "ARCHIVE",
          userId,
          oldValue: company as object,
          newValue: updated as object,
        },
      });

      return updated;
    });

    return archived;
  }

  /**
   * Reactiva una empresa archivada.
   */
  static async reactivateCompany(companyId: string, userId: string) {
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new Error("Empresa no encontrada.");
    if (company.status === "ACTIVE") throw new Error("La empresa ya está activa.");

    const reactivated = await prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id: companyId },
        data: { status: "ACTIVE" },
      });

      await tx.auditLog.create({
        data: {
          entityId: companyId,
          entityName: "Company",
          action: "REACTIVATE",
          userId,
          oldValue: company as object,
          newValue: updated as object,
        },
      });

      return updated;
    });

    return reactivated;
  }
}
