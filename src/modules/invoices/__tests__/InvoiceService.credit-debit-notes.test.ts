// src/modules/invoices/__tests__/InvoiceService.credit-debit-notes.test.ts
// TDD RED phase — Fase 23C NC/ND Workflow
// These tests import functions that do NOT exist yet → all tests will FAIL (RED)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockFindFirst = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockFindMany = vi.hoisted(() => vi.fn());
const mockAuditLogCreate = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  default: {
    invoice: {
      findFirst: mockFindFirst,
      create: mockCreate,
      update: mockUpdate,
      findMany: mockFindMany,
    },
    auditLog: {
      create: mockAuditLogCreate,
    },
    $transaction: mockTransaction,
  },
}));

// ─── Import functions under test (don't exist yet — will cause RED) ───────────
import {
  createCreditNote,
  createDebitNote,
  getCreditDebitNotes,
} from "@/modules/invoices/services/InvoiceService";

import prisma from "@/lib/prisma";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const COMPANY_ID = "company-1";
const CREATED_BY = "user-1";

const validOriginalInvoice = {
  id: "inv-original",
  companyId: COMPANY_ID,
  docType: "FACTURA",
  invoiceNumber: "0000001",
  pendingAmount: new Decimal("1000"),
  totalAmountVes: new Decimal("1000"),
  paymentStatus: "UNPAID",
  deletedAt: null,
  type: "SALE",
  taxCategory: "GRAVADA",
  counterpartName: "Cliente ABC",
  counterpartRif: "J-12345678-9",
  currency: "VES",
  date: new Date("2026-04-01"),
  ivaRetentionAmount: new Decimal("0"),
  islrRetentionAmount: new Decimal("0"),
  igtfBase: new Decimal("0"),
  igtfAmount: new Decimal("0"),
};

const validNoteData = {
  relatedInvoiceId: "inv-original",
  invoiceNumber: "NC-0000001",
  date: new Date("2026-04-10"),
  counterpartName: "Cliente ABC",
  counterpartRif: "J-12345678-9",
  taxLines: [
    { taxType: "IVA_GENERAL" as const, base: "862.07", rate: "16", amount: "137.93" },
  ],
  ivaRetentionAmount: "0",
  islrRetentionAmount: "0",
  igtfBase: "0",
  igtfAmount: "0",
  currency: "VES" as const,
};

const mockNcInvoice = {
  id: "nc-1",
  companyId: COMPANY_ID,
  docType: "NOTA_CREDITO",
  invoiceNumber: "NC-0000001",
  relatedInvoiceId: "inv-original",
  relatedDocNumber: "0000001",
  totalAmountVes: new Decimal("1000"),
  pendingAmount: new Decimal("0"),
  paymentStatus: "PAID",
};

// ─── Interactive $transaction mock ───────────────────────────────────────────
// Passes a tx object that proxies back to the mocked prisma methods
function setupTransactionMock() {
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: unknown) => unknown) =>
      fn({
        invoice: prisma.invoice,
        auditLog: prisma.auditLog,
        transaction: { create: vi.fn() },
        journalEntry: { create: vi.fn() },
        transactionLine: { createMany: vi.fn() },
      })) as never,
  );
}

