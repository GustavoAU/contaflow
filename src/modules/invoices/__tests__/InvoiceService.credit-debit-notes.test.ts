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
const mockAccountingPeriodFindFirst = vi.hoisted(() => vi.fn());
const mockCompanySettingsFindUnique = vi.hoisted(() => vi.fn());
const mockGLPostCreditNote = vi.hoisted(() => vi.fn());
const mockGLPostInvoice = vi.hoisted(() => vi.fn());
const mockGLCanPost = vi.hoisted(() => vi.fn());

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

vi.mock("@/modules/invoices/services/InvoiceGLPostingService", () => ({
  InvoiceGLPostingService: {
    canPost: mockGLCanPost,
    postInvoice: mockGLPostInvoice,
    postCreditNote: mockGLPostCreditNote,
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
  type: "SALE",
  docType: "NOTA_CREDITO",
  invoiceNumber: "NC-0000001",
  controlNumber: "00-00000002",
  relatedInvoiceId: "inv-original",
  relatedDocNumber: "0000001",
  totalAmountVes: new Decimal("1000"),
  pendingAmount: new Decimal("0"),
  paymentStatus: "PAID",
  // ADR-019: buildPayload requiere date/currency/counterpart del documento creado
  date: new Date("2026-04-10"),
  currency: "VES",
  counterpartName: "Cliente ABC",
  counterpartRif: "J-12345678-9",
  taxLines: [],
};

// ─── Interactive $transaction mock ───────────────────────────────────────────
// Passes a tx object that proxies back to the mocked prisma methods
// ADR-019 D-1: seniatSubmission.create se invoca dentro del mismo $transaction
// para NC/ND de venta — el mock se expone para poder asertar sobre él.
const mockSeniatSubmissionCreate = vi.fn();

function setupTransactionMock() {
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: unknown) => unknown) =>
      fn({
        invoice: prisma.invoice,
        auditLog: prisma.auditLog,
        transaction: { create: vi.fn() },
        journalEntry: { create: vi.fn() },
        transactionLine: { createMany: vi.fn() },
        // H-002: controlNumberSequence para auto-generación de Nº Control en NC/ND SALE
        controlNumberSequence: { upsert: vi.fn().mockResolvedValue({ lastNumber: 1 }) },
        // ADR-019 D-1/D-1.1d: outbox PA-121 para NC/ND de venta
        seniatSubmission: { create: mockSeniatSubmissionCreate },
        company: { findUnique: vi.fn().mockResolvedValue({ rif: "J-99999999-9" }) },
        // Fix A2: período CLOSED guard + companySettings para GL posting
        accountingPeriod: { findFirst: mockAccountingPeriodFindFirst },
        companySettings: { findUnique: mockCompanySettingsFindUnique },
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
    // Fix A2 defaults: período OPEN, sin config GL (GL posting skipped)
    mockAccountingPeriodFindFirst.mockResolvedValue({ id: "period-1", status: "OPEN", year: 2026, month: 4 });
    mockCompanySettingsFindUnique.mockResolvedValue(null);
    mockGLCanPost.mockReturnValue(false);
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

  // ── ADR-019 D-1/D-1.1d: SeniatSubmission en el mismo $transaction (PA-121) ──
  it("crea SeniatSubmission para NC de venta en la misma transacción", async () => {
    await createCreditNote(COMPANY_ID, validNoteData, CREATED_BY);

    expect(mockSeniatSubmissionCreate).toHaveBeenCalledTimes(1);
    expect(mockSeniatSubmissionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: COMPANY_ID,
          invoiceId: "nc-1",
        }),
      }),
    );
  });

  // ── Fix A2: período CLOSED bloquea NC (R-3) ───────────────────────────────
  it("rechaza NC si el período contable de la fecha está CERRADO [Fix A2 R-3]", async () => {
    mockAccountingPeriodFindFirst.mockResolvedValue({
      id: "period-closed",
      status: "CLOSED",
      year: 2026,
      month: 4,
    });

    await expect(
      createCreditNote(COMPANY_ID, validNoteData, CREATED_BY)
    ).rejects.toThrow("CERRADO");
  });

  // ── Fix A2: periodId asignado en la NC creada ─────────────────────────────
  it("asigna periodId de la fecha al crear la NC [Fix A2]", async () => {
    mockAccountingPeriodFindFirst.mockResolvedValue({
      id: "period-apr-2026",
      status: "OPEN",
      year: 2026,
      month: 4,
    });

    await createCreditNote(COMPANY_ID, validNoteData, CREATED_BY);

    expect(prisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ periodId: "period-apr-2026" }),
      })
    );
  });

  // ── Fix A2: GL reverso llamado cuando canPost = true ──────────────────────
  it("llama postCreditNote cuando GL está configurado [Fix A2 ADR-026]", async () => {
    const glSettings = {
      arAccountId: "acc-ar",
      apAccountId: null,
      salesAccountId: "acc-sales",
      purchaseExpenseAccountId: null,
      inventoryAccountId: null,
      ivaDFAccountId: "acc-ivadf",
      ivaCFAccountId: null,
      ivaRetentionPayableAccountId: null,
      igtfPayableAccountId: null,
    };
    mockCompanySettingsFindUnique.mockResolvedValue(glSettings);
    mockGLCanPost.mockReturnValue(true);
    mockGLPostCreditNote.mockResolvedValue("gl-tx-1");

    await createCreditNote(COMPANY_ID, validNoteData, CREATED_BY);

    expect(mockGLPostCreditNote).toHaveBeenCalledTimes(1);
    expect(mockGLPostCreditNote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "nc-1", docType: "NOTA_CREDITO" }),
      glSettings,
      COMPANY_ID,
      CREATED_BY,
      expect.anything()
    );
  });
});

