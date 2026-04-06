// src/modules/bank-reconciliation/__tests__/BankStatementService.test.ts
//
// Regression tests for LL-010:
// "Every public method on a service class that writes to the DB must either
//  (a) accept a tx: Prisma.TransactionClient and delegate, or
//  (b) wrap its own prisma.$transaction internally."
//
// Specifically: addTransaction MUST delegate to tx.bankTransaction.create
// (not prisma.bankTransaction.create directly) so the caller's $transaction
// controls atomicity. If a downstream write fails after addTransaction,
// the real DB transaction rolls back the bankTransaction record.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bankStatement: { findUnique: vi.fn(), findMany: vi.fn() },
    bankTransaction: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { BankStatementService } from "../services/BankStatementService";
import type { Prisma } from "@prisma/client";

const STATEMENT_ID = "stmt-1";
const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const TX_ID = "btx-1";
const PAYMENT_ID = "pay-1";

// ─── LL-010 Regression ────────────────────────────────────────────────────────

describe("BankStatementService.addTransaction — LL-010 regression", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delega a tx.bankTransaction.create, NO a prisma.bankTransaction.create", async () => {
    // The fix: addTransaction accepts tx and calls tx.bankTransaction.create
    const txCreate = vi.fn().mockResolvedValue({ id: TX_ID });
    const txMock = {
      bankTransaction: { create: txCreate },
    } as unknown as Prisma.TransactionClient;

    await BankStatementService.addTransaction(
      {
        statementId: STATEMENT_ID,
        companyId: COMPANY_ID,
        date: new Date("2026-01-05"),
        description: "Depósito test",
        type: "CREDIT",
        amount: "1000.00",
        reference: undefined,
      },
      txMock
    );

    // Must use the tx mock, NOT the global prisma mock
    expect(txCreate).toHaveBeenCalledOnce();
    expect(vi.mocked(prisma.bankTransaction.create)).not.toHaveBeenCalled();
  });

  it("propaga el error si un write posterior en la misma tx falla (simulando rollback DB)", async () => {
    // Scenario: addTransaction succeeds, but the caller's next write (e.g. auditLog) throws.
    // The error must propagate so that in a real DB the entire $transaction rolls back,
    // including the bankTransaction just created by addTransaction.
    const txCreate = vi.fn().mockResolvedValue({ id: TX_ID });
    const txAuditFail = vi.fn().mockRejectedValue(new Error("DB write failure"));

    const txMock = {
      bankTransaction: { create: txCreate },
      auditLog: { create: txAuditFail },
    } as unknown as Prisma.TransactionClient;

    // Simulate a caller that does: addTransaction → auditLog (fails)
    const callerFn = async () => {
      await BankStatementService.addTransaction(
        {
          statementId: STATEMENT_ID,
          companyId: COMPANY_ID,
          date: new Date("2026-01-05"),
          description: "Depósito test",
          type: "CREDIT",
          amount: "1000.00",
          reference: undefined,
        },
        txMock
      );
      // downstream write — simulates a second operation in the same tx
      await txMock.auditLog.create({ data: {} as never });
    };

    await expect(callerFn()).rejects.toThrow("DB write failure");
    // addTransaction DID execute (bankTransaction.create was called)
    expect(txCreate).toHaveBeenCalledOnce();
    // In real DB: the $transaction wrapper would have rolled back the bankTransaction.create
  });

  it("pasa los campos correctamente a tx.bankTransaction.create", async () => {
    const txCreate = vi.fn().mockResolvedValue({ id: TX_ID });
    const txMock = {
      bankTransaction: { create: txCreate },
    } as unknown as Prisma.TransactionClient;

    const input = {
      statementId: STATEMENT_ID,
      companyId: COMPANY_ID,
      date: new Date("2026-01-10"),
      description: "Retiro cajero",
      type: "DEBIT" as const,
      amount: "200.50",
      reference: "REF-001",
    };

    await BankStatementService.addTransaction(input, txMock);

    expect(txCreate).toHaveBeenCalledWith({
      data: {
        statementId: STATEMENT_ID,
        companyId: COMPANY_ID,
        date: input.date,
        description: "Retiro cajero",
        type: "DEBIT",
        amount: new Decimal("200.50"),
        reference: "REF-001",
      },
    });
  });
});