// ─── createCreditNote tests ───────────────────────────────────────────────────
describe("InvoiceService.createCreditNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTransactionMock();
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(
      validOriginalInvoice as never,
    );
    vi.mocked(prisma.invoice.create).mockResolvedValue(mockNcInvoice as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({
      ...validOriginalInvoice,
      pendingAmount: new Decimal("0"),
      paymentStatus: "PAID",
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  // ── Test 1: happy path — full amount → PAID ────────────────────────────────
  it("crea NC, reduce pendingAmount y actualiza paymentStatus a PAID", async () => {
    const result = await createCreditNote(COMPANY_ID, validNoteData, CREATED_BY);

    expect(result).toBeDefined();
    expect(result.docType).toBe("NOTA_CREDITO");
    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv-original" },
        data: expect.objectContaining({
          paymentStatus: "PAID",
        }),
      }),
    );
  });

  // ── Test 2: partial NC → PARTIAL ──────────────────────────────────────────
  it("crea NC parcial, mantiene paymentStatus en PARTIAL cuando queda saldo", async () => {
    // original.pendingAmount = 1000, NC = 500 → queda 500 → PARTIAL
    const partialNoteData = {
      ...validNoteData,
      taxLines: [
        { taxType: "IVA_GENERAL" as const, base: "431.03", rate: "16", amount: "68.97" },
      ],
    };
    const partialNcInvoice = {
      ...mockNcInvoice,
      totalAmountVes: new Decimal("500"),
    };
    vi.mocked(prisma.invoice.create).mockResolvedValue(partialNcInvoice as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({
      ...validOriginalInvoice,
      pendingAmount: new Decimal("500"),
      paymentStatus: "PARTIAL",
    } as never);

    const result = await createCreditNote(COMPANY_ID, partialNoteData, CREATED_BY);

    expect(result).toBeDefined();
    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentStatus: "PARTIAL",
        }),
      }),
    );
  });

  // ── Test 3: rejects when nc.totalAmountVes > pendingAmount ────────────────
  it("rechaza si nc.totalAmountVes supera el saldo pendiente de la factura original", async () => {
    const overAmountNoteData = {
      ...validNoteData,
      taxLines: [
        { taxType: "IVA_GENERAL" as const, base: "1086.21", rate: "16", amount: "173.79" },
      ],
    };

    await expect(
      createCreditNote(COMPANY_ID, overAmountNoteData, CREATED_BY),
    ).rejects.toThrow("El monto de la nota supera el saldo pendiente de la factura original");
  });

  // ── Test 4: rejects if original.docType !== FACTURA (loop prevention) ─────
  it("rechaza si el documento original no es FACTURA (prevención de loop NC/ND)", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      ...validOriginalInvoice,
      docType: "NOTA_CREDITO",
    } as never);

    await expect(
      createCreditNote(COMPANY_ID, validNoteData, CREATED_BY),
    ).rejects.toThrow("Solo se pueden emitir notas sobre Facturas (no sobre NC/ND)");
  });

  // ── Test 5: rejects if original.deletedAt is set ──────────────────────────
  it("rechaza si la factura original tiene deletedAt (soft delete guard)", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      ...validOriginalInvoice,
      deletedAt: new Date("2026-03-01"),
    } as never);

    await expect(
      createCreditNote(COMPANY_ID, validNoteData, CREATED_BY),
    ).rejects.toThrow("La factura original está anulada");
  });

  // ── Test 6: rejects if original.paymentStatus === VOIDED ─────────────────
  it("rechaza si la factura original tiene paymentStatus VOIDED", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      ...validOriginalInvoice,
      paymentStatus: "VOIDED",
    } as never);

    await expect(
      createCreditNote(COMPANY_ID, validNoteData, CREATED_BY),
    ).rejects.toThrow("La factura original está anulada");
  });

  // ── Test 7: CRITICAL-1 — rejects if relatedInvoiceId belongs to different companyId ──
  it("rechaza si relatedInvoiceId no pertenece a este companyId [CRITICAL-1 ADR-004]", async () => {
    // findFirst returns null when companyId does not match
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null as never);

    await expect(
      createCreditNote(COMPANY_ID, validNoteData, CREATED_BY),
    ).rejects.toThrow(
      "Factura original no encontrada o no pertenece a esta empresa",
    );
  });

  // ── Test 8: relatedDocNumber is derived from original, not from input ──────
  it("almacena relatedDocNumber derivado de original.invoiceNumber, nunca del input del cliente", async () => {
    await createCreditNote(COMPANY_ID, validNoteData, CREATED_BY);

    expect(prisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          relatedDocNumber: validOriginalInvoice.invoiceNumber, // "0000001"
          relatedInvoiceId: validOriginalInvoice.id,
        }),
      }),
    );
  });

  // ── Test 9: auditLog.create called twice in the same tx ───────────────────
  it("llama auditLog.create exactamente dos veces en la misma transacción", async () => {
    await createCreditNote(COMPANY_ID, validNoteData, CREATED_BY);

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
    // First call: CREATE_NC
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "CREATE_NC",
          entityName: "Invoice",
        }),
      }),
    );
    // Second call: PENDING_AMOUNT_UPDATE
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "PENDING_AMOUNT_UPDATE",
          entityName: "Invoice",
          entityId: validOriginalInvoice.id,
        }),
      }),
    );
  });
});

