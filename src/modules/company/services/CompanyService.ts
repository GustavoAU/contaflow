// src/modules/company/services/CompanyService.ts
import prisma from "@/lib/prisma";
import { seedExpenseCategories } from "@/modules/expenses/services/ExpenseService";

export class CompanyService {
  /**
   * Crea una nueva empresa y la vincula al usuario como OWNER (Propietario).
   */
  static async createCompany(name: string, userId: string, rif?: string, address?: string, scopeProfile?: "SOLO" | "EMPRESA" | "DESPACHO") {
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
          scopeProfile: scopeProfile ?? null,
          members: {
            create: {
              userId,
              role: "OWNER",
            },
          },
        },
      });

      // Fase 37B: seed de categorías de gastos para la empresa nueva
      await seedExpenseCategories(created.id, tx);

      await tx.auditLog.create({
        data: {
          companyId: created.id,
          entityId: created.id,
          entityName: "Company",
          action: "CREATE",
          userId,
          ipAddress: null,
          userAgent: null,
          newValue: created as object,
        },
      });

      return created;
    });

    return company;
  }

  /**
   * Actualiza los datos fiscales SENIAT de la empresa (PA-121).
   */
  static async updateSeniatData(
    companyId: string,
    userId: string,
    data: {
      name: string;
      rif: string | null;
      address: string | null;
      telefono: string | null;
      email: string | null;
      ciiu: string | null;
      actividad: string | null;
      isSpecialContributor: boolean;
    }
  ) {
    if (data.rif) {
      const existing = await prisma.company.findUnique({
        where: { rif: data.rif },
        select: { id: true },
      });
      if (existing && existing.id !== companyId) {
        throw new Error(`Ya existe otra empresa con el RIF ${data.rif}.`);
      }
    }

    const old = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

    return prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id: companyId },
        data,
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityId: companyId,
          entityName: "Company",
          action: "UPDATE",
          userId,
          ipAddress: null,
          userAgent: null,
          oldValue: old as object,
          newValue: updated as object,
        },
      });

      return updated;
    });
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
          companyId,
          entityId: companyId,
          entityName: "Company",
          action: "ARCHIVE",
          userId,
          ipAddress: null,
          userAgent: null,
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
          companyId,
          entityId: companyId,
          entityName: "Company",
          action: "REACTIVATE",
          userId,
          ipAddress: null,
          userAgent: null,
          oldValue: company as object,
          newValue: updated as object,
        },
      });

      return updated;
    });

    return reactivated;
  }
}