// ─── BankStatementService.unmatchTransaction ─────────────────────────────────

describe("BankStatementService.unmatchTransaction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revierte match de bankTransaction y crea AuditLog", async () => {
    const existing = {
      id: TX_ID,
      isReconciled: true,
      matchedPaymentId: PAYMENT_ID,
    };
    const updated = { id: TX_ID, isReconciled: false, matchedPaymentId: null };

    const txFindFirst = vi.fn().mockResolvedValue(existing);
    const txUpdate = vi.fn().mockResolvedValue(updated);
    const txAuditCreate = vi.fn().mockResolvedValue({});

    const txMock = {
      bankTransaction: { findFirst: txFindFirst, update: txUpdate },
      auditLog: { create: txAuditCreate },
    } as unknown as Prisma.TransactionClient;

    const result = await BankStatementService.unmatchTransaction(
      TX_ID,
      COMPANY_ID,
      USER_ID,
      txMock
    );

    expect(result.isReconciled).toBe(false);
    expect(result.matchedPaymentId).toBeNull();
    expect(txAuditCreate).toHaveBeenCalledOnce();
  });

  it("lanza error si la transacción no pertenece a la companyId", async () => {
    const txFindFirst = vi.fn().mockResolvedValue(null);
    const txMock = {
      bankTransaction: { findFirst: txFindFirst, update: vi.fn() },
      auditLog: { create: vi.fn() },
    } as unknown as Prisma.TransactionClient;

    await expect(
      BankStatementService.unmatchTransaction(TX_ID, COMPANY_ID, USER_ID, txMock)
    ).rejects.toThrow(/no encontrada o sin permisos/i);

    expect(vi.mocked(txMock.bankTransaction.update)).not.toHaveBeenCalled();
  });
});

// ─── BankStatementService.getWithTransactions ─────────────────────────────────

describe("BankStatementService.getWithTransactions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna null si el extracto no existe", async () => {
    vi.mocked(prisma.bankStatement.findUnique).mockResolvedValue(null as never);

    const result = await BankStatementService.getWithTransactions("nonexistent");
    expect(result).toBeNull();
  });

  it("retorna null si el extracto pertenece a otra companyId (aislamiento ADR-004)", async () => {
    vi.mocked(prisma.bankStatement.findUnique).mockResolvedValue({
      id: STATEMENT_ID,
      bankAccount: { companyId: "other-company", id: "ba-2", name: "Otro", bankName: "BNC", currency: "VES" },
      transactions: [],
      openingBalance: new Decimal("0"),
      closingBalance: new Decimal("0"),
    } as never);

    const result = await BankStatementService.getWithTransactions(STATEMENT_ID, COMPANY_ID);
    expect(result).toBeNull();
  });

  it("retorna el extracto con balances convertidos y matchedCount correcto", async () => {
    vi.mocked(prisma.bankStatement.findUnique).mockResolvedValue({
      id: STATEMENT_ID,
      bankAccount: {
        id: "ba-1",
        name: "Banco test",
        bankName: "Mercantil",
        currency: "VES",
        companyId: COMPANY_ID,
      },
      openingBalance: new Decimal("500"),
      closingBalance: new Decimal("1300"),
      transactions: [
        { id: "t1", amount: new Decimal("1000"), type: "CREDIT", isReconciled: true, matchedPaymentId: PAYMENT_ID, matchedPayment: null },
        { id: "t2", amount: new Decimal("200"),  type: "DEBIT",  isReconciled: false, matchedPaymentId: null, matchedPayment: null },
      ],
    } as never);

    const result = await BankStatementService.getWithTransactions(STATEMENT_ID, COMPANY_ID);

    expect(result).not.toBeNull();
    expect(result!.openingBalance).toBe("500.00");
    expect(result!.closingBalance).toBe("1300.00");
    expect(result!.matchedCount).toBe(1);
    expect(result!.totalCount).toBe(2);
    expect(result!.transactions[0].amount).toBe("1000.00");
  });
});
