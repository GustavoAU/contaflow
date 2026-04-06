// src/modules/bank-reconciliation/__tests__/banking.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (deben declararse antes de cualquier import del módulo testeado) ───

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {}, ocr: {} },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    companyMember: { findUnique: vi.fn() },
  },
}));

vi.mock("../services/BankingService", () => ({
  BankingService: {
    importStatement: vi.fn(),
    getUnreconciledTransactions: vi.fn(),
    reconcileTransaction: vi.fn(),
    unreconcileTransaction: vi.fn(),
    getReconciliationSummary: vi.fn(),
  },
}));

vi.mock("../services/CsvParserService", () => ({
  CsvParserService: {
    parseBankCsv: vi.fn(),
    validateCsvBalance: vi.fn(),
  },
}));

// ─── Imports después de los mocks ────────────────────────────────────────────

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { BankingService } from "../services/BankingService";
import { CsvParserService } from "../services/CsvParserService";
import {
  importStatementAction,
  reconcileTransactionAction,
  unreconcileTransactionAction,
  getUnreconciledTransactionsAction,
  getReconciliationSummaryAction,
} from "../actions/banking.actions";
import { Decimal } from "decimal.js";

// ─── Constantes ───────────────────────────────────────────────────────────────

const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const BANK_ACCOUNT_ID = "ba-1";
const STATEMENT_ID = "stmt-1";
const TX_ID = "btx-1";
const PAYMENT_ID = "pay-1";

const VALID_IMPORT_INPUT = {
  bankAccountId: BANK_ACCOUNT_ID,
  companyId: COMPANY_ID,
  csvContent: "date,description,debit,credit,balance\n01/01/2026,Deposito,,1000.00,1000.00",
  openingBalance: "0.00",
  closingBalance: "1000.00",
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("banking.actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. importStatementAction: sin auth → { success: false, error: "No autorizado" }
  it("importStatementAction — sin auth retorna no autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await importStatementAction(VALID_IMPORT_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("No autorizado");
    }
  });

  // 2. importStatementAction: sin membership → { success: false, error: "..." }
  it("importStatementAction — sin membership retorna error", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(null);

    const result = await importStatementAction(VALID_IMPORT_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/permisos/i);
    }
  });

  // 3. importStatementAction: input inválido → { success: false, error: "..." }
  it("importStatementAction — input inválido retorna error de validación", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);

    const invalidInput = {
      bankAccountId: "",
      companyId: COMPANY_ID,
      csvContent: "content",
      openingBalance: "0.00",
      closingBalance: "1000.00",
    };

    const result = await importStatementAction(invalidInput);

    expect(result.success).toBe(false);
  });

  // 4. importStatementAction: happy path → { success: true, data: { statementId, transactionCount } }
  it("importStatementAction — happy path retorna statementId y transactionCount", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(CsvParserService.parseBankCsv).mockReturnValue([
      {
        date: new Date("2026-01-01"),
        description: "Deposito",
        debit: null,
        credit: new Decimal("1000.00"),
        balance: new Decimal("1000.00"),
      },
    ]);
    vi.mocked(BankingService.importStatement).mockResolvedValue({
      statementId: STATEMENT_ID,
      transactionCount: 1,
    });

    const result = await importStatementAction(VALID_IMPORT_INPUT);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.statementId).toBe(STATEMENT_ID);
      expect(result.data.transactionCount).toBe(1);
    }
  });

  // 5. reconcileTransactionAction: happy path → { success: true }
  it("reconcileTransactionAction — happy path", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(BankingService.reconcileTransaction).mockResolvedValue({
      id: TX_ID,
      isReconciled: true,
      matchedPaymentId: PAYMENT_ID,
    } as never);

    const result = await reconcileTransactionAction({
      bankTransactionId: TX_ID,
      invoicePaymentId: PAYMENT_ID,
      companyId: COMPANY_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isReconciled).toBe(true);
    }
  });

  // 6. unreconcileTransactionAction: happy path → { success: true }
  it("unreconcileTransactionAction — happy path", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "ADMIN" } as never);
    vi.mocked(BankingService.unreconcileTransaction).mockResolvedValue({
      id: TX_ID,
      isReconciled: false,
      matchedPaymentId: null,
    } as never);

    const result = await unreconcileTransactionAction({
      bankTransactionId: TX_ID,
      companyId: COMPANY_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isReconciled).toBe(false);
    }
  });

  // 7. getUnreconciledTransactionsAction: happy path → { success: true, data: [...] }
  it("getUnreconciledTransactionsAction — happy path", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(BankingService.getUnreconciledTransactions).mockResolvedValue([
      {
        id: TX_ID,
        isReconciled: false,
        amount: "500.0000" as unknown as Decimal,
        statementId: STATEMENT_ID,
      } as never,
    ]);

    const result = await getUnreconciledTransactionsAction({
      bankAccountId: BANK_ACCOUNT_ID,
      companyId: COMPANY_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
    }
  });

  // 8. getReconciliationSummaryAction: happy path → { success: true, data: {...} }
  it("getReconciliationSummaryAction — happy path", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(BankingService.getReconciliationSummary).mockResolvedValue({
      total: 10,
      reconciled: 7,
      pending: 3,
      difference: "0.0000",
    });

    const result = await getReconciliationSummaryAction({
      bankStatementId: STATEMENT_ID,
      companyId: COMPANY_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.total).toBe(10);
      expect(result.data.reconciled).toBe(7);
      expect(result.data.pending).toBe(3);
      expect(result.data.difference).toBe("0.0000");
    }
  });

  // ─── Role checks (ADR-006 D-1 regression) ───────────────────────────────────

  // VIEWER no puede importar extractos
  it("importStatementAction — VIEWER role retorna no autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "VIEWER" } as never);

    const result = await importStatementAction(VALID_IMPORT_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/no autorizado/i);
    }
  });

  // VIEWER no puede conciliar
  it("reconcileTransactionAction — VIEWER role retorna no autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "VIEWER" } as never);

    const result = await reconcileTransactionAction({
      bankTransactionId: TX_ID,
      invoicePaymentId: PAYMENT_ID,
      companyId: COMPANY_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/no autorizado/i);
    }
  });

  // ACCOUNTANT no puede desconciliar (solo ADMIN)
  it("unreconcileTransactionAction — ACCOUNTANT role retorna no autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "ACCOUNTANT" } as never);

    const result = await unreconcileTransactionAction({
      bankTransactionId: TX_ID,
      companyId: COMPANY_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/no autorizado/i);
    }
  });

  // VIEWER no puede crear cuenta bancaria
  it("createBankAccountAction — VIEWER role retorna no autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "VIEWER" } as never);

    const result = await (await import("../actions/banking.actions")).createBankAccountAction({
      companyId: COMPANY_ID,
      accountId: "acc-1",
      name: "Cuenta corriente",
      bankName: "Banesco",
      currency: "VES",
      createdBy: USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/no autorizado/i);
    }
  });

  // ACCOUNTANT no puede crear cuenta bancaria (solo ADMIN)
  it("createBankAccountAction — ACCOUNTANT role retorna no autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "ACCOUNTANT" } as never);

    const result = await (await import("../actions/banking.actions")).createBankAccountAction({
      companyId: COMPANY_ID,
      accountId: "acc-1",
      name: "Cuenta corriente",
      bankName: "Banesco",
      currency: "VES",
      createdBy: USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/no autorizado/i);
    }
  });
});
