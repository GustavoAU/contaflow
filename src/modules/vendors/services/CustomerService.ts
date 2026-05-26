// src/modules/vendors/services/CustomerService.ts
import prisma from "@/lib/prisma";
import type { CreateCustomerInput, UpdateCustomerInput, ContactCategory } from "../schemas/vendor.schemas";

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
  notes: string | null;
  category: ContactCategory;
  lastInvoiceDate?: Date | null; // computed, opcional (solo en list())
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const INCLUDE_GROUP = { group: { select: { id: true, name: true } } } as const;

const INACTIVE_DAYS = 90; // días sin factura para considerar cliente inactivo

export const CustomerService = {
  async list(companyId: string): Promise<CustomerRow[]> {
    const customers = await prisma.customer.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { name: "asc" },
      include: INCLUDE_GROUP,
    });

    // Obtener la fecha de última factura por cliente en una sola query
    const customerIds = customers.map((c) => c.id);
    if (customerIds.length === 0) return customers as CustomerRow[];

    // Para cada cliente, obtener la factura más reciente
    const latestInvoices = await prisma.invoice.groupBy({
      by: ["customerId"],
      where: { customerId: { in: customerIds }, companyId, deletedAt: null },
      _max: { date: true },
    });
    const lastInvoiceMap = new Map(
      latestInvoices.map((r) => [r.customerId, r._max.date]),
    );

    return customers.map((c) => ({
      ...c,
      lastInvoiceDate: lastInvoiceMap.get(c.id) ?? null,
    })) as CustomerRow[];
  },

  async get(companyId: string, customerId: string): Promise<CustomerRow | null> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: INCLUDE_GROUP,
    });
    // Post-fetch ownership check (ADR-004)
    if (!customer || customer.companyId !== companyId) return null;
    return customer as CustomerRow;
  },

  /**
   * Cuenta clientes activos sin factura en los últimos INACTIVE_DAYS días.
   * Usado por PendingTasksService para la alerta CLIENTES_INACTIVOS.
   */
  async countInactive(companyId: string): Promise<number> {
    const cutoff = new Date(Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000);
    // Clientes activos con al menos 1 factura histórica pero ninguna reciente
    const activeCustomerIds = await prisma.customer.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true },
    });
    const ids = activeCustomerIds.map((c) => c.id);
    if (ids.length === 0) return 0;

    // Clientes que SÍ tienen factura reciente
    const recentlyActive = await prisma.invoice.findMany({
      where: {
        companyId,
        customerId: { in: ids },
        date: { gte: cutoff },
        deletedAt: null,
      },
      select: { customerId: true },
      distinct: ["customerId"],
    });
    const recentIds = new Set(recentlyActive.map((i) => i.customerId));

    // Clientes con al menos 1 factura histórica (no son leads sin actividad)
    const withHistory = await prisma.invoice.findMany({
      where: {
        companyId,
        customerId: { in: ids },
        deletedAt: null,
      },
      select: { customerId: true },
      distinct: ["customerId"],
    });
    const withHistoryIds = new Set(withHistory.map((i) => i.customerId));

    // Inactivos = tienen historial pero no reciente
    return [...withHistoryIds].filter((id) => !recentIds.has(id)).length;
  },

  async create(companyId: string, data: CreateCustomerInput): Promise<CustomerRow> {
    return prisma.customer.create({
      data: {
        companyId,
        ...data,
        groupId: data.groupId ?? null,
        category: data.category ?? "REGULAR",
        notes: data.notes ?? null,
      },
      include: INCLUDE_GROUP,
    }) as Promise<CustomerRow>;
  },

  async update(companyId: string, customerId: string, data: UpdateCustomerInput): Promise<CustomerRow | null> {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.companyId !== companyId || customer.deletedAt !== null) return null;
    return prisma.customer.update({
      where: { id: customerId },
      data: {
        ...data,
        ...(data.groupId !== undefined ? { groupId: data.groupId ?? null } : {}),
        ...(data.notes !== undefined ? { notes: data.notes ?? null } : {}),
      },
      include: INCLUDE_GROUP,
    }) as Promise<CustomerRow>;
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
