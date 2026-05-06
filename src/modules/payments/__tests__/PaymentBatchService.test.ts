import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  default: {
    paymentBatch: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    paymentBatchLine: {},
    invoice: { findFirst: vi.fn(), update: vi.fn() },
    invoicePayment: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    company: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { PaymentBatchService } from "../services/PaymentBatchService";

const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const BATCH_ID = "batch-1";
const INV_A = "invoice-a";
const INV_B = "invoice-b";
const DATE = new Date("2026-05-01");

const BASE_LINE_A = {
  id: "line-1",
  paymentBatchId: BATCH_ID,
  invoiceId: INV_A,
  amountVes: new Decimal("150000.0000"),
  amountOriginal: null,
  igtfAmount: null,
  notes: null,
  createdAt: DATE,
};

const BASE_LINE_B = {
  id: "line-2",
  paymentBatchId: BATCH_ID,
  invoiceId: INV_B,
  amountVes: new Decimal("350000.0000"),
  amountOriginal: null,
  igtfAmount: null,
  notes: null,
  createdAt: DATE,
};

const BASE_BATCH = {
  id: BATCH_ID,
  companyId: COMPANY_ID,
  status: "DRAFT" as const,
  method: "TRANSFERENCIA" as const,
  totalAmountVes: new Decimal("500000.0000"),
  currency: "VES",
  totalAmountOriginal: null,
  exchangeRateId: null,
  referenceNumber: "REF-001",
  originBank: "Banesco",
  destBank: "BDV",
  commissionPct: null,
  commissionAmount: null,
  totalIgtfAmount: null,
  date: DATE,
  notes: null,
  voidReason: null,
  voidedAt: null,
  voidedBy: null,
  deletedAt: null,
  createdAt: DATE,
  createdBy: USER_ID,
  idempotencyKey: "idem-key-1",
  lines: [BASE_LINE_A, BASE_LINE_B],
};

// Helper: $transaction ejecuta el callback inmediatamente
function mockTx() {
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: unknown) => unknown, _opts?: unknown) =>
      fn({
        paymentBatch: prisma.paymentBatch,
        invoice: prisma.invoice,
        invoicePayment: prisma.invoicePayment,
        company: prisma.company,
        auditLog: prisma.auditLog,
      })) as never
  );
}

// ─── validateSumInvariant ─────────────────────────────────────────────────────

describe("PaymentBatchService.validateSumInvariant", () => {
  it("no lanza error cuando suma coincide", () => {
    expect(() =>
      PaymentBatchService.validateSumInvariant({
        totalAmountVes: new Decimal("500000"),
        totalIgtfAmount: null,
        lines: [
          { amountVes: new Decimal("150000"), igtfAmount: null },
          { amountVes: new Decimal("350000"), igtfAmount: null },
        ],
      })
    ).not.toThrow();
  });

  it("lanza error cuando suma amountVes no coincide", () => {
    expect(() =>
      PaymentBatchService.validateSumInvariant({
        totalAmountVes: new Decimal("500000"),
        totalIgtfAmount: null,
        lines: [{ amountVes: new Decimal("200000"), igtfAmount: null }],
      })
    ).toThrow(/Invariante de suma violada/);
  });

  it("lanza error cuando suma igtfAmount no coincide", () => {
    expect(() =>
      PaymentBatchService.validateSumInvariant({
        totalAmountVes: new Decimal("500000"),
        totalIgtfAmount: new Decimal("15000"),
        lines: [
          { amountVes: new Decimal("150000"), igtfAmount: new Decimal("4500") },
          { amountVes: new Decimal("350000"), igtfAmount: new Decimal("5000") }, // 4500+5000=9500 ≠ 15000
        ],
      })
    ).toThrow(/Invariante IGTF violada/);
  });

  it("no valida IGTF cuando totalIgtfAmount es null", () => {
    expect(() =>
      PaymentBatchService.validateSumInvariant({
        totalAmountVes: new Decimal("500000"),
        totalIgtfAmount: null,
        lines: [
          { amountVes: new Decimal("150000"), igtfAmount: new Decimal("4500") },
          { amountVes: new Decimal("350000"), igtfAmount: new Decimal("5000") },
        ],
      })
    ).not.toThrow();
  });
});

