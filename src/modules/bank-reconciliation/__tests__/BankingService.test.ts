// src/modules/bank-reconciliation/__tests__/BankingService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import { BankingService } from "../services/BankingService";
import type { CsvRow } from "../services/CsvParserService";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bankAccount: { findFirst: vi.fn() },
    bankStatement: { create: vi.fn(), findFirst: vi.fn() },
    bankTransaction: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
    invoicePayment: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi.fn().mockImplementation(
    (_companyId: string, _tx: unknown, fn: (_tx: unknown) => unknown) => fn(_tx)
  ),
}));

import { prisma } from "@/lib/prisma";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const COMPANY_ID = "company-1";
const BANK_ACCOUNT_ID = "ba-1";
const STATEMENT_ID = "stmt-1";
const TX_ID = "btx-1";
const PAYMENT_ID = "pay-1";
const USER_ID = "user-1";

const SAMPLE_ROWS: CsvRow[] = [
  {
    date: new Date("2026-01-05"),
    description: "Depósito",
    debit: null,
    credit: new Decimal("1000.00"),
    balance: new Decimal("1000.00"),
  },
  {
    date: new Date("2026-01-10"),
    description: "Retiro cajero",
    debit: new Decimal("200.00"),
    credit: null,
    balance: new Decimal("800.00"),
  },
];

