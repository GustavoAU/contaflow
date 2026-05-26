// src/modules/vendors/services/VendorService.ts
import prisma from "@/lib/prisma";
import type { CreateVendorInput, UpdateVendorInput, ContactCategory } from "../schemas/vendor.schemas";

export type VendorRow = {
  id: string;
  companyId: string;
  name: string;
  rif: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  isSpecialContributor: boolean;
  code: string | null;
  groupId: string | null;
  group: { id: string; name: string } | null;
  notes: string | null;
  category: ContactCategory;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const INCLUDE_GROUP = { group: { select: { id: true, name: true } } } as const;

export const VendorService = {
  async list(companyId: string): Promise<VendorRow[]> {
    return prisma.vendor.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { name: "asc" },
      include: INCLUDE_GROUP,
    }) as Promise<VendorRow[]>;
  },

  async get(companyId: string, vendorId: string): Promise<VendorRow | null> {
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: INCLUDE_GROUP,
    });
    // Post-fetch ownership check (ADR-004)
    if (!vendor || vendor.companyId !== companyId) return null;
    return vendor as VendorRow;
  },

  async create(companyId: string, data: CreateVendorInput): Promise<VendorRow> {
    return prisma.vendor.create({
      data: {
        companyId,
        ...data,
        groupId: data.groupId ?? null,
        category: data.category ?? "REGULAR",
        notes: data.notes ?? null,
      },
      include: INCLUDE_GROUP,
    }) as Promise<VendorRow>;
  },

  async update(companyId: string, vendorId: string, data: UpdateVendorInput): Promise<VendorRow | null> {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor || vendor.companyId !== companyId || vendor.deletedAt !== null) return null;
    return prisma.vendor.update({
      where: { id: vendorId },
      data: {
        ...data,
        ...(data.groupId !== undefined ? { groupId: data.groupId ?? null } : {}),
        ...(data.notes !== undefined ? { notes: data.notes ?? null } : {}),
      },
      include: INCLUDE_GROUP,
    }) as Promise<VendorRow>;
  },

  async softDelete(companyId: string, vendorId: string): Promise<{ deleted: boolean; linkedCount: number }> {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor || vendor.companyId !== companyId || vendor.deletedAt !== null) {
      return { deleted: false, linkedCount: 0 };
    }
    const linkedCount = await prisma.invoice.count({ where: { vendorId, companyId } });
    await prisma.vendor.update({
      where: { id: vendorId },
      data: { deletedAt: new Date() },
    });
    return { deleted: true, linkedCount };
  },

  async linkToInvoice(companyId: string, invoiceId: string, vendorId: string): Promise<boolean> {
    const [invoice, vendor] = await Promise.all([
      prisma.invoice.findUnique({ where: { id: invoiceId } }),
      prisma.vendor.findUnique({ where: { id: vendorId } }),
    ]);
    // IDOR guard (CRITICAL-1) + inactive guard (HIGH-1)
    if (!invoice || invoice.companyId !== companyId) return false;
    if (!vendor || vendor.companyId !== companyId || vendor.deletedAt !== null) return false;
    await prisma.invoice.update({ where: { id: invoiceId }, data: { vendorId } });
    return true;
  },
};