// ─── createBatch ──────────────────────────────────────────────────────────────

describe("PaymentBatchService.createBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx();
  });

  it("happy path — crea batch DRAFT con dos líneas", async () => {
    vi.mocked(prisma.invoice.findFirst)
      .mockResolvedValueOnce({ id: INV_A, paymentStatus: "UNPAID" } as never)
      .mockResolvedValueOnce({ id: INV_B, paymentStatus: "PARTIAL" } as never);
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ isSpecialContributor: false } as never);
    vi.mocked(prisma.paymentBatch.create).mockResolvedValue(BASE_BATCH as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await PaymentBatchService.createBatch({
      companyId: COMPANY_ID,
      method: "TRANSFERENCIA",
      totalAmountVes: new Decimal("500000"),
      date: DATE,
      createdBy: USER_ID,
      idempotencyKey: "idem-key-1",
      lines: [
        { invoiceId: INV_A, amountVes: new Decimal("150000") },
        { invoiceId: INV_B, amountVes: new Decimal("350000") },
      ],
    });

    expect(result.status).toBe("DRAFT");
    expect(result.lines).toHaveLength(2);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "CREATE" }) })
    );
  });

  it("lanza error si líneas vacías", async () => {
    await expect(
      PaymentBatchService.createBatch({
        companyId: COMPANY_ID,
        method: "TRANSFERENCIA",
        totalAmountVes: new Decimal("500000"),
        date: DATE,
        createdBy: USER_ID,
        idempotencyKey: "idem-key-1",
        lines: [],
      })
    ).rejects.toThrow(/al menos una línea/);
  });

  it("lanza error si factura no encontrada o no es A/P (ADR-004 + D-3)", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);

    await expect(
      PaymentBatchService.createBatch({
        companyId: COMPANY_ID,
        method: "TRANSFERENCIA",
        totalAmountVes: new Decimal("150000"),
        date: DATE,
        createdBy: USER_ID,
        idempotencyKey: "idem-key-2",
        lines: [{ invoiceId: "inv-x", amountVes: new Decimal("150000") }],
      })
    ).rejects.toThrow(/no es válida|no encontrada|no es A\/P|no pertenece/);
  });

  it("lanza error si factura está VOIDED", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      id: INV_A,
      paymentStatus: "VOIDED",
    } as never);

    await expect(
      PaymentBatchService.createBatch({
        companyId: COMPANY_ID,
        method: "TRANSFERENCIA",
        totalAmountVes: new Decimal("150000"),
        date: DATE,
        createdBy: USER_ID,
        idempotencyKey: "idem-key-3",
        lines: [{ invoiceId: INV_A, amountVes: new Decimal("150000") }],
      })
    ).rejects.toThrow(/anulada/);
  });

  it("lanza error si factura ya está PAID", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      id: INV_A,
      paymentStatus: "PAID",
    } as never);

    await expect(
      PaymentBatchService.createBatch({
        companyId: COMPANY_ID,
        method: "TRANSFERENCIA",
        totalAmountVes: new Decimal("150000"),
        date: DATE,
        createdBy: USER_ID,
        idempotencyKey: "idem-key-4",
        lines: [{ invoiceId: INV_A, amountVes: new Decimal("150000") }],
      })
    ).rejects.toThrow(/pagada/);
  });
});

// ─── applyBatch ───────────────────────────────────────────────────────────────

