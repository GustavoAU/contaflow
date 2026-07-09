// src/modules/accounting/__tests__/exportFinancialStatementPDF.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockGetBalanceSheetAction = vi.hoisted(() => vi.fn());
const mockGetIncomeStatementAction = vi.hoisted(() => vi.fn());
const mockGenerateBalanceSheetPDF = vi.hoisted(() => vi.fn());
const mockGenerateIncomeStatementPDF = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  fiscalKey: (c: string, u: string) => `${c}:${u}`,
  limiters: { fiscal: {}, ocr: {}, read: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
    companySettings: { findUnique: vi.fn() },
  },
}));
vi.mock("../actions/report.actions", () => ({
  getBalanceSheetAction: mockGetBalanceSheetAction,
  getIncomeStatementAction: mockGetIncomeStatementAction,
}));
vi.mock("../services/FinancialStatementsPDFService", () => ({
  generateBalanceSheetPDF: mockGenerateBalanceSheetPDF,
  generateIncomeStatementPDF: mockGenerateIncomeStatementPDF,
}));

import prisma from "@/lib/prisma";
import {
  exportBalanceSheetPDFAction,
  exportIncomeStatementPDFAction,
} from "../actions/exportFinancialStatementPDF.actions";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const COMPANY_ID = "company-1";
const USER_ID = "user-1";

const BALANCED_SHEET = {
  assets: [],
  liabilities: [],
  equity: [],
  totalAssets: "1000.00",
  totalLiabilities: "400.00",
  totalEquity: "600.00",
  totalLiabilitiesAndEquity: "1000.00",
  isBalanced: true,
};

const UNBALANCED_SHEET = { ...BALANCED_SHEET, isBalanced: false };

const INCOME_STMT = {
  revenues: [],
  expenses: [],
  totalRevenues: "500.00",
  totalExpenses: "300.00",
  netIncome: "200.00",
};

function setupHappyPath() {
  mockAuth.mockResolvedValue({ userId: USER_ID });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
  vi.mocked(prisma.company.findFirst).mockResolvedValue({ name: "Empresa Test C.A.", rif: "J-12345678-9" } as never);
  vi.mocked(prisma.companySettings.findUnique).mockResolvedValue(null as never);
  mockGetBalanceSheetAction.mockResolvedValue({ success: true, data: BALANCED_SHEET });
  mockGetIncomeStatementAction.mockResolvedValue({ success: true, data: { current: INCOME_STMT } });
  mockGenerateBalanceSheetPDF.mockResolvedValue(Buffer.from("pdf-content"));
  mockGenerateIncomeStatementPDF.mockResolvedValue(Buffer.from("pdf-content"));
}

// ─── exportBalanceSheetPDFAction ──────────────────────────────────────────────

describe("exportBalanceSheetPDFAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("retorna base64 del PDF cuando el balance está cuadrado", async () => {
    const result = await exportBalanceSheetPDFAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pdf).toBeTruthy();
      expect(result.data.filename).toMatch(/^Balance-General-\d{4}-\d{2}-\d{2}\.pdf$/);
    }
  });

  it("bloquea la exportación cuando el balance NO está cuadrado", async () => {
    mockGetBalanceSheetAction.mockResolvedValue({ success: true, data: UNBALANCED_SHEET });
    const result = await exportBalanceSheetPDFAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("no está cuadrado");
      expect(result.error).toContain("Activos ≠ Pasivos + Patrimonio");
    }
    expect(mockGenerateBalanceSheetPDF).not.toHaveBeenCalled();
  });

  it("propaga error si getBalanceSheetAction falla", async () => {
    mockGetBalanceSheetAction.mockResolvedValue({ success: false, error: "Error DB" });
    const result = await exportBalanceSheetPDFAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Error DB");
  });

  it("retorna error si no hay sesión", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await exportBalanceSheetPDFAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna error si rate limit excedido", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, error: "Demasiadas solicitudes. Intente más tarde." });
    const result = await exportBalanceSheetPDFAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas");
  });

  it("retorna error si no es miembro de la empresa", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await exportBalanceSheetPDFAction(COMPANY_ID);
    expect(result.success).toBe(false);
  });
});

// ─── exportIncomeStatementPDFAction ──────────────────────────────────────────

describe("exportIncomeStatementPDFAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("retorna base64 del PDF con datos válidos", async () => {
    const result = await exportIncomeStatementPDFAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pdf).toBeTruthy();
      expect(result.data.filename).toMatch(/^Estado-Resultados-\d{4}-\d{2}-\d{2}\.pdf$/);
    }
  });

  it("propaga error si getIncomeStatementAction falla", async () => {
    mockGetIncomeStatementAction.mockResolvedValue({ success: false, error: "Sin datos" });
    const result = await exportIncomeStatementPDFAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Sin datos");
  });
});