// ─── createDebitNote tests ────────────────────────────────────────────────────
describe("InvoiceService.createDebitNote", () => {
  const mockNdInvoice = {
    id: "nd-1",
    companyId: COMPANY_ID,
    docType: "NOTA_DEBITO",
    invoiceNumber: "ND-0000001",
    relatedInvoiceId: "inv-original",
    relatedDocNumber: "0000001",
    totalAmountVes: new Decimal("200"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupTransactionMock();
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(
      validOriginalInvoice as never,
    );
    vi.mocked(prisma.invoice.create).mockResolvedValue(mockNdInvoice as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({
      ...validOriginalInvoice,
      pendingAmount: new Decimal("1200"),
      paymentStatus: "UNPAID",
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  const ndNoteData = {
    relatedInvoiceId: "inv-original",
    invoiceNumber: "ND-0000001",
    date: new Date("2026-04-10"),
    counterpartName: "Cliente ABC",
    counterpartRif: "J-12345678-9",
    taxLines: [
      { taxType: "IVA_GENERAL" as const, base: "172.41", rate: "16", amount: "27.59" },
    ],
    ivaRetentionAmount: "0",
    islrRetentionAmount: "0",
    igtfBase: "0",
    igtfAmount: "0",
    currency: "VES" as const,
  };

  // ── Test 10: happy path — creates ND, increases pendingAmount ────────────
  it("crea ND e incrementa pendingAmount de la factura original", async () => {
    const result = await createDebitNote(COMPANY_ID, ndNoteData, CREATED_BY);

    expect(result).toBeDefined();
    expect(result.docType).toBe("NOTA_DEBITO");
    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv-original" },
        data: expect.objectContaining({
          pendingAmount: expect.anything(), // Decimal increased
        }),
      }),
    );
  });

  // ── Test 11: ND on PAID invoice → changes paymentStatus to PARTIAL ────────
  it("cambia paymentStatus de PAID a PARTIAL cuando se emite ND sobre factura pagada", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      ...validOriginalInvoice,
      pendingAmount: new Decimal("0"),
      paymentStatus: "PAID",
    } as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({
      ...validOriginalInvoice,
      pendingAmount: new Decimal("200"),
      paymentStatus: "PARTIAL",
    } as never);

    await createDebitNote(COMPANY_ID, ndNoteData, CREATED_BY);

    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentStatus: "PARTIAL",
        }),
      }),
    );
  });

  // ── Test 12: rejects if original.docType !== FACTURA ─────────────────────
  it("rechaza si el documento original no es FACTURA (loop prevention)", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      ...validOriginalInvoice,
      docType: "NOTA_DEBITO",
    } as never);

    await expect(
      createDebitNote(COMPANY_ID, ndNoteData, CREATED_BY),
    ).rejects.toThrow("Solo se pueden emitir notas sobre Facturas (no sobre NC/ND)");
  });

  // ── Test 13: CRITICAL-1 — rejects if relatedInvoiceId belongs to different companyId ──
  it("rechaza si relatedInvoiceId no pertenece a este companyId [CRITICAL-1 ADR-004]", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null as never);

    await expect(
      createDebitNote(COMPANY_ID, ndNoteData, CREATED_BY),
    ).rejects.toThrow(
      "Factura original no encontrada o no pertenece a esta empresa",
    );
  });

  // ── Test 15 (regresión HIGH-1): rejects ND if paymentStatus === VOIDED even with deletedAt null ──
  it("rechaza ND si paymentStatus es VOIDED aunque deletedAt sea null [HIGH-1 ADR-006]", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      ...validOriginalInvoice,
      deletedAt: null,
      paymentStatus: "VOIDED",
    } as never);

    await expect(
      createDebitNote(COMPANY_ID, ndNoteData, CREATED_BY),
    ).rejects.toThrow("La factura original está anulada");
  });
});

// ─── getCreditDebitNotes tests ────────────────────────────────────────────────
describe("InvoiceService.getCreditDebitNotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);
  });

  // ── Test 14: returns only notes with deletedAt IS NULL, ordered by date ASC ──
  it("retorna solo notas con deletedAt IS NULL ordenadas por fecha ASC", async () => {
    const notes = [
      { id: "nc-1", docType: "NOTA_CREDITO", date: new Date("2026-04-02"), deletedAt: null },
      { id: "nc-2", docType: "NOTA_CREDITO", date: new Date("2026-04-05"), deletedAt: null },
    ];
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(notes as never);

    const result = await getCreditDebitNotes("inv-original", COMPANY_ID);

    expect(result).toHaveLength(2);
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
        }),
        orderBy: expect.arrayContaining([
          expect.objectContaining({ date: "asc" }),
        ]),
      }),
    );
  });

  // ── Test 15: includes companyId in where clause (ADR-004) ─────────────────
  it("incluye companyId en la cláusula where para guard multi-tenant [ADR-004]", async () => {
    await getCreditDebitNotes("inv-original", COMPANY_ID);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: COMPANY_ID,
          relatedInvoiceId: "inv-original",
        }),
      }),
    );
  });
});
