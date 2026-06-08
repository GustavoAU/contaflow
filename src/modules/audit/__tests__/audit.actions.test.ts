// src/modules/audit/__tests__/audit.actions.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { checkRateLimit } from "@/lib/ratelimit";
import { AuditLogService } from "../services/AuditLogService";

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findUnique: vi.fn() },
    auditLog: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {}, ocr: {} },
}));

vi.mock("../services/AuditLogService");

const COMPANY_ID = "company-abc";

const emptyPage = { rows: [], total: 0, page: 1, pageSize: 25 };

describe("listAuditLogsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "ADMIN" } as never);
    vi.mocked(AuditLogService.list).mockResolvedValue(emptyPage);
  });

  it("ADMIN recibe página de audit logs", async () => {
    const { listAuditLogsAction } = await import("../actions/audit.actions");
    const result = await listAuditLogsAction({ companyId: COMPANY_ID });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.total).toBe(0);
  });

  it("OWNER recibe datos con total correcto", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "OWNER" } as never);
    vi.mocked(AuditLogService.list).mockResolvedValue({ ...emptyPage, total: 5 });

    const { listAuditLogsAction } = await import("../actions/audit.actions");
    const result = await listAuditLogsAction({ companyId: COMPANY_ID });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.total).toBe(5);
  });

  it("sin userId retorna error no autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const { listAuditLogsAction } = await import("../actions/audit.actions");
    const result = await listAuditLogsAction({ companyId: COMPANY_ID });
    expect(result).toEqual({ success: false, error: "No autorizado" });
  });

  it("sin membresía retorna acceso denegado", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(null);

    const { listAuditLogsAction } = await import("../actions/audit.actions");
    const result = await listAuditLogsAction({ companyId: COMPANY_ID });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("acceso denegado");
  });

  it("ACCOUNTANT es rechazado (requiere ADMIN_ONLY)", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "ACCOUNTANT" } as never);

    const { listAuditLogsAction } = await import("../actions/audit.actions");
    const result = await listAuditLogsAction({ companyId: COMPANY_ID });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("OWNER y ADMIN");
  });

  it("rate limit excedido retorna error", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false } as never);

    const { listAuditLogsAction } = await import("../actions/audit.actions");
    const result = await listAuditLogsAction({ companyId: COMPANY_ID });
    expect(result).toEqual({ success: false, error: "Demasiadas solicitudes. Intente más tarde." });
  });

  it("propaga errores del servicio", async () => {
    vi.mocked(AuditLogService.list).mockRejectedValueOnce(new Error("DB failure"));

    const { listAuditLogsAction } = await import("../actions/audit.actions");
    const result = await listAuditLogsAction({ companyId: COMPANY_ID });
    expect(result).toEqual({ success: false, error: "DB failure" });
  });
});

describe("getAuditEntityNamesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "ADMIN" } as never);
    vi.mocked(AuditLogService.getDistinctEntityNames).mockResolvedValue(["Invoice", "Transaction"]);
  });

  it("ADMIN recibe lista de entidades distintas", async () => {
    const { getAuditEntityNamesAction } = await import("../actions/audit.actions");
    const result = await getAuditEntityNamesAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(["Invoice", "Transaction"]);
  });

  it("sin membresía retorna error", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(null);

    const { getAuditEntityNamesAction } = await import("../actions/audit.actions");
    const result = await getAuditEntityNamesAction(COMPANY_ID);
    expect(result.success).toBe(false);
  });
});
