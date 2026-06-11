// src/modules/receivables/__tests__/ReceivableService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    invoicePayment: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    // ADR-032 F2: getPaymentsByInvoice une legacy + PaymentRecord canónico
    paymentRecord: {
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/modules/fiscal-close/services/FiscalYearCloseService", () => ({
  FiscalYearCloseService: {
    isFiscalYearClosed: vi.fn().mockResolvedValue(false),
  },
}));

import { prisma } from "@/lib/prisma";
import { ReceivableService, classifyAgingBucket } from "../services/ReceivableService";
import { FiscalYearCloseService } from "@/modules/fiscal-close/services/FiscalYearCloseService";

const COMPANY_ID = "company-1";
const INVOICE_ID = "invoice-1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInvoiceRow(overrides = {}) {
  return {
    id: INVOICE_ID,
    invoiceNumber: "0000001",
    controlNumber: "00-0000001",
    docType: "FACTURA",
    counterpartName: "Cliente Demo C.A.",
    counterpartRif: "J-12345678-9",
    relatedDocNumber: null,
    date: new Date("2026-01-01"),
    dueDate: new Date("2026-01-31"),
    currency: "VES",
    totalAmountVes: new Decimal("1160.00"),
    pendingAmount: new Decimal("1160.00"),
    paymentStatus: "UNPAID",
    invoicePayments: [],
    ...overrides,
  };
}

function setupTxMock() {
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: unknown) => unknown) =>
      fn({
        invoice: prisma.invoice,
        invoicePayment: prisma.invoicePayment,
        auditLog: prisma.auditLog,
      })) as never
  );
}

// ─── classifyAgingBucket — pure function ─────────────────────────────────────

describe("classifyAgingBucket", () => {
  const asOf = new Date("2026-04-01");

  it("retorna CURRENT cuando daysOverdue <= 30 (factura de hoy)", () => {
    const dueDate = new Date("2026-04-01");
    expect(classifyAgingBucket(dueDate, dueDate, asOf)).toBe("CURRENT");
  });

  it("retorna CURRENT cuando dueDate es en el futuro", () => {
    const dueDate = new Date("2026-04-15");
    expect(classifyAgingBucket(dueDate, dueDate, asOf)).toBe("CURRENT");
  });

  it("retorna CURRENT cuando vencida hace exactamente 30 días", () => {
    const dueDate = new Date("2026-03-02");
    expect(classifyAgingBucket(dueDate, dueDate, asOf)).toBe("CURRENT");
  });

  it("retorna OVERDUE_31_60 cuando vencida hace 31 días", () => {
    const dueDate = new Date("2026-03-01");
    expect(classifyAgingBucket(dueDate, dueDate, asOf)).toBe("OVERDUE_31_60");
  });

  it("retorna OVERDUE_31_60 cuando vencida hace 60 días", () => {
    const dueDate = new Date("2026-01-31");
    expect(classifyAgingBucket(dueDate, dueDate, asOf)).toBe("OVERDUE_31_60");
  });

  it("retorna OVERDUE_61_90 cuando vencida hace 61 días", () => {
    const dueDate = new Date("2026-01-30");
    expect(classifyAgingBucket(dueDate, dueDate, asOf)).toBe("OVERDUE_61_90");
  });

  it("retorna OVERDUE_91_120 cuando vencida hace 91 días", () => {
    const dueDate = new Date("2025-12-31");
    expect(classifyAgingBucket(dueDate, dueDate, asOf)).toBe("OVERDUE_91_120");
  });

  it("retorna OVERDUE_120_PLUS cuando vencida hace 121 días", () => {
    const dueDate = new Date("2025-12-01");
    expect(classifyAgingBucket(dueDate, dueDate, asOf)).toBe("OVERDUE_120_PLUS");
  });

  it("usa invoiceDate como fallback cuando dueDate es null", () => {
    const invoiceDate = new Date("2025-12-01");
    expect(classifyAgingBucket(null, invoiceDate, asOf)).toBe("OVERDUE_120_PLUS");
  });
});

// ─── getReceivables ───────────────────────────────────────────────────────────

