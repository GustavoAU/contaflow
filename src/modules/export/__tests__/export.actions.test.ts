// src/modules/export/__tests__/export.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockGenerateExportZip = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { fiscal: {}, ocr: {}, export: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    exportJob: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));
vi.mock("../services/ExportService", () => ({
  generateExportZip: mockGenerateExportZip,
}));

import prisma from "@/lib/prisma";
import { createExportJobAction, listExportJobsAction } from "../actions/export.actions";

const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const JOB_ID = "job-1";

const VALID_INPUT = {
  companyId: COMPANY_ID,
  dateFrom: "2026-01-01",
  dateTo: "2026-01-31",
};

const MEMBER_ACCOUNTANT = { role: "ACCOUNTANT" };
const MEMBER_VIEWER = { role: "VIEWER" };

const MOCK_ZIP = { data: Buffer.from("fake-zip"), sizeBytes: 8 };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: USER_ID });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTANT as never);
  vi.mocked(prisma.exportJob.findFirst).mockResolvedValue(null); // no in-progress jobs
  vi.mocked(prisma.exportJob.create).mockResolvedValue({ id: JOB_ID } as never);
  vi.mocked(prisma.exportJob.update).mockResolvedValue({} as never);
  mockGenerateExportZip.mockResolvedValue(MOCK_ZIP);
});

describe("createExportJobAction", () => {
  it("retorna error si no está autenticado", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await createExportJobAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe("No autorizado");
  });

  it("retorna error si rate limit excedido", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, error: "Demasiadas solicitudes." });
    const result = await createExportJobAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("Demasiadas solicitudes");
  });

  it("retorna error si empresa no encontrada o sin acceso", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await createExportJobAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("Empresa no encontrada");
  });

  it("retorna error si el rol es VIEWER", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_VIEWER as never);
    const result = await createExportJobAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("Sin permisos");
  });

  it("retorna error si ya hay un export en proceso [MEDIUM-1]", async () => {
    vi.mocked(prisma.exportJob.findFirst).mockResolvedValue({ id: "existing-job" } as never);
    const result = await createExportJobAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("Ya existe una exportación");
  });

  it("retorna error de schema si dateFrom > dateTo", async () => {
    const result = await createExportJobAction({
      companyId: COMPANY_ID,
      dateFrom: "2026-12-31",
      dateTo: "2026-01-01",
    });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("posterior");
  });

  it("retorna error de schema si rango supera 366 días", async () => {
    const result = await createExportJobAction({
      companyId: COMPANY_ID,
      dateFrom: "2024-01-01",
      dateTo: "2026-01-01",
    });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("366");
  });

  it("crea el job y llama generateExportZip con companyId correcto [CRITICAL-2]", async () => {
    const result = await createExportJobAction(VALID_INPUT);
    expect(result.success).toBe(true);
    expect(mockGenerateExportZip).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY_ID })
    );
  });

  it("actualiza el job a DONE con fileData y expiresAt", async () => {
    await createExportJobAction(VALID_INPUT);
    expect(vi.mocked(prisma.exportJob.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DONE",
          fileData: MOCK_ZIP.data,
          fileSize: MOCK_ZIP.sizeBytes,
        }),
      })
    );
  });

  it("actualiza el job a ERROR si generateExportZip lanza", async () => {
    mockGenerateExportZip.mockRejectedValue(new Error("ZIP failed"));
    const result = await createExportJobAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(vi.mocked(prisma.exportJob.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ERROR" }),
      })
    );
  });
});

describe("listExportJobsAction", () => {
  it("retorna error si no está autenticado", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await listExportJobsAction(COMPANY_ID);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe("No autorizado");
  });

  it("retorna error si no es miembro de la empresa [CRITICAL-1]", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await listExportJobsAction(COMPANY_ID);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("Acceso denegado");
  });

  it("devuelve lista de jobs del usuario", async () => {
    const fakeJobs = [{ id: "j1", status: "DONE", dateFrom: new Date(), dateTo: new Date(), fileSize: 100, expiresAt: null, createdAt: new Date() }];
    vi.mocked(prisma.exportJob.findMany).mockResolvedValue(fakeJobs as never);
    const result = await listExportJobsAction(COMPANY_ID);
    expect(result.success).toBe(true);
    expect((result as { success: true; data: unknown[] }).data).toHaveLength(1);
  });
});