const OPENING = new Decimal("0.00");
const CLOSING = new Decimal("800.00"); // 0 + 1000 - 200

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("BankingService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. importStatement: happy path
  it("importStatement — crea statement + transactions en $transaction", async () => {
    vi.mocked(prisma.bankAccount.findFirst).mockResolvedValue({
      id: BANK_ACCOUNT_ID,
      companyId: COMPANY_ID,
    } as never);

    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: typeof prisma) => unknown) =>
        fn({
          bankStatement: { create: vi.fn().mockResolvedValue({ id: STATEMENT_ID }) },
          bankTransaction: { create: vi.fn(), count: vi.fn().mockResolvedValue(2) },
          auditLog: { create: vi.fn() },
        } as unknown as typeof prisma)) as never
    );

    const result = await BankingService.importStatement(
      BANK_ACCOUNT_ID,
      COMPANY_ID,
      SAMPLE_ROWS,
      OPENING,
      CLOSING,
      USER_ID
    );

    expect(result.statementId).toBe(STATEMENT_ID);
    expect(result.transactionCount).toBe(2);
  });

  // 2. importStatement: balance no cuadra → lanza Error
  it("importStatement — balance no cuadra lanza Error", async () => {
    vi.mocked(prisma.bankAccount.findFirst).mockResolvedValue({
      id: BANK_ACCOUNT_ID,
      companyId: COMPANY_ID,
    } as never);

    const wrongClosing = new Decimal("999.00"); // No coincide con 800

    await expect(
      BankingService.importStatement(BANK_ACCOUNT_ID, COMPANY_ID, SAMPLE_ROWS, OPENING, wrongClosing, USER_ID)
    ).rejects.toThrow(/balance/i);
  });

  // 3. importStatement: bankAccount no pertenece a companyId → lanza Error
  it("importStatement — bankAccount no pertenece a companyId lanza Error", async () => {
    vi.mocked(prisma.bankAccount.findFirst).mockResolvedValue(null);

    await expect(
      BankingService.importStatement(BANK_ACCOUNT_ID, COMPANY_ID, SAMPLE_ROWS, OPENING, CLOSING, USER_ID)
    ).rejects.toThrow(/no existe o no pertenece/i);
  });

  // 4. getUnreconciledTransactions: filtra solo isReconciled=false y deletedAt IS NULL
  it("getUnreconciledTransactions — filtra correctamente", async () => {
    const mockTxs = [
      { id: "t1", isReconciled: false, deletedAt: null },
      { id: "t2", isReconciled: false, deletedAt: null },
    ];
    vi.mocked(prisma.bankTransaction.findMany).mockResolvedValue(mockTxs as never);

    const result = await BankingService.getUnreconciledTransactions(BANK_ACCOUNT_ID, COMPANY_ID);

    expect(result).toHaveLength(2);
    expect(vi.mocked(prisma.bankTransaction.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isReconciled: false,
          deletedAt: null,
        }),
      })
    );
  });

  // 5. reconcileTransaction: happy path → isReconciled=true, matchedPaymentId seteado
  it("reconcileTransaction — happy path", async () => {
    const mockTx = { id: TX_ID, isReconciled: false, matchedPaymentId: null };
    const mockUpdated = { id: TX_ID, isReconciled: true, matchedPaymentId: PAYMENT_ID };

    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: typeof prisma) => unknown) =>
        fn({
          bankTransaction: {
            findFirst: vi.fn().mockResolvedValue(mockTx),
            update: vi.fn().mockResolvedValue(mockUpdated),
          },
          invoicePayment: { findFirst: vi.fn().mockResolvedValue({ id: PAYMENT_ID }) },
          auditLog: { create: vi.fn() },
        } as unknown as typeof prisma)) as never
    );

    const result = await BankingService.reconcileTransaction(TX_ID, PAYMENT_ID, COMPANY_ID, USER_ID);

    expect(result.isReconciled).toBe(true);
    expect(result.matchedPaymentId).toBe(PAYMENT_ID);
  });

  // 6. reconcileTransaction: ya conciliada → lanza Error
  it("reconcileTransaction — ya conciliada lanza Error", async () => {
    const mockTx = { id: TX_ID, isReconciled: true, matchedPaymentId: PAYMENT_ID };

    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: typeof prisma) => unknown) =>
        fn({
          bankTransaction: {
            findFirst: vi.fn().mockResolvedValue(mockTx),
            update: vi.fn(),
          },
          invoicePayment: { findFirst: vi.fn() },
          auditLog: { create: vi.fn() },
        } as unknown as typeof prisma)) as never
    );

    await expect(
      BankingService.reconcileTransaction(TX_ID, PAYMENT_ID, COMPANY_ID, USER_ID)
    ).rejects.toThrow(/ya está conciliada/i);
  });

  // 7. reconcileTransaction: bankTransaction no pertenece a companyId → lanza Error
  it("reconcileTransaction — transacción no pertenece a companyId lanza Error", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: typeof prisma) => unknown) =>
        fn({
          bankTransaction: {
            findFirst: vi.fn().mockResolvedValue(null),
            update: vi.fn(),
          },
          invoicePayment: { findFirst: vi.fn() },
          auditLog: { create: vi.fn() },
        } as unknown as typeof prisma)) as never
    );

    await expect(
      BankingService.reconcileTransaction(TX_ID, PAYMENT_ID, COMPANY_ID, USER_ID)
    ).rejects.toThrow(/no existe o no pertenece/i);
  });

  // 8. unreconcileTransaction: happy path → isReconciled=false, matchedPaymentId=null
  it("unreconcileTransaction — happy path", async () => {
    const mockTx = { id: TX_ID, isReconciled: true, matchedPaymentId: PAYMENT_ID };
    const mockUpdated = { id: TX_ID, isReconciled: false, matchedPaymentId: null };

    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: typeof prisma) => unknown) =>
        fn({
          bankTransaction: {
            findFirst: vi.fn().mockResolvedValue(mockTx),
            update: vi.fn().mockResolvedValue(mockUpdated),
          },
          auditLog: { create: vi.fn() },
        } as unknown as typeof prisma)) as never
    );

    const result = await BankingService.unreconcileTransaction(TX_ID, COMPANY_ID, USER_ID);

    expect(result.isReconciled).toBe(false);
    expect(result.matchedPaymentId).toBeNull();
  });

  // 9. unreconcileTransaction: no reconciliada → lanza Error
  it("unreconcileTransaction — no conciliada lanza Error", async () => {
    const mockTx = { id: TX_ID, isReconciled: false, matchedPaymentId: null };

    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: typeof prisma) => unknown) =>
        fn({
          bankTransaction: {
            findFirst: vi.fn().mockResolvedValue(mockTx),
            update: vi.fn(),
          },
          auditLog: { create: vi.fn() },
        } as unknown as typeof prisma)) as never
    );

    await expect(
      BankingService.unreconcileTransaction(TX_ID, COMPANY_ID, USER_ID)
    ).rejects.toThrow(/no está conciliada/i);
  });

  // 10. getReconciliationSummary: calcula totales y diferencia correctamente
  it("getReconciliationSummary — calcula totales y diferencia", async () => {
    const mockStatement = {
      id: STATEMENT_ID,
      openingBalance: "0.0000",
      closingBalance: "800.0000",
      transactions: [
        { amount: "1000.0000", type: "CREDIT", isReconciled: true },
        { amount: "200.0000", type: "DEBIT", isReconciled: false },
      ],
    };
    vi.mocked(prisma.bankStatement.findFirst).mockResolvedValue(mockStatement as never);

    const result = await BankingService.getReconciliationSummary(STATEMENT_ID, COMPANY_ID);

    expect(result.total).toBe(2);
    expect(result.reconciled).toBe(1);
    expect(result.pending).toBe(1);
    // difference = 800 - (0 + 1000 - 200) = 800 - 800 = 0
    expect(result.difference).toBe("0.0000");
  });
});
