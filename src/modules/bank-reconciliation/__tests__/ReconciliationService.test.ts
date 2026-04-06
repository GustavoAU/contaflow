// TDD SPEC — delivered to ledger-agent as executable contract
// All tests below MUST fail before ReconciliationService is implemented.
// Do not modify this file — implement in ReconciliationService.ts to make them pass.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bankTransaction: { findUnique: vi.fn(), update: vi.fn() },
    invoicePayment: { findMany: vi.fn(), findFirst: vi.fn() },
    bankStatement: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import { ReconciliationService } from "../services/ReconciliationService";

const COMPANY_ID = "company-1";
const TX_ID = "btx-1";
const PAYMENT_ID = "pay-1";
const STATEMENT_ID = "stmt-1";

// ─── Base fixtures ─────────────────────────────────────────────────────────────

const BASE_BANK_TX = {
  id: TX_ID,
  statementId: STATEMENT_ID,
  date: new Date("2026-01-15"),
  description: "Pago cliente ABC",
  type: "CREDIT" as const,
  amount: new Decimal("1000.00"),
  reference: null,
  isReconciled: false,
  matchedPaymentId: null,
  matchedAt: null,
  matchedBy: null,
  deletedAt: null,
  createdAt: new Date("2026-01-15"),
  statement: {
    bankAccount: { companyId: COMPANY_ID },
  },
};

const BASE_PAYMENT = {
  id: PAYMENT_ID,
  companyId: COMPANY_ID,
  invoiceId: "inv-1",
  amount: new Decimal("1000.00"),
  currency: "VES" as const,
  amountOriginal: null,
  method: "TRANSFERENCIA" as const,
  referenceNumber: "REF-001",
  date: new Date("2026-01-15"),
  deletedAt: null,
  bankTransactions: [],
};

