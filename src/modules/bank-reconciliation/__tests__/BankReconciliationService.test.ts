// TDD SPEC — Fase 17B
// BankReconciliationService: matchTransaction (3 tipos) + detectIgtfCandidate (pure)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bankTransaction: { findFirst: vi.fn(), update: vi.fn() },
    invoicePayment: { findFirst: vi.fn() },
    transaction: { findFirst: vi.fn() },
    paymentRecord: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import { BankReconciliationService } from "../services/BankReconciliationService";

const COMPANY_ID = "company-1";
const TX_ID = "btx-1";
const USER_ID = "user-1";

const BASE_BANK_TX = {
  id: TX_ID,
  statementId: "stmt-1",
  date: new Date("2026-01-15"),
  description: "Depósito cliente",
  type: "CREDIT" as const,
  amount: new Decimal("1000.00"),
  reference: null,
  isReconciled: false,
  matchedPaymentId: null,
  matchedTransactionId: null,
  matchedPaymentRecordId: null,
  matchedAt: null,
  matchedBy: null,
  deletedAt: null,
  createdAt: new Date("2026-01-15"),
  statement: { bankAccount: { companyId: COMPANY_ID } },
};

// ─── matchTransaction ─────────────────────────────────────────────────────────

describe("BankReconciliationService.matchTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: $transaction ejecuta el callback inmediatamente
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          bankTransaction: prisma.bankTransaction,
          invoicePayment: prisma.invoicePayment,
          transaction: prisma.transaction,
          paymentRecord: prisma.paymentRecord,
          auditLog: prisma.auditLog,
        })) as never
    );
  });

  // ─── INVOICE_PAYMENT ───────────────────────────────────────────────────────

  it("match INVOICE_PAYMENT — happy path", async () => {
    const PAYMENT_ID = "pay-1";

    vi.mocked(prisma.bankTransaction.findFirst).mockResolvedValue(BASE_BANK_TX as never);
    vi.mocked(prisma.invoicePayment.findFirst).mockResolvedValue({ id: PAYMENT_ID, companyId: COMPANY_ID } as never);
    vi.mocked(prisma.bankTransaction.update).mockResolvedValue({
      ...BASE_BANK_TX,
      isReconciled: true,
      matchedPaymentId: PAYMENT_ID,
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await BankReconciliationService.matchTransaction(
      TX_ID,
      { type: "INVOICE_PAYMENT", id: PAYMENT_ID },
      COMPANY_ID,
      USER_ID
    );

    expect(result.isReconciled).toBe(true);
    expect(result.matchedPaymentId).toBe(PAYMENT_ID);
    expect(prisma.bankTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ matchedPaymentId: PAYMENT_ID, isReconciled: true }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  // ─── JOURNAL_ENTRY (Transaction) ──────────────────────────────────────────

  it("match JOURNAL_ENTRY — happy path", async () => {
    const JOURNAL_ID = "txn-1";

    vi.mocked(prisma.bankTransaction.findFirst).mockResolvedValue(BASE_BANK_TX as never);
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({ id: JOURNAL_ID, companyId: COMPANY_ID } as never);
    vi.mocked(prisma.bankTransaction.update).mockResolvedValue({
      ...BASE_BANK_TX,
      isReconciled: true,
      matchedTransactionId: JOURNAL_ID,
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await BankReconciliationService.matchTransaction(
      TX_ID,
      { type: "JOURNAL_ENTRY", id: JOURNAL_ID },
      COMPANY_ID,
      USER_ID
    );

    expect(result.isReconciled).toBe(true);
    expect(result.matchedTransactionId).toBe(JOURNAL_ID);
    expect(prisma.bankTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ matchedTransactionId: JOURNAL_ID }),
      })
    );
  });

  // ─── PAYMENT_RECORD ───────────────────────────────────────────────────────

  it("match PAYMENT_RECORD — happy path", async () => {
    const RECORD_ID = "pr-1";

    vi.mocked(prisma.bankTransaction.findFirst).mockResolvedValue(BASE_BANK_TX as never);
    vi.mocked(prisma.paymentRecord.findFirst).mockResolvedValue({ id: RECORD_ID, companyId: COMPANY_ID } as never);
    vi.mocked(prisma.bankTransaction.update).mockResolvedValue({
      ...BASE_BANK_TX,
      isReconciled: true,
      matchedPaymentRecordId: RECORD_ID,
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await BankReconciliationService.matchTransaction(
      TX_ID,
      { type: "PAYMENT_RECORD", id: RECORD_ID },
      COMPANY_ID,
      USER_ID
    );

    expect(result.isReconciled).toBe(true);
    expect(result.matchedPaymentRecordId).toBe(RECORD_ID);
  });

  // ─── Errores de negocio ────────────────────────────────────────────────────

  it("lanza error si bankTransaction no existe o cross-tenant (ADR-004)", async () => {
    vi.mocked(prisma.bankTransaction.findFirst).mockResolvedValue(null);

    await expect(
      BankReconciliationService.matchTransaction(
        TX_ID,
        { type: "INVOICE_PAYMENT", id: "pay-x" },
        COMPANY_ID,
        USER_ID
      )
    ).rejects.toThrow();
  });

  it("lanza error si bankTransaction ya está conciliada", async () => {
    vi.mocked(prisma.bankTransaction.findFirst).mockResolvedValue({
      ...BASE_BANK_TX,
      isReconciled: true,
    } as never);

    await expect(
      BankReconciliationService.matchTransaction(
        TX_ID,
        { type: "INVOICE_PAYMENT", id: "pay-x" },
        COMPANY_ID,
        USER_ID
      )
    ).rejects.toThrow(/conciliada/i);
  });

  it("lanza error si la contrapartida no pertenece a la empresa (ADR-004)", async () => {
    vi.mocked(prisma.bankTransaction.findFirst).mockResolvedValue(BASE_BANK_TX as never);
    vi.mocked(prisma.invoicePayment.findFirst).mockResolvedValue(null); // no encontrado

    await expect(
      BankReconciliationService.matchTransaction(
        TX_ID,
        { type: "INVOICE_PAYMENT", id: "pay-other-company" },
        COMPANY_ID,
        USER_ID
      )
    ).rejects.toThrow(/contrapartida/i);
  });
});

// ─── detectIgtfCandidate (pure function) ──────────────────────────────────────

describe("BankReconciliationService.detectIgtfCandidate", () => {
  const target = {
    ...BASE_BANK_TX,
    id: "btx-target",
    type: "CREDIT" as const,
    amount: new Decimal("1000.00"),
    date: new Date("2026-01-15"),
  };

  it("detecta una nota de débito cuyo monto es ~3% del target", () => {
    const igtfDebit = {
      ...BASE_BANK_TX,
      id: "btx-igtf",
      type: "DEBIT" as const,
      amount: new Decimal("30.00"), // 3% de 1000
      date: new Date("2026-01-15"),
    };

    const result = BankReconciliationService.detectIgtfCandidate(target, [igtfDebit]);

    expect(result).not.toBeNull();
    expect(result?.id).toBe("btx-igtf");
  });

  it("retorna null si no hay candidato IGTF dentro de tolerancia de monto", () => {
    const notIgtf = {
      ...BASE_BANK_TX,
      id: "btx-other",
      type: "DEBIT" as const,
      amount: new Decimal("50.00"), // no es ~3%
      date: new Date("2026-01-15"),
    };

    const result = BankReconciliationService.detectIgtfCandidate(target, [notIgtf]);

    expect(result).toBeNull();
  });

  it("retorna null si el candidato está fuera de la ventana de fecha (> 3 días)", () => {
    const lateIgtf = {
      ...BASE_BANK_TX,
      id: "btx-late",
      type: "DEBIT" as const,
      amount: new Decimal("30.00"),
      date: new Date("2026-01-20"), // 5 días después
    };

    const result = BankReconciliationService.detectIgtfCandidate(target, [lateIgtf]);

    expect(result).toBeNull();
  });

  it("ignora transacciones que ya están conciliadas", () => {
    const reconciledIgtf = {
      ...BASE_BANK_TX,
      id: "btx-reconciled",
      type: "DEBIT" as const,
      amount: new Decimal("30.00"),
      date: new Date("2026-01-15"),
      isReconciled: true, // ya conciliada
    };

    const result = BankReconciliationService.detectIgtfCandidate(target, [reconciledIgtf]);

    expect(result).toBeNull();
  });

  it("ignora el propio target en la lista de candidatos", () => {
    // Si target está en allUnreconciled, no debe retornarse a sí mismo
    const sameAstarget = {
      ...target,
      type: "DEBIT" as const,
      amount: new Decimal("30.00"),
    };

    const result = BankReconciliationService.detectIgtfCandidate(target, [target, sameAstarget]);

    // target.amount = 1000, target mismo tiene id "btx-target" — no debe retornarse
    // sameAstarget también tiene id "btx-target" — mismo id → ignorado
    expect(result).toBeNull(); // sameAstarget tiene el mismo id que target
  });
});
