// src/modules/vendors/services/ContactGroupService.ts
import prisma from "@/lib/prisma";

export type ContactGroupRow = {
  id: string;
  companyId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  _count?: { members: number };
};

export const VendorGroupService = {
  async list(companyId: string): Promise<ContactGroupRow[]> {
    const rows = await prisma.vendorGroup.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
      include: { _count: { select: { vendors: true } } },
    });
    return rows.map(({ _count, ...g }) => ({ ...g, _count: { members: _count.vendors } }));
  },

  async create(companyId: string, name: string): Promise<ContactGroupRow> {
    const g = await prisma.vendorGroup.create({
      data: { companyId, name },
    });
    return { ...g, _count: { members: 0 } };
  },

  async delete(companyId: string, groupId: string): Promise<boolean> {
    const g = await prisma.vendorGroup.findUnique({ where: { id: groupId } });
    if (!g || g.companyId !== companyId) return false;
    // Vendors with this groupId become null via onDelete: SetNull (DB constraint)
    await prisma.vendorGroup.delete({ where: { id: groupId } });
    return true;
  },
};

export const CustomerGroupService = {
  async list(companyId: string): Promise<ContactGroupRow[]> {
    const rows = await prisma.customerGroup.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
      include: { _count: { select: { customers: true } } },
    });
    return rows.map(({ _count, ...g }) => ({ ...g, _count: { members: _count.customers } }));
  },

  async create(companyId: string, name: string): Promise<ContactGroupRow> {
    const g = await prisma.customerGroup.create({
      data: { companyId, name },
    });
    return { ...g, _count: { members: 0 } };
  },

  async delete(companyId: string, groupId: string): Promise<boolean> {
    const g = await prisma.customerGroup.findUnique({ where: { id: groupId } });
    if (!g || g.companyId !== companyId) return false;
    await prisma.customerGroup.delete({ where: { id: groupId } });
    return true;
  },
};
