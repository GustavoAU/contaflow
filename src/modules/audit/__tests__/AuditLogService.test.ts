// src/modules/audit/__tests__/AuditLogService.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { AuditLogService } from "../services/AuditLogService";

vi.mock("@/lib/prisma", () => ({
  default: {
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

const COMPANY_ID = "company-abc";

const makeRow = (overrides = {}) => ({
  id: "log-1",
  entityId: "entity-1",
  entityName: "Transaction",
  action: "CREATE",
  userId: "user-1",
  oldValue: null,
  newValue: { amount: "100.00" },
  createdAt: new Date("2026-01-15T10:00:00Z"),
  ...overrides,
});

describe("AuditLogService.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna primera página con companyId filter", async () => {
    const rows = [makeRow()];
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue(rows as never);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(1 as never);

    const result = await AuditLogService.list({ companyId: COMPANY_ID });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: COMPANY_ID },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 25,
      })
    );
    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
  });

  it("aplica filtro entityName", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0 as never);

    await AuditLogService.list({ companyId: COMPANY_ID, entityName: "Invoice" });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: COMPANY_ID, entityName: "Invoice" },
      })
    );
  });

  it("aplica filtro userId", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0 as never);

    await AuditLogService.list({ companyId: COMPANY_ID, userId: "user-x" });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: COMPANY_ID, userId: "user-x" },
      })
    );
  });

  it("aplica filtro dateFrom y dateTo", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0 as never);

    await AuditLogService.list({
      companyId: COMPANY_ID,
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });

    const call = vi.mocked(prisma.auditLog.findMany).mock.calls[0][0] as { where: { createdAt: { gte: Date; lte: Date } } };
    expect(call.where.createdAt).toBeDefined();
    expect(call.where.createdAt.gte).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(call.where.createdAt.lte).toEqual(new Date("2026-01-31T23:59:59.999Z"));
  });

  it("calcula skip correcto para página 2", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(50 as never);

    const result = await AuditLogService.list({ companyId: COMPANY_ID, page: 2, pageSize: 25 });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 25, take: 25 })
    );
    expect(result.page).toBe(2);
  });

  it("limita pageSize al máximo de 100", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0 as never);

    await AuditLogService.list({ companyId: COMPANY_ID, pageSize: 500 });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 })
    );
  });
});

describe("AuditLogService.list — F-09 entityNames (módulo filter)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aplica filtro entityNames como IN cuando se provee el array", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0 as never);

    await AuditLogService.list({
      companyId: COMPANY_ID,
      entityNames: ["Employee", "PayrollRun", "BenefitAdvance"],
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: COMPANY_ID,
          entityName: { in: ["Employee", "PayrollRun", "BenefitAdvance"] },
        },
      })
    );
  });

  it("entityNames vacío no filtra por entidad", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0 as never);

    await AuditLogService.list({ companyId: COMPANY_ID, entityNames: [] });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: COMPANY_ID } })
    );
  });

  it("entityNames tiene precedencia sobre entityName cuando ambos se proveen", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0 as never);

    await AuditLogService.list({
      companyId: COMPANY_ID,
      entityName: "Invoice",
      entityNames: ["Employee", "PayrollRun"],
    });

    const call = vi.mocked(prisma.auditLog.findMany).mock.calls[0][0] as {
      where: { entityName: { in: string[] } };
    };
    expect(call.where.entityName).toEqual({ in: ["Employee", "PayrollRun"] });
  });
});

describe("AuditLogService.getDistinctEntityNames", () => {
  it("retorna nombres de entidades distintas", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      { entityName: "Account" },
      { entityName: "Invoice" },
    ] as never);

    const names = await AuditLogService.getDistinctEntityNames(COMPANY_ID);

    expect(names).toEqual(["Account", "Invoice"]);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: COMPANY_ID },
        distinct: ["entityName"],
      })
    );
  });
});
