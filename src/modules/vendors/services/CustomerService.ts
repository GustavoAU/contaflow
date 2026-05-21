// src/modules/vendors/services/CustomerService.ts
import prisma from "@/lib/prisma";
import type { CreateCustomerInput, UpdateCustomerInput } from "../schemas/vendor.schemas";

export type CustomerRow = {
  id: string;
  companyId: string;
  name: string;
  rif: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  code: string | null;
  groupId: string | null;
  group: { id: string; name: string } | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const INCLUDE_GROUP = { group: { select: { id: true, name: true } } } as const;

export const CustomerService = {
  async list(companyId: string): Promise<CustomerRow[]> {
    return prisma.customer.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { name: "asc" },
      include: INCLUDE_GROUP,
    });
  },

  async get(companyId: string, customerId: string): Promise<CustomerRow | null> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: INCLUDE_GROUP,
    });
    // Post-fetch ownership check (ADR-004)
    if (!customer || customer.companyId !== companyId) return null;
    return customer;
  },

  async create(companyId: string, data: CreateCustomerInput): Promise<CustomerRow> {
    return prisma.customer.create({
      data: { companyId, ...data, groupId: data.groupId ?? null },
      include: INCLUDE_GROUP,
    });
  },

  async update(companyId: string, customerId: string, data: UpdateCustomerInput): Promise<CustomerRow | null> {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.companyId !== companyId || customer.deletedAt !== null) return null;
    return prisma.customer.update({
      where: { id: customerId },
      data: { ...data, ...(data.groupId !== undefined ? { groupId: data.groupId ?? null } : {}) },
      include: INCLUDE_GROUP,
    });
  },

  async softDelete(companyId: string, customerId: string): Promise<{ deleted: boolean; linkedCount: number }> {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.companyId !== companyId || customer.deletedAt !== null) {
      return { deleted: false, linkedCount: 0 };
    }
    const linkedCount = await prisma.invoice.count({ where: { customerId, companyId } });
    await prisma.customer.update({
      where: { id: customerId },
      data: { deletedAt: new Date() },
    });
    return { deleted: true, linkedCount };
  },

  async linkToInvoice(companyId: string, invoiceId: string, customerId: string): Promise<boolean> {
    const [invoice, customer] = await Promise.all([
      prisma.invoice.findUnique({ where: { id: invoiceId } }),
      prisma.customer.findUnique({ where: { id: customerId } }),
    ]);
    // IDOR guard (CRITICAL-1) + inactive guard (HIGH-1)
    if (!invoice || invoice.companyId !== companyId) return false;
    if (!customer || customer.companyId !== companyId || customer.deletedAt !== null) return false;
    await prisma.invoice.update({ where: { id: invoiceId }, data: { customerId } });
    return true;
  },
};