describe("ReceivableService.getReceivables", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna reporte vacío cuando no hay facturas pendientes", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    const report = await ReceivableService.getReceivables(COMPANY_ID);

    expect(report.type).toBe("CXC");
    expect(report.rows).toHaveLength(0);
    expect(report.grandTotalPendingVes).toBe("0.00");
  });

  it("filtra solo type=SALE con paymentStatus != PAID", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await ReceivableService.getReceivables(COMPANY_ID);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: "SALE",
          paymentStatus: { not: "PAID" },
          deletedAt: null,
        }),
      })
    );
  });

  it("excluye REPORTE_Z y RESUMEN_VENTAS del aging", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await ReceivableService.getReceivables(COMPANY_ID);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          docType: { in: ["FACTURA", "NOTA_DEBITO", "NOTA_CREDITO"] },
        }),
      })
    );
  });

  it("clasifica correctamente en buckets y calcula totales", async () => {
    const asOf = new Date("2026-04-01");
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      makeInvoiceRow({
        dueDate: new Date("2026-03-01"), // 31 días → OVERDUE_31_60
        invoicePayments: [],
      }),
    ] as never);

    const report = await ReceivableService.getReceivables(COMPANY_ID, asOf);

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].bucket).toBe("OVERDUE_31_60");
    expect(report.grandTotalPendingVes).toBe("1160.00");
    expect(report.grandTotalOverdueVes).toBe("1160.00");
    expect(report.grandTotalCurrentVes).toBe("0.00");
  });

  it("netea NOTA_CREDITO contra factura original via relatedDocNumber", async () => {
    const asOf = new Date("2026-04-01");
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      // Factura de deuda
      makeInvoiceRow({
        invoiceNumber: "0000001",
        dueDate: new Date("2026-04-15"), // corriente
        totalAmountVes: new Decimal("1160.00"),
        pendingAmount: new Decimal("1160.00"),
        invoicePayments: [],
      }),
      // Nota de crédito que reduce la factura anterior
      {
        id: "nc-1",
        invoiceNumber: "NC-0000001",
        controlNumber: null,
        docType: "NOTA_CREDITO",
        counterpartName: "Cliente Demo C.A.",
        counterpartRif: "J-12345678-9",
        relatedDocNumber: "0000001",
        date: new Date("2026-04-10"),
        dueDate: null,
        currency: "VES",
        totalAmountVes: new Decimal("580.00"),
        pendingAmount: new Decimal("580.00"),
        paymentStatus: "UNPAID",
        invoicePayments: [],
      },
    ] as never);

    const report = await ReceivableService.getReceivables(COMPANY_ID, asOf);

    // Solo la factura aparece en rows (NC no es deuda)
    expect(report.rows).toHaveLength(1);
    // El pending debe estar neteado: 1160 - 580 = 580
    expect(report.rows[0].pendingAmountVes).toBe("580.00");
    expect(report.grandTotalPendingVes).toBe("580.00");
  });
});

// ─── getPayables ──────────────────────────────────────────────────────────────

describe("ReceivableService.getPayables", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filtra solo type=PURCHASE", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    const report = await ReceivableService.getPayables(COMPANY_ID);

    expect(report.type).toBe("CXP");
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "PURCHASE" }),
      })
    );
  });
});

// ─── recordPayment ────────────────────────────────────────────────────────────
// ADR-032 F3: InvoicePayment writes congelados — solo se verifica que lanza.

describe("ReceivableService.recordPayment", () => {
  it("lanza error inmediatamente (ADR-032 F3: escrituras congeladas)", async () => {
    await expect(
      ReceivableService.recordPayment({
        companyId: COMPANY_ID,
        invoiceId: INVOICE_ID,
        amount: "500.00",
        currency: "VES",
        method: "TRANSFERENCIA",
        date: new Date("2026-04-01"),
        createdBy: "user-1",
        idempotencyKey: "key-abc-123",
      })
    ).rejects.toThrow("ADR-032 F3");
  });
});

// ─── cancelPayment ────────────────────────────────────────────────────────────

