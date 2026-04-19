// src/modules/payroll/__tests__/payroll-reports.actions.test.ts
// Fase NOM-E: Tests de server actions de reportes legales (auth, role, IDOR guards)

import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockAuth = vi.hoisted(() => vi.fn().mockResolvedValue({ userId: "user-1" }));

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    employee: { findFirst: vi.fn() },
  },
}));
vi.mock("../services/PayrollReportService", () => ({
  PayrollReportService: {
    getIvssReport: vi.fn(),
    getBanavihReport: vi.fn(),
    getIncesReport: vi.fn(),
    getArcReport: vi.fn(),
  },
}));
vi.mock("../services/PayrollPdfReportService", () => ({
  PayrollPdfReportService: {
    generateIvssPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
    generateBanavihPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
    generateIncesPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
    generateArcPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
  },
}));

import prisma from "@/lib/prisma";
import { PayrollReportService } from "../services/PayrollReportService";
import {
  getIvssReportAction,
  exportIvssPdfAction,
  getBanavihReportAction,
  exportBanavihPdfAction,
  getIncesReportAction,
  exportIncesPdfAction,
  getArcReportAction,
  exportArcPdfAction,
} from "../actions/payroll-reports.actions";

const COMPANY_ID = "co-1";
const EMP_ID = "emp-1";

const ACCOUNTING_MEMBER = { role: "ACCOUNTANT" };
const VIEWER_MEMBER = { role: "VIEWER" };
const ADMIN_MEMBER = { role: "OWNER" };

const MOCK_IVSS_DATA = { companyId: COMPANY_ID, rows: [], totalAmount: new Decimal(0) };
const MOCK_BANAVIH_DATA = { companyId: COMPANY_ID, rows: [], totalAmount: new Decimal(0) };
const MOCK_INCES_DATA = { companyId: COMPANY_ID, rows: [], totalAmount: new Decimal(0) };
const MOCK_ARC_DATA = { companyId: COMPANY_ID };

// ─── Auth guard (sin sesión) ──────────────────────────────────────────────────

describe("auth guard — sin sesión", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ userId: null });
  });

  it("getIvssReportAction → error", async () => {
    const res = await getIvssReportAction(COMPANY_ID, 2026, 4);
    expect(res.success).toBe(false);
  });

  it("getBanavihReportAction → error", async () => {
    const res = await getBanavihReportAction(COMPANY_ID, 2026, 4);
    expect(res.success).toBe(false);
  });

  it("getIncesReportAction → error", async () => {
    const res = await getIncesReportAction(COMPANY_ID, 2026, 1);
    expect(res.success).toBe(false);
  });

  it("getArcReportAction → error", async () => {
    const res = await getArcReportAction(COMPANY_ID, EMP_ID, 2026);
    expect(res.success).toBe(false);
  });
});

// ─── CompanyId guard (no member) ─────────────────────────────────────────────

describe("companyId guard — no member", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);
  });

  it("getIvssReportAction de otra empresa → error", async () => {
    const res = await getIvssReportAction("other-company", 2026, 4);
    expect(res.success).toBe(false);
  });

  it("getArcReportAction de otra empresa → error", async () => {
    const res = await getArcReportAction("other-company", EMP_ID, 2026);
    expect(res.success).toBe(false);
  });
});

// ─── Role guard — VIEWER no puede acceder ────────────────────────────────────

describe("role guard — VIEWER sin acceso ACCOUNTING", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(VIEWER_MEMBER as never);
  });

  it("getIvssReportAction como VIEWER → error", async () => {
    const res = await getIvssReportAction(COMPANY_ID, 2026, 4);
    expect(res.success).toBe(false);
  });

  it("exportIvssPdfAction como VIEWER → error", async () => {
    const res = await exportIvssPdfAction(COMPANY_ID, 2026, 4);
    expect(res.success).toBe(false);
  });
});

// ─── Acceso exitoso como ACCOUNTANT ──────────────────────────────────────────

describe("acceso exitoso — ACCOUNTANT", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTING_MEMBER as never);
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: EMP_ID } as never);
    vi.mocked(PayrollReportService.getIvssReport).mockResolvedValue(MOCK_IVSS_DATA as never);
    vi.mocked(PayrollReportService.getBanavihReport).mockResolvedValue(MOCK_BANAVIH_DATA as never);
    vi.mocked(PayrollReportService.getIncesReport).mockResolvedValue(MOCK_INCES_DATA as never);
    vi.mocked(PayrollReportService.getArcReport).mockResolvedValue(MOCK_ARC_DATA as never);
  });

  it("getIvssReportAction → success con datos", async () => {
    const res = await getIvssReportAction(COMPANY_ID, 2026, 4);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data).toBeDefined();
  });

  it("getBanavihReportAction → success", async () => {
    const res = await getBanavihReportAction(COMPANY_ID, 2026, 4);
    expect(res.success).toBe(true);
  });

  it("getIncesReportAction → success", async () => {
    const res = await getIncesReportAction(COMPANY_ID, 2026, 1);
    expect(res.success).toBe(true);
  });

  it("getArcReportAction → success (empleado pertenece a la empresa)", async () => {
    const res = await getArcReportAction(COMPANY_ID, EMP_ID, 2026);
    expect(res.success).toBe(true);
  });

  it("exportIvssPdfAction → success, retorna base64 válido", async () => {
    const res = await exportIvssPdfAction(COMPANY_ID, 2026, 4);
    expect(res.success).toBe(true);
    if (res.success) {
      const buf = Buffer.from(res.buffer, "base64");
      expect(buf.length).toBeGreaterThan(0);
    }
  });

  it("exportBanavihPdfAction → success, retorna base64", async () => {
    const res = await exportBanavihPdfAction(COMPANY_ID, 2026, 4);
    expect(res.success).toBe(true);
  });

  it("exportIncesPdfAction → success, retorna base64", async () => {
    const res = await exportIncesPdfAction(COMPANY_ID, 2026, 1);
    expect(res.success).toBe(true);
  });

  it("exportArcPdfAction → success (con IDOR guard)", async () => {
    const res = await exportArcPdfAction(COMPANY_ID, EMP_ID, 2026);
    expect(res.success).toBe(true);
  });
});

// ─── IDOR guard en actions ARC ────────────────────────────────────────────────

describe("IDOR guard — ARC con empleado de otro tenant", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTING_MEMBER as never);
    // Empleado no encontrado en esta empresa → IDOR
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(null as never);
  });

  it("getArcReportAction con employeeId de otra empresa → error", async () => {
    const res = await getArcReportAction(COMPANY_ID, "emp-otro-tenant", 2026);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("no encontrado");
  });

  it("exportArcPdfAction con employeeId de otra empresa → error", async () => {
    const res = await exportArcPdfAction(COMPANY_ID, "emp-otro-tenant", 2026);
    expect(res.success).toBe(false);
  });
});

// ─── OWNER también puede acceder ─────────────────────────────────────────────

describe("acceso exitoso — OWNER", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: EMP_ID } as never);
    vi.mocked(PayrollReportService.getIvssReport).mockResolvedValue(MOCK_IVSS_DATA as never);
    vi.mocked(PayrollReportService.getArcReport).mockResolvedValue(MOCK_ARC_DATA as never);
  });

  it("getIvssReportAction como OWNER → success", async () => {
    const res = await getIvssReportAction(COMPANY_ID, 2026, 4);
    expect(res.success).toBe(true);
  });
});
