// src/modules/bank-reconciliation/actions/__tests__/auto-reconciliation.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAuth, mockRevalidatePath, mockPrisma, mockGemini, mockAutoService, mockCheckRateLimit } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockPrisma: {
    companyMember: { findUnique: vi.fn() },
    bankTransaction: { findMany: vi.fn() },
  },
  mockGemini: { extractFromPdf: vi.fn() },
  mockAutoService: {
    run: vi.fn(),
    periodHasTransactions: vi.fn(),
  },
  mockCheckRateLimit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { ocr: {}, fiscal: {} },
}));
vi.mock("../../services/GeminiBankStatementService", () => ({
  GeminiBankStatementService: mockGemini,
}));
vi.mock("../../services/AutoReconciliationService", () => ({
  AutoReconciliationService: mockAutoService,
}));
const { mockImportStatement, mockMatchTransaction } = vi.hoisted(() => ({
  mockImportStatement: vi.fn(),
  mockMatchTransaction: vi.fn(),
}));
vi.mock("../../services/BankingService", () => ({
  BankingService: { importStatement: mockImportStatement },
}));
vi.mock("../../services/BankReconciliationService", () => ({
  BankReconciliationService: { matchTransaction: mockMatchTransaction },
}));

import {
  parseBankStatementAction,
  runAutoReconciliationAction,
  confirmSuggestedAction,
} from "../auto-reconciliation.actions";

const COMPANY_ID = "comp-1";
const USER_ID = "user-1";

const validRow = {
  date: "30/03/2026",
  description: "Compra POS",
  reference: null,
  debit: "943,00",
  credit: null,
  balance: null,
};

const adminMember = { role: "ADMIN" as const };
const viewerMember = { role: "VIEWER" as const };

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({ userId: USER_ID });
  mockPrisma.companyMember.findUnique.mockResolvedValue(adminMember);
  mockPrisma.bankTransaction.findMany.mockResolvedValue([]);
  mockImportStatement.mockResolvedValue({ statementId: "stmt-1", transactionCount: 1 });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  process.env.GEMINI_API_KEY = "test-key";
});

// ─── parseBankStatementAction ─────────────────────────────────────────────────

describe("parseBankStatementAction", () => {
  it("usuario no autenticado → error No autorizado", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null });
    const result = await parseBankStatementAction({ companyId: COMPANY_ID, base64Pdf: "x".repeat(100) });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("VIEWER puede parsear (solo lectura, no muta DB)", async () => {
    mockPrisma.companyMember.findUnique.mockResolvedValueOnce(viewerMember);
    const extracted = { rows: [], openingBalance: null, closingBalance: null, accountNumber: null, bankName: null, periodStart: null, periodEnd: null, holderName: null };
    mockGemini.extractFromPdf.mockResolvedValueOnce(extracted);
    const result = await parseBankStatementAction({ companyId: COMPANY_ID, base64Pdf: "x".repeat(100) });
    expect(result.success).toBe(true);
  });

  it("Zod: base64Pdf vacío → error datos inválidos", async () => {
    const result = await parseBankStatementAction({ companyId: COMPANY_ID, base64Pdf: "" });
    expect(result.success).toBe(false);
  });

  it("sin GEMINI_API_KEY → error servicio no configurado", async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await parseBankStatementAction({ companyId: COMPANY_ID, base64Pdf: "x".repeat(100) });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("no está configurado");
  });

  it("happy path → retorna ExtractedBankStatement", async () => {
    const extracted = {
      rows: [validRow],
      openingBalance: "14.073,06",
      closingBalance: "13.130,06",
      accountNumber: "***9550",
      bankName: "BNC",
      periodStart: "30/03/2026",
      periodEnd: "30/03/2026",
      holderName: "Test User",
    };
    mockGemini.extractFromPdf.mockResolvedValueOnce(extracted);
    const result = await parseBankStatementAction({ companyId: COMPANY_ID, base64Pdf: "x".repeat(100) });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rows).toHaveLength(1);
  });
});

// ─── runAutoReconciliationAction ──────────────────────────────────────────────

describe("runAutoReconciliationAction", () => {
  const validInput = {
    companyId: COMPANY_ID,
    bankAccountId: "bank-1",
    rows: [validRow],
    openingBalance: "14073,06",
    closingBalance: "13130,06",
  };

  it("VIEWER → error No autorizado para esta operación", async () => {
    mockPrisma.companyMember.findUnique.mockResolvedValueOnce(viewerMember);
    const result = await runAutoReconciliationAction(validInput);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado para esta operación");
  });

  it("periodHasData: false → success con guard payload (no error)", async () => {
    mockAutoService.periodHasTransactions.mockResolvedValueOnce(false);
    const result = await runAutoReconciliationAction(validInput);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.periodHasData).toBe(false);
  });

  it("happy path → llama AutoReconciliationService.run y retorna resultados", async () => {
    mockAutoService.periodHasTransactions.mockResolvedValueOnce(true);
    mockAutoService.run.mockResolvedValueOnce({
      auto: [],
      suggested: [],
      unmatched: [{ ...validRow, amount: "943.0000", type: "DEBIT", confidence: "MANUAL", score: 0, matchType: null, matchId: null, matchLabel: null, matchAmount: null, reason: "Sin coincidencia en el sistema" }],
      periodHasData: true,
      totalRows: 1,
    });
    const result = await runAutoReconciliationAction(validInput);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.periodHasData).toBe(true);
  });
});

// ─── confirmSuggestedAction ───────────────────────────────────────────────────

describe("confirmSuggestedAction", () => {
  it("VIEWER → error No autorizado para esta operación", async () => {
    mockPrisma.companyMember.findUnique.mockResolvedValueOnce(viewerMember);
    const result = await confirmSuggestedAction({
      companyId: COMPANY_ID,
      confirmations: [{ bankTransactionId: "btx-1", matchType: "INVOICE_PAYMENT", matchId: "pay-1" }],
    });
    expect(result.success).toBe(false);
  });

  it("Zod: confirmations vacío → error", async () => {
    const result = await confirmSuggestedAction({
      companyId: COMPANY_ID,
      confirmations: [],
    });
    expect(result.success).toBe(false);
  });

  it("no autenticado → error No autorizado", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null });
    const result = await confirmSuggestedAction({
      companyId: COMPANY_ID,
      confirmations: [{ bankTransactionId: "btx-1", matchType: "PAYMENT_RECORD", matchId: "pr-1" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });
});
