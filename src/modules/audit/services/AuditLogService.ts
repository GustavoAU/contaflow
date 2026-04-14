// src/modules/audit/services/AuditLogService.ts
// Consulta paginada del AuditLog con filtros — solo OWNER/ADMIN

import prisma from "@/lib/prisma";

export type AuditLogRow = {
  id: string;
  entityId: string;
  entityName: string;
  action: string;
  userId: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: Date;
};

export type AuditLogPage = {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type AuditLogFilters = {
  companyId: string;
  entityName?: string;
  userId?: string;
  dateFrom?: string; // ISO date string YYYY-MM-DD
  dateTo?: string;   // ISO date string YYYY-MM-DD
  page?: number;
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export class AuditLogService {
  static async list(filters: AuditLogFilters): Promise<AuditLogPage> {
    const {
      companyId,
      entityName,
      userId,
      dateFrom,
      dateTo,
      page = 1,
      pageSize = DEFAULT_PAGE_SIZE,
    } = filters;

    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
    const skip = (safePage - 1) * safePageSize;

    const where = {
      companyId,
      ...(entityName ? { entityName } : {}),
      ...(userId ? { userId } : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: new Date(dateFrom + "T00:00:00.000Z") } : {}),
              ...(dateTo ? { lte: new Date(dateTo + "T23:59:59.999Z") } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: safePageSize,
        select: {
          id: true,
          entityId: true,
          entityName: true,
          action: true,
          userId: true,
          oldValue: true,
          newValue: true,
          createdAt: true,
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      rows: rows as AuditLogRow[],
      total,
      page: safePage,
      pageSize: safePageSize,
    };
  }

  static async getDistinctEntityNames(companyId: string): Promise<string[]> {
    const result = await prisma.auditLog.findMany({
      where: { companyId },
      select: { entityName: true },
      distinct: ["entityName"],
      orderBy: { entityName: "asc" },
    });
    return result.map((r) => r.entityName);
  }
}