describe("ReceivableService.cancelPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(FiscalYearCloseService.isFiscalYearClosed).mockResolvedValue(false);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          invoicePayment: prisma.invoicePayment,
          invoice: prisma.invoice,
          auditLog: prisma.auditLog,
        })) as never
    );
  });

  it("hace soft delete del pago y revierte pendingAmount", async () => {
    vi.mocked(prisma.invoicePayment.findFirst).mockResolvedValue({
      id: "payment-1",
      invoiceId: INVOICE_ID,
      companyId: COMPANY_ID,
      amount: new Decimal("500.00"),
      method: "TRANSFERENCIA",
      date: new Date("2026-04-01"),
      deletedAt: null,
      invoice: {
        date: new Date("2026-01-01"),
        pendingAmount: new Decimal("660.00"),
        paymentStatus: "PARTIAL",
      },
    } as never);
    vi.mocked(prisma.invoicePayment.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.invoicePayment.update).mockResolvedValue({} as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await ReceivableService.cancelPayment("payment-1", COMPANY_ID, "user-1");

    // Con 0 pagos restantes → UNPAID
    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentStatus: "UNPAID",
          pendingAmount: expect.any(Decimal),
        }),
      })
    );
    expect(prisma.invoicePayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    );
  });

  it("lanza error si el año fiscal está cerrado", async () => {
    vi.mocked(FiscalYearCloseService.isFiscalYearClosed).mockResolvedValue(true);
    vi.mocked(prisma.invoicePayment.findFirst).mockResolvedValue({
      id: "payment-1",
      invoiceId: INVOICE_ID,
      companyId: COMPANY_ID,
      amount: new Decimal("500.00"),
      method: "TRANSFERENCIA",
      date: new Date("2026-04-01"),
      deletedAt: null,
      invoice: {
        date: new Date("2025-06-01"),
        pendingAmount: new Decimal("660.00"),
        paymentStatus: "PARTIAL",
      },
    } as never);

    await expect(
      ReceivableService.cancelPayment("payment-1", COMPANY_ID, "user-1")
    ).rejects.toThrow("El ejercicio económico 2025 está cerrado");
  });
});

// ─── getPaymentsByInvoice ─────────────────────────────────────────────────────

describe("ReceivableService.getPaymentsByInvoice", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna pagos activos ordenados por fecha", async () => {
    vi.mocked(prisma.invoicePayment.findMany).mockResolvedValue([
      {
        id: "p-1",
        invoiceId: INVOICE_ID,
        amount: new Decimal("300.00"),
        currency: "VES",
        amountOriginal: null,
        method: "TRANSFERENCIA",
        referenceNumber: null,
        igtfAmount: null,
        date: new Date("2026-02-01"),
        notes: null,
        createdBy: "user-1",
        createdAt: new Date("2026-02-01"),
        idempotencyKey: "key-1",
      },
    ] as never);
    vi.mocked(prisma.paymentRecord.findMany).mockResolvedValue([] as never);

    const payments = await ReceivableService.getPaymentsByInvoice(INVOICE_ID, COMPANY_ID);

    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(new Decimal("300.00").toString());
    expect(payments[0].source).toBe("legacy");
    expect(prisma.invoicePayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ invoiceId: INVOICE_ID, deletedAt: null }),
        orderBy: { date: "asc" },
      })
    );
  });

  // ADR-032 F2: unión legacy + canónico ordenada por fecha
  it("une InvoicePayment legacy + PaymentRecord canónico ordenados por fecha", async () => {
    vi.mocked(prisma.invoicePayment.findMany).mockResolvedValue([
      {
        id: "p-legacy",
        invoiceId: INVOICE_ID,
        amount: new Decimal("300.00"),
        currency: "VES",
        amountOriginal: null,
        method: "TRANSFERENCIA",
        referenceNumber: null,
        igtfAmount: null,
        date: new Date("2026-02-05"),
        notes: null,
        createdBy: "user-1",
        createdAt: new Date("2026-02-05"),
        idempotencyKey: "key-1",
      },
    ] as never);
    vi.mocked(prisma.paymentRecord.findMany).mockResolvedValue([
      {
        id: "p-canonical",
        invoiceId: INVOICE_ID,
        amountVes: new Decimal("700.00"),
        currency: "VES",
        amountOriginal: null,
        method: "PAGOMOVIL",
        referenceNumber: "REF-9",
        igtfAmount: null,
        date: new Date("2026-02-01"),
        notes: null,
        createdBy: "user-1",
        createdAt: new Date("2026-02-01"),
        idempotencyKey: "key-2",
      },
    ] as never);

    const payments = await ReceivableService.getPaymentsByInvoice(INVOICE_ID, COMPANY_ID);

    expect(payments).toHaveLength(2);
    // Ordenado por fecha: el canónico (02-01) antes que el legacy (02-05)
    expect(payments[0].id).toBe("p-canonical");
    expect(payments[0].source).toBe("canonical");
    expect(payments[0].amount).toBe("700");
    expect(payments[1].id).toBe("p-legacy");
    expect(payments[1].source).toBe("legacy");
  });
});