// ─── createDebitNote tests ────────────────────────────────────────────────────
describe("InvoiceService.createDebitNote", () => {
  const mockNdInvoice = {
    id: "nd-1",
    companyId: COMPANY_ID,
    type: "SALE",
    docType: "NOTA_DEBITO",
    invoiceNumber: "ND-0000001",
    controlNumber: "00-00000003",
    relatedInvoiceId: "inv-original",
    relatedDocNumber: "0000001",
    totalAmountVes: new Decimal("200"),
    // ADR-019: buildPayload requiere date/currency/counterpart del documento creado
    date: new Date("2026-04-10"),
    currency: "VES",
    counterpartName: "Cliente ABC",
    counterpartRif: "J-12345678-9",
    taxLines: [],
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
    // Fix A2 defaults: período OPEN, sin config GL
    mockAccountingPeriodFindFirst.mockResolvedValue({ id: "period-1", status: "OPEN", year: 2026, month: 4 });
    mockCompanySettingsFindUnique.mockResolvedValue(null);
    mockGLCanPost.mockReturnValue(false);
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

  // ── ADR-019 D-1/D-1.1d: SeniatSubmission en el mismo $transaction (PA-121) ──
  it("crea SeniatSubmission para ND de venta en la misma transacción", async () => {
    await createDebitNote(COMPANY_ID, ndNoteData, CREATED_BY);

    expect(mockSeniatSubmissionCreate).toHaveBeenCalledTimes(1);
    expect(mockSeniatSubmissionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: COMPANY_ID,
          invoiceId: "nd-1",
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

  // ── Fix A2: período CLOSED bloquea ND (R-3) ───────────────────────────────
  it("rechaza ND si el período contable de la fecha está CERRADO [Fix A2 R-3]", async () => {
    mockAccountingPeriodFindFirst.mockResolvedValue({
      id: "period-closed",
      status: "CLOSED",
      year: 2026,
      month: 4,
    });

    await expect(
      createDebitNote(COMPANY_ID, ndNoteData, CREATED_BY)
    ).rejects.toThrow("CERRADO");
  });

  // ── Fix A2: GL posting (postInvoice) llamado cuando canPost = true ────────
  it("llama postInvoice cuando GL está configurado para ND [Fix A2 ADR-026]", async () => {
    const glSettings = {
      arAccountId: "acc-ar",
      apAccountId: null,
      salesAccountId: "acc-sales",
      purchaseExpenseAccountId: null,
      inventoryAccountId: null,
      ivaDFAccountId: "acc-ivadf",
      ivaCFAccountId: null,
      ivaRetentionPayableAccountId: null,
      igtfPayableAccountId: null,
    };
    mockCompanySettingsFindUnique.mockResolvedValue(glSettings);
    mockGLCanPost.mockReturnValue(true);
    mockGLPostInvoice.mockResolvedValue("gl-tx-2");

    await createDebitNote(COMPANY_ID, ndNoteData, CREATED_BY);

    expect(mockGLPostInvoice).toHaveBeenCalledTimes(1);
    expect(mockGLPostInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ id: "nd-1", docType: "NOTA_DEBITO" }),
      glSettings,
      COMPANY_ID,
      CREATED_BY,
      expect.anything()
    );
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