describe("PaymentBatchService.applyBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx();
  });

  it("happy path — aplica batch, crea InvoicePayment por línea y cambia estado a APPLIED", async () => {
    vi.mocked(prisma.paymentBatch.findFirst).mockResolvedValue(BASE_BATCH as never);
    vi.mocked(prisma.invoice.findFirst)
      .mockResolvedValueOnce({
        id: INV_A,
        paymentStatus: "UNPAID",
        pendingAmount: new Decimal("150000"),
        totalAmountVes: new Decimal("150000"),
      } as never)
      .mockResolvedValueOnce({
        id: INV_B,
        paymentStatus: "PARTIAL",
        pendingAmount: new Decimal("350000"),
        totalAmountVes: new Decimal("500000"),
      } as never);
    vi.mocked(prisma.invoicePayment.create).mockResolvedValue({} as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(prisma.paymentBatch.update).mockResolvedValue({
      ...BASE_BATCH,
      status: "APPLIED",
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await PaymentBatchService.applyBatch({
      batchId: BATCH_ID,
      companyId: COMPANY_ID,
      userId: USER_ID,
    });

    expect(result.status).toBe("APPLIED");
    expect(prisma.invoicePayment.create).toHaveBeenCalledTimes(2);
    // Verificar idempotencyKey formato (ADR-022 D-2)
    expect(prisma.invoicePayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ idempotencyKey: `batch:${BATCH_ID}:line:line-1` }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "APPLY" }) })
    );
  });

  it("lanza error si batch no encontrado o cross-tenant (ADR-004)", async () => {
    vi.mocked(prisma.paymentBatch.findFirst).mockResolvedValue(null);

    await expect(
      PaymentBatchService.applyBatch({ batchId: BATCH_ID, companyId: COMPANY_ID, userId: USER_ID })
    ).rejects.toThrow(/no encontrado|no pertenece/);
  });

  it("lanza error si batch no está en DRAFT", async () => {
    vi.mocked(prisma.paymentBatch.findFirst).mockResolvedValue({
      ...BASE_BATCH,
      status: "APPLIED",
    } as never);

    await expect(
      PaymentBatchService.applyBatch({ batchId: BATCH_ID, companyId: COMPANY_ID, userId: USER_ID })
    ).rejects.toThrow(/estado actual: APPLIED/);
  });

  it("lanza error si sum invariant falla (ADR-022 D-1)", async () => {
    vi.mocked(prisma.paymentBatch.findFirst).mockResolvedValue({
      ...BASE_BATCH,
      totalAmountVes: new Decimal("999999"), // no coincide con lines sum
    } as never);

    await expect(
      PaymentBatchService.applyBatch({ batchId: BATCH_ID, companyId: COMPANY_ID, userId: USER_ID })
    ).rejects.toThrow(/Invariante de suma violada/);
  });

  it("lanza error si factura no es A/P o cross-tenant durante apply (ADR-022 D-3)", async () => {
    vi.mocked(prisma.paymentBatch.findFirst).mockResolvedValue(BASE_BATCH as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null); // guard falla

    await expect(
      PaymentBatchService.applyBatch({ batchId: BATCH_ID, companyId: COMPANY_ID, userId: USER_ID })
    ).rejects.toThrow(/no es válida|no encontrada|no es A\/P|no pertenece/);
  });

  it("lanza error si monto supera pendingAmount de la factura", async () => {
    vi.mocked(prisma.paymentBatch.findFirst).mockResolvedValue({
      ...BASE_BATCH,
      lines: [{ ...BASE_LINE_A, amountVes: new Decimal("200000") }], // supera pending
      totalAmountVes: new Decimal("200000"),
    } as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      id: INV_A,
      paymentStatus: "PARTIAL",
      pendingAmount: new Decimal("100000"), // menos que 200000
      totalAmountVes: new Decimal("300000"),
    } as never);

    await expect(
      PaymentBatchService.applyBatch({ batchId: BATCH_ID, companyId: COMPANY_ID, userId: USER_ID })
    ).rejects.toThrow(/excede el saldo pendiente/);
  });

  it("actualiza Invoice a PAID cuando newPending es cero", async () => {
    vi.mocked(prisma.paymentBatch.findFirst).mockResolvedValue({
      ...BASE_BATCH,
      lines: [BASE_LINE_A],
      totalAmountVes: new Decimal("150000"),
    } as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      id: INV_A,
      paymentStatus: "UNPAID",
      pendingAmount: new Decimal("150000"),
      totalAmountVes: new Decimal("150000"),
    } as never);
    vi.mocked(prisma.invoicePayment.create).mockResolvedValue({} as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(prisma.paymentBatch.update).mockResolvedValue({
      ...BASE_BATCH,
      status: "APPLIED",
      lines: [BASE_LINE_A],
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await PaymentBatchService.applyBatch({
      batchId: BATCH_ID,
      companyId: COMPANY_ID,
      userId: USER_ID,
    });

    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentStatus: "PAID" }),
      })
    );
  });

  it("actualiza Invoice a PARTIAL cuando newPending > 0", async () => {
    vi.mocked(prisma.paymentBatch.findFirst).mockResolvedValue({
      ...BASE_BATCH,
      lines: [BASE_LINE_A],
      totalAmountVes: new Decimal("150000"),
    } as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      id: INV_A,
      paymentStatus: "UNPAID",
      pendingAmount: new Decimal("300000"), // 300k - 150k = 150k pendiente
      totalAmountVes: new Decimal("300000"),
    } as never);
    vi.mocked(prisma.invoicePayment.create).mockResolvedValue({} as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(prisma.paymentBatch.update).mockResolvedValue({
      ...BASE_BATCH,
      status: "APPLIED",
      lines: [BASE_LINE_A],
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await PaymentBatchService.applyBatch({
      batchId: BATCH_ID,
      companyId: COMPANY_ID,
      userId: USER_ID,
    });

    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentStatus: "PARTIAL" }),
      })
    );
  });

  it("lanza error de concurrencia cuando P2034 persiste tras 3 intentos", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(
      Object.assign(new Error("Serialization failure"), { code: "P2034" })
    );

    await expect(
      PaymentBatchService.applyBatch({ batchId: BATCH_ID, companyId: COMPANY_ID, userId: USER_ID })
    ).rejects.toThrow(/Conflicto de concurrencia/);

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});