describe("ReconciliationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── findMatchCandidates ──────────────────────────────────────────────────

  describe("findMatchCandidates", () => {
    it("happy path: retorna pagos con monto exacto y fecha dentro de ventana", async () => {
      vi.mocked(prisma.bankTransaction.findUnique).mockResolvedValue(BASE_BANK_TX as never);
      vi.mocked(prisma.invoicePayment.findMany).mockResolvedValue([BASE_PAYMENT] as never);

      const result = await ReconciliationService.findMatchCandidates(TX_ID, COMPANY_ID);

      expect(result).toHaveLength(1);
      expect(result[0].paymentId).toBe(PAYMENT_ID);
      expect(result[0].score).toBeGreaterThan(0);
    });

    it("retorna array vacío si no hay candidatos dentro de la ventana de fecha", async () => {
      vi.mocked(prisma.bankTransaction.findUnique).mockResolvedValue(BASE_BANK_TX as never);
      vi.mocked(prisma.invoicePayment.findMany).mockResolvedValue([
        {
          ...BASE_PAYMENT,
          date: new Date("2026-02-01"), // 17 días fuera, default ventana ± 3 días
        },
      ] as never);

      const result = await ReconciliationService.findMatchCandidates(TX_ID, COMPANY_ID);

      expect(result).toHaveLength(0);
    });

    it("respeta dateDeltaDays personalizado", async () => {
      vi.mocked(prisma.bankTransaction.findUnique).mockResolvedValue(BASE_BANK_TX as never);
      vi.mocked(prisma.invoicePayment.findMany).mockResolvedValue([
        {
          ...BASE_PAYMENT,
          date: new Date("2026-01-22"), // 7 días — dentro de ventana 10d
        },
      ] as never);

      const resultStrict = await ReconciliationService.findMatchCandidates(TX_ID, COMPANY_ID, {
        dateDeltaDays: 3,
      });
      const resultRelaxed = await ReconciliationService.findMatchCandidates(TX_ID, COMPANY_ID, {
        dateDeltaDays: 10,
      });

      expect(resultStrict).toHaveLength(0);
      expect(resultRelaxed).toHaveLength(1);
    });

    it("excluye pagos fuera de la tolerancia de monto", async () => {
      vi.mocked(prisma.bankTransaction.findUnique).mockResolvedValue(BASE_BANK_TX as never);
      vi.mocked(prisma.invoicePayment.findMany).mockResolvedValue([
        {
          ...BASE_PAYMENT,
          amount: new Decimal("1050.00"), // 5% diferencia — fuera de tolerancia default 0.01
        },
      ] as never);

      const result = await ReconciliationService.findMatchCandidates(TX_ID, COMPANY_ID);

      expect(result).toHaveLength(0);
    });

    it("respeta amountTolerance personalizada", async () => {
      vi.mocked(prisma.bankTransaction.findUnique).mockResolvedValue(BASE_BANK_TX as never);
      vi.mocked(prisma.invoicePayment.findMany).mockResolvedValue([
        {
          ...BASE_PAYMENT,
          amount: new Decimal("1000.50"), // 0.50 diferencia
        },
      ] as never);

      const resultTight = await ReconciliationService.findMatchCandidates(TX_ID, COMPANY_ID, {
        amountTolerance: "0.01",
      });
      const resultRelaxed = await ReconciliationService.findMatchCandidates(TX_ID, COMPANY_ID, {
        amountTolerance: "1.00",
      });

      expect(resultTight).toHaveLength(0);
      expect(resultRelaxed).toHaveLength(1);
    });

    it("lanza error si bankTransaction no existe o no pertenece a companyId (ADR-004)", async () => {
      vi.mocked(prisma.bankTransaction.findUnique).mockResolvedValue({
        ...BASE_BANK_TX,
        statement: { bankAccount: { companyId: "other-company" } }, // cross-tenant
      } as never);

      await expect(
        ReconciliationService.findMatchCandidates(TX_ID, COMPANY_ID)
      ).rejects.toThrow();
    });

    it("retorna candidatos ordenados por score descendente (monto exacto > fecha cercana)", async () => {
      const exactMatch = { ...BASE_PAYMENT, id: "pay-exact", amount: new Decimal("1000.00"), date: new Date("2026-01-15") };
      const closeMatch = { ...BASE_PAYMENT, id: "pay-close", amount: new Decimal("999.99"), date: new Date("2026-01-16") };

      vi.mocked(prisma.bankTransaction.findUnique).mockResolvedValue(BASE_BANK_TX as never);
      vi.mocked(prisma.invoicePayment.findMany).mockResolvedValue([closeMatch, exactMatch] as never);

      const result = await ReconciliationService.findMatchCandidates(TX_ID, COMPANY_ID, {
        amountTolerance: "1.00",
      });

      expect(result[0].paymentId).toBe("pay-exact"); // mayor score
      expect(result[0].score).toBeGreaterThan(result[1].score);
    });
  });

  // ─── getSuggestedMatch ────────────────────────────────────────────────────

  describe("getSuggestedMatch", () => {
    it("retorna el candidato con mayor score si existe", async () => {
      vi.mocked(prisma.bankTransaction.findUnique).mockResolvedValue(BASE_BANK_TX as never);
      vi.mocked(prisma.invoicePayment.findMany).mockResolvedValue([BASE_PAYMENT] as never);

      const result = await ReconciliationService.getSuggestedMatch(TX_ID, COMPANY_ID);

      expect(result).not.toBeNull();
      expect(result?.paymentId).toBe(PAYMENT_ID);
    });

    it("retorna null si no hay candidatos", async () => {
      vi.mocked(prisma.bankTransaction.findUnique).mockResolvedValue(BASE_BANK_TX as never);
      vi.mocked(prisma.invoicePayment.findMany).mockResolvedValue([] as never);

      const result = await ReconciliationService.getSuggestedMatch(TX_ID, COMPANY_ID);

      expect(result).toBeNull();
    });
  });
});
