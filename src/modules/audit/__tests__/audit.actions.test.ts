// src/modules/audit/__tests__/audit.actions.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { AuditLogService } from "../services/AuditLogService";

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: {
      findUnique: vi.fn(),
    },
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("../services/AuditLogService");

const COMPANY_ID = "company-abc";

describe("listAuditLogsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna error si el usuario no es miembro", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(null as never);

    const { listAuditLogsAction } = await import("../actions/audit.actions");
    const result = await listAuditLogsAction({ companyId: COMPANY_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("acceso denegado");
    }
  });

  it("retorna error si el rol no es ADMIN_ONLY (ACCOUNTANT)", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({
      role: "ACCOUNTANT",
    } as never);

    const { listAuditLogsAction } = await import("../actions/audit.actions");
    const result = await listAuditLogsAction({ companyId: COMPANY_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("OWNER y ADMIN");
    }
  });

  it("retorna datos si el rol es ADMIN", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({
      role: "ADMIN",
    } as never);
    vi.mocked(AuditLogService.list).mockResolvedValue({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });

    const { listAuditLogsAction } = await import("../actions/audit.actions");
    const result = await listAuditLogsAction({ companyId: COMPANY_ID });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.total).toBe(0);
    }
  });

  it("retorna datos si el rol es OWNER", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({
      role: "OWNER",
    } as never);
    vi.mocked(AuditLogService.list).mockResolvedValue({
      rows: [],
      total: 5,
      page: 1,
      pageSize: 25,
    });

    const { listAuditLogsAction } = await import("../actions/audit.actions");
    const result = await listAuditLogsAction({ companyId: COMPANY_ID });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.total).toBe(5);
    }
  });
});