// ─── voidBatch ────────────────────────────────────────────────────────────────

describe("PaymentBatchService.voidBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx();
  });

  it("happy path — anula batch APPLIED y revierte InvoicePayments", async () => {
    vi.mocked(prisma.paymentBatch.findFirst).mockResolvedValue({
      ...BASE_BATCH,
      status: "APPLIED",
    } as never);
    vi.mocked(prisma.invoicePayment.findUnique)
      .mockResolvedValueOnce({ id: "ip-1", amount: new Decimal("150000"), invoiceId: INV_A } as never)
      .mockResolvedValueOnce({ id: "ip-2", amount: new Decimal("350000"), invoiceId: INV_B } as never);
    vi.mocked(prisma.invoicePayment.update).mockResolvedValue({} as never);
    vi.mocked(prisma.invoice.findFirst)
      .mockResolvedValueOnce({
        id: INV_A,
        pendingAmount: new Decimal("0"),
        totalAmountVes: new Decimal("150000"),
        paymentStatus: "PAID",
      } as never)
      .mockResolvedValueOnce({
        id: INV_B,
        pendingAmount: new Decimal("150000"),
        totalAmountVes: new Decimal("500000"),
        paymentStatus: "PARTIAL",
      } as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(prisma.paymentBatch.update).mockResolvedValue({
      ...BASE_BATCH,
      status: "VOID",
      lines: [BASE_LINE_A, BASE_LINE_B],
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await PaymentBatchService.voidBatch({
      batchId: BATCH_ID,
      companyId: COMPANY_ID,
      userId: USER_ID,
      voidReason: "Error en referencia bancaria",
    });

    expect(result.status).toBe("VOID");
    expect(prisma.invoicePayment.update).toHaveBeenCalledTimes(2);
    // Soft-delete: deletedAt en InvoicePayment
    expect(prisma.invoicePayment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "VOID" }) })
    );
  });

  it("lanza error si voidReason vacío", async () => {
    await expect(
      PaymentBatchService.voidBatch({
        batchId: BATCH_ID,
        companyId: COMPANY_ID,
        userId: USER_ID,
        voidReason: "   ",
      })
    ).rejects.toThrow(/voidReason/);
  });

  it("lanza error si batch no encontrado o cross-tenant (ADR-004)", async () => {
    vi.mocked(prisma.paymentBatch.findFirst).mockResolvedValue(null);

    await expect(
      PaymentBatchService.voidBatch({
        batchId: BATCH_ID,
        companyId: COMPANY_ID,
        userId: USER_ID,
        voidReason: "Motivo",
      })
    ).rejects.toThrow(/no encontrado|no pertenece/);
  });

  it("lanza error si batch no está en APPLIED", async () => {
    vi.mocked(prisma.paymentBatch.findFirst).mockResolvedValue({
      ...BASE_BATCH,
      status: "DRAFT",
    } as never);

    await expect(
      PaymentBatchService.voidBatch({
        batchId: BATCH_ID,
        companyId: COMPANY_ID,
        userId: USER_ID,
        voidReason: "Motivo",
      })
    ).rejects.toThrow(/Solo se pueden anular lotes APPLIED/);
  });

  it("revierte Invoice a UNPAID cuando newPending >= totalAmountVes", async () => {
    vi.mocked(prisma.paymentBatch.findFirst).mockResolvedValue({
      ...BASE_BATCH,
      status: "APPLIED",
      lines: [BASE_LINE_A],
    } as never);
    vi.mocked(prisma.invoicePayment.findUnique).mockResolvedValue({
      id: "ip-1",
      amount: new Decimal("150000"),
      invoiceId: INV_A,
    } as never);
    vi.mocked(prisma.invoicePayment.update).mockResolvedValue({} as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      id: INV_A,
      pendingAmount: new Decimal("0"),
      totalAmountVes: new Decimal("150000"),
      paymentStatus: "PAID",
    } as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(prisma.paymentBatch.update).mockResolvedValue({
      ...BASE_BATCH,
      status: "VOID",
      lines: [BASE_LINE_A],
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await PaymentBatchService.voidBatch({
      batchId: BATCH_ID,
      companyId: COMPANY_ID,
      userId: USER_ID,
      voidReason: "Reverso prueba",
    });

    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentStatus: "UNPAID" }),
      })
    );
  });

  it("lanza error de concurrencia cuando P2034 persiste tras 3 intentos", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(
      Object.assign(new Error("Serialization failure"), { code: "P2034" })
    );

    await expect(
      PaymentBatchService.voidBatch({
        batchId: BATCH_ID,
        companyId: COMPANY_ID,
        userId: USER_ID,
        voidReason: "Motivo",
      })
    ).rejects.toThrow(/Conflicto de concurrencia/);

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});

// ─── getById ──────────────────────────────────────────────────────────────────

describe("PaymentBatchService.getById", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna batch con líneas si existe y pertenece a la empresa", async () => {
    vi.mocked(prisma.paymentBatch.findFirst).mockResolvedValue(BASE_BATCH as never);
    const result = await PaymentBatchService.getById(BATCH_ID, COMPANY_ID);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(BATCH_ID);
    expect(result?.lines).toHaveLength(2);
  });

  it("retorna null si no encontrado", async () => {
    vi.mocked(prisma.paymentBatch.findFirst).mockResolvedValue(null);
    const result = await PaymentBatchService.getById("nope", COMPANY_ID);
    expect(result).toBeNull();
  });
});
