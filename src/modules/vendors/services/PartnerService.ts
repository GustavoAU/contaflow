// src/modules/vendors/services/PartnerService.ts
// ADR-054: Partner es el tercero mínimo para socio/accionista — mismo patrón CRUD e
// IDOR (ADR-004) que CustomerService.ts.
import prisma from "@/lib/prisma";
import { normalizeRifOrNull } from "@/lib/tax-config";
import type { CreatePartnerInput, UpdatePartnerInput } from "../schemas/partner.schemas";

export type PartnerRow = {
  id: string;
  companyId: string;
  name: string;
  rif: string | null;
  notes: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export const PartnerService = {
  async list(companyId: string): Promise<PartnerRow[]> {
    return prisma.partner.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { name: "asc" },
    });
  },

  async get(companyId: string, partnerId: string): Promise<PartnerRow | null> {
    const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
    // Post-fetch ownership check (ADR-004)
    if (!partner || partner.companyId !== companyId) return null;
    return partner;
  },

  async create(companyId: string, data: CreatePartnerInput): Promise<PartnerRow> {
    return prisma.partner.create({
      data: {
        companyId,
        name: data.name,
        rif: normalizeRifOrNull(data.rif),
        notes: data.notes ?? null,
      },
    });
  },

  async update(companyId: string, partnerId: string, data: UpdatePartnerInput): Promise<PartnerRow | null> {
    const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
    if (!partner || partner.companyId !== companyId || partner.deletedAt !== null) return null;
    return prisma.partner.update({
      where: { id: partnerId },
      data: {
        ...data,
        ...(data.rif !== undefined ? { rif: normalizeRifOrNull(data.rif) } : {}),
        ...(data.notes !== undefined ? { notes: data.notes ?? null } : {}),
      },
    });
  },

  async softDelete(companyId: string, partnerId: string): Promise<{ deleted: boolean }> {
    const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
    if (!partner || partner.companyId !== companyId || partner.deletedAt !== null) {
      return { deleted: false };
    }
    await prisma.partner.update({
      where: { id: partnerId },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  },
};
