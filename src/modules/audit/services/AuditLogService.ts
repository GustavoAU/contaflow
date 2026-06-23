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
  // Rec #4 (PA-121/COSO): trazabilidad de red. Se graban siempre; ahora también se exponen.
  ipAddress: string | null;
  userAgent: string | null;
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
  entityNames?: string[]; // F-09: filtro por módulo (múltiples entidades)
  userId?: string;
  dateFrom?: string; // ISO date string YYYY-MM-DD
  dateTo?: string;   // ISO date string YYYY-MM-DD
  page?: number;
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

// ─── Helpers ──────────────────────────────────────────────────────────────────

type WhereFilters = Pick<AuditLogFilters, "companyId" | "entityName" | "entityNames" | "userId" | "dateFrom" | "dateTo">;

function buildAuditWhere(filters: WhereFilters) {
  const { companyId, entityName, entityNames, userId, dateFrom, dateTo } = filters;

  const entityFilter =
    entityNames && entityNames.length > 0
      ? { entityName: { in: entityNames } }
      : entityName
      ? { entityName }
      : {};

  return {
    companyId,
    ...entityFilter,
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
}

const AUDIT_LOG_SELECT = {
  id: true,
  entityId: true,
  entityName: true,
  action: true,
  userId: true,
  oldValue: true,
  newValue: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
} as const;

// ─── Service ──────────────────────────────────────────────────────────────────

export class AuditLogService {
  static async list(filters: AuditLogFilters): Promise<AuditLogPage> {
    const { page = 1, pageSize = DEFAULT_PAGE_SIZE } = filters;

    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
    const skip = (safePage - 1) * safePageSize;

    const where = buildAuditWhere(filters);

    // ADR-004-EXCEPTION: companyId incluido en buildAuditWhere(filters) — siempre presente como campo requerido
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: safePageSize,
        select: AUDIT_LOG_SELECT,
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

  // OM-04: listAll para export PDF/CSV — hasta 1000 registros, sin paginación
  static async listAll(filters: Omit<AuditLogFilters, "page" | "pageSize">): Promise<AuditLogRow[]> {
    const where = buildAuditWhere(filters);

    // ADR-004-EXCEPTION: companyId incluido en buildAuditWhere(filters) — siempre presente como campo requerido
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 1000,  // límite de seguridad — no exportar volúmenes ilimitados
      select: AUDIT_LOG_SELECT,
    });

    return rows as AuditLogRow[];
  }
}
