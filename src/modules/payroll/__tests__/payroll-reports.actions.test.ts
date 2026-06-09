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
    employee: {
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
    },
    company: { findUniqueOrThrow: vi.fn() },
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
    generateConstanciaPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
  },
}));
vi.mock("../services/PayrollBankTxtService", () => ({
  PayrollBankTxtService: {
    generateBanavihTxt: vi.fn().mockResolvedValue("TXT_CONTENT"),
  },
}));
vi.mock("../services/MintraReportService", () => ({
  MintraReportService: {
    generateCsv: vi.fn().mockResolvedValue({ csv: "CSV_CONTENT" }),
  },
}));
vi.mock("exceljs", () => {
  const ws = { columns: [], addRow: vi.fn() };
  const wb = {
    addWorksheet: vi.fn().mockReturnValue(ws),
    xlsx: { writeBuffer: vi.fn().mockResolvedValue(Buffer.from("xlsx")) },
  };
  return { default: { Workbook: vi.fn().mockImplementation(() => wb) } };
});

import prisma from "@/lib/prisma";
import { PayrollReportService } from "../services/PayrollReportService";
import { PayrollBankTxtService } from "../services/PayrollBankTxtService";
import { MintraReportService } from "../services/MintraReportService";
import {
  getIvssReportAction,
  exportIvssPdfAction,
  getBanavihReportAction,
  exportBanavihPdfAction,
  getIncesReportAction,
  exportIncesPdfAction,
  getArcReportAction,
  exportArcPdfAction,
  exportIvssExcelAction,
  exportBanavihExcelAction,
  exportIncesExcelAction,
  exportConstanciaTrabajoAction,
  exportBanavihTxtAction,
  exportMintraCsvAction,
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

// ─── Excel IVSS / FAOV / INCES ────────────────────────────────────────────────

describe("exportIvssExcelAction", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTING_MEMBER as never);
  });

  it("sin sesión → error", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await exportIvssExcelAction(COMPANY_ID, 2026, 4);
    expect(res.success).toBe(false);
  });

  it("VIEWER → error", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(VIEWER_MEMBER as never);
    const res = await exportIvssExcelAction(COMPANY_ID, 2026, 4);
    expect(res.success).toBe(false);
  });

  it("service falla → error con mapPrismaError", async () => {
    vi.mocked(PayrollReportService.getIvssReport).mockRejectedValue(new Error("ivss failed") as never);
    const res = await exportIvssExcelAction(COMPANY_ID, 2026, 4);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("ivss failed");
  });
});

describe("exportBanavihExcelAction", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTING_MEMBER as never);
  });

  it("sin sesión → error", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await exportBanavihExcelAction(COMPANY_ID, 2026, 4);
    expect(res.success).toBe(false);
  });

  it("service falla → error con mapPrismaError", async () => {
    vi.mocked(PayrollReportService.getBanavihReport).mockRejectedValue(new Error("banavih failed") as never);
    const res = await exportBanavihExcelAction(COMPANY_ID, 2026, 4);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("banavih failed");
  });
});

describe("exportIncesExcelAction", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTING_MEMBER as never);
  });

  it("sin sesión → error", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await exportIncesExcelAction(COMPANY_ID, 2026, 1);
    expect(res.success).toBe(false);
  });

  it("service falla → error con mapPrismaError", async () => {
    vi.mocked(PayrollReportService.getIncesReport).mockRejectedValue(new Error("inces failed") as never);
    const res = await exportIncesExcelAction(COMPANY_ID, 2026, 1);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("inces failed");
  });
});

// ─── Constancia de Trabajo ─────────────────────────────────────────────────────

describe("exportConstanciaTrabajoAction", () => {
  const MOCK_EMP = {
    firstName: "Juan", lastName: "Pérez", cedulaType: "V", cedulaNumber: "12345678",
    ivssNumber: "IV-001", position: "Analista", payrollWorkerType: "PERMANENT",
    contractType: "INDEFINITE", hireDate: new Date("2020-01-01"), terminationDate: null,
    salaryHistory: [{ amount: new Decimal("500.00") }],
  };

  beforeEach(() => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTING_MEMBER as never);
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValue({ name: "Mi Empresa", rif: "J-12345678-9" } as never);
    vi.mocked(prisma.employee.findFirstOrThrow).mockResolvedValue(MOCK_EMP as never);
  });

  it("sin sesión → error", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await exportConstanciaTrabajoAction(COMPANY_ID, EMP_ID);
    expect(res.success).toBe(false);
  });

  it("ACCOUNTANT + empleado válido → success, retorna base64", async () => {
    const res = await exportConstanciaTrabajoAction(COMPANY_ID, EMP_ID);
    expect(res.success).toBe(true);
    if (res.success) expect(typeof res.buffer).toBe("string");
  });

  it("empleado no encontrado (findFirstOrThrow lanza) → error", async () => {
    vi.mocked(prisma.employee.findFirstOrThrow).mockRejectedValue(new Error("Not found") as never);
    const res = await exportConstanciaTrabajoAction(COMPANY_ID, "emp-otro");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Not found");
  });
});

// ─── TXT BANAVIH / CSV MINTRA ─────────────────────────────────────────────────

describe("exportBanavihTxtAction", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTING_MEMBER as never);
  });

  it("sin sesión → error", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await exportBanavihTxtAction(COMPANY_ID, 2026, 4);
    expect(res.success).toBe(false);
  });

  it("ACCOUNTANT → success, retorna txt y filename", async () => {
    const res = await exportBanavihTxtAction(COMPANY_ID, 2026, 4);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.txt).toBe("TXT_CONTENT");
      expect(res.filename).toContain("BANAVIH");
    }
  });

  it("service falla → error con mapPrismaError", async () => {
    vi.mocked(PayrollBankTxtService.generateBanavihTxt).mockRejectedValue(new Error("gen failed") as never);
    const res = await exportBanavihTxtAction(COMPANY_ID, 2026, 4);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("gen failed");
  });
});

describe("exportMintraCsvAction", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTING_MEMBER as never);
  });

  it("sin sesión → error", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await exportMintraCsvAction(COMPANY_ID, 2026, 1);
    expect(res.success).toBe(false);
  });

  it("ACCOUNTANT → success, retorna csv y filename", async () => {
    const res = await exportMintraCsvAction(COMPANY_ID, 2026, 1);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.txt).toBe("CSV_CONTENT");
      expect(res.filename).toContain("MINTRA");
    }
  });

  it("service falla → error con mapPrismaError", async () => {
    vi.mocked(MintraReportService.generateCsv).mockRejectedValue(new Error("csv failed") as never);
    const res = await exportMintraCsvAction(COMPANY_ID, 2026, 1);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("csv failed");
  });
});
