// src/modules/receivables/__tests__/receivable.actions.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockAuth = vi.hoisted(() => vi.fn().mockResolvedValue({ userId: "user-1" }));

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(null),
  }),
}));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    company: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    // ADR-032 F2: vía canónica — dedupe idempotencia + detección de origen en cancel
    paymentRecord: { findUnique: vi.fn(), findFirst: vi.fn() },
    invoice: { findFirst: vi.fn(), update: vi.fn() },
    companySettings: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi.fn().mockImplementation(
    (_companyId: string, _tx: unknown, fn: (_tx: unknown) => unknown) => fn(_tx),
  ),
}));
vi.mock("../services/ReceivableService", () => ({
  ReceivableService: {
    getReceivables: vi.fn(),
    getPayables: vi.fn(),
    getReceivablesPaginated: vi.fn(),
    getPayablesPaginated: vi.fn(),
    recordPayment: vi.fn(),
    cancelPayment: vi.fn(),
    getPaymentsByInvoice: vi.fn(),
  },
}));
// ADR-032 F2: la action delega en la vía canónica del módulo payments
vi.mock("@/modules/payments/services/PaymentService", () => ({
  PaymentService: {
    create: vi.fn(),
    void: vi.fn(),
    applyPaymentToInvoice: vi.fn(),
    revertPaymentFromInvoice: vi.fn(),
  },
}));
vi.mock("@/modules/payments/services/PaymentGLService", () => ({
  PaymentGLService: {
    postPaymentRecordGL: vi.fn(),
    postVendorPaymentRecordGL: vi.fn(),
    reversePaymentRecordGL: vi.fn(),
  },
}));
vi.mock("@/modules/igtf/services/IGTFService", () => ({
  IGTFService: {
    applies: vi.fn().mockReturnValue(false),
    calculate: vi.fn(),
  },
  IGTF_RATE: new Decimal("0.03"),
}));
vi.mock("../services/AgingReportPDFService", () => ({
  generateAgingReportPDF: vi.fn().mockResolvedValue(Buffer.from("pdf")),
}));

import prisma from "@/lib/prisma";
import { ReceivableService } from "../services/ReceivableService";
import { PaymentService } from "@/modules/payments/services/PaymentService";
import { PaymentGLService } from "@/modules/payments/services/PaymentGLService";
import { checkRateLimit } from "@/lib/ratelimit";
import {
  getReceivablesAction,
  getPayablesAction,
  recordPaymentAction,
  cancelPaymentAction,
  getPaymentsByInvoiceAction,
  updatePaymentTermsAction,
} from "../actions/receivable.actions";
import {
  exportReceivablesAgingPDFAction,
  exportPayablesAgingPDFAction,
} from "../actions/exportAgingReportPDF.actions";

const COMPANY_ID = "co-1";
const ACCOUNTING_MEMBER = { role: "ACCOUNTANT" };
const ADMIN_MEMBER = { role: "ADMIN" };
const VIEWER_MEMBER = { role: "VIEWER" };

const MOCK_AGING: Record<string, unknown> = { buckets: [], totalOverdue: new Decimal(0) };
const MOCK_PAGE = { items: [], nextCursor: null };
const MOCK_PAYMENT = { id: "pay-1", amount: new Decimal("100") };

beforeEach(() => {
  // Limpia counts entre tests (las implementaciones se re-setean abajo).
  // Sin esto, las aserciones not.toHaveBeenCalled() ven llamadas de tests previos.
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: "user-1" });
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTING_MEMBER as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(ReceivableService.getReceivables).mockResolvedValue(MOCK_AGING as never);
  vi.mocked(ReceivableService.getPayables).mockResolvedValue(MOCK_AGING as never);
  vi.mocked(ReceivableService.getReceivablesPaginated).mockResolvedValue(MOCK_PAGE as never);
  vi.mocked(ReceivableService.getPayablesPaginated).mockResolvedValue(MOCK_PAGE as never);
  vi.mocked(ReceivableService.recordPayment).mockResolvedValue(MOCK_PAYMENT as never);
  vi.mocked(ReceivableService.cancelPayment).mockResolvedValue(undefined as never);
  vi.mocked(ReceivableService.getPaymentsByInvoice).mockResolvedValue([MOCK_PAYMENT] as never);
  vi.mocked(prisma.company.findFirst).mockResolvedValue({ isSpecialContributor: false } as never);
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: unknown) => unknown) =>
      fn({
        company: prisma.company,
        auditLog: prisma.auditLog,
        paymentRecord: prisma.paymentRecord,
        invoice: prisma.invoice,
        companySettings: prisma.companySettings,
      })) as never
  );
  vi.mocked(prisma.company.findUnique).mockResolvedValue({ paymentTermDays: 30 } as never);
  vi.mocked(prisma.company.update).mockResolvedValue({ paymentTermDays: 60 } as never);
  // ADR-032 F2: defaults de la vía canónica
  vi.mocked(prisma.paymentRecord.findUnique).mockResolvedValue(null as never); // sin duplicado
  vi.mocked(prisma.paymentRecord.findFirst).mockResolvedValue(null as never); // cancel: legacy por defecto
  vi.mocked(prisma.invoice.findFirst).mockResolvedValue(
    { type: "SALE", igtfBase: new Decimal(0), igtfAmount: new Decimal(0), invoiceNumber: "0001" } as never,
  );
  vi.mocked(prisma.companySettings.findUnique).mockResolvedValue(null as never);
  vi.mocked(PaymentService.applyPaymentToInvoice).mockResolvedValue(
    { newPending: new Decimal(0), newStatus: "PAID" } as never,
  );
  vi.mocked(PaymentService.create).mockResolvedValue(MOCK_PAYMENT as never);
  vi.mocked(PaymentService.void).mockResolvedValue(MOCK_PAYMENT as never);
  vi.mocked(PaymentService.revertPaymentFromInvoice).mockResolvedValue(undefined as never);
});

// ─── getReceivablesAction ─────────────────────────────────────────────────────

describe("getReceivablesAction", () => {
  it("sin sesión → error", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await getReceivablesAction(COMPANY_ID);
    expect(res.success).toBe(false);
  });

  it("no member → error", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);
    const res = await getReceivablesAction(COMPANY_ID);
    expect(res.success).toBe(false);
  });

  it("ACCOUNTANT → success", async () => {
    const res = await getReceivablesAction(COMPANY_ID);
    expect(res.success).toBe(true);
  });

  it("service falla → error con mapPrismaError", async () => {
    vi.mocked(ReceivableService.getReceivables).mockRejectedValue(new Error("db error") as never);
    const res = await getReceivablesAction(COMPANY_ID);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("db error");
  });
});

// ─── getPayablesAction ────────────────────────────────────────────────────────

describe("getPayablesAction", () => {
  it("sin sesión → error", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await getPayablesAction(COMPANY_ID);
    expect(res.success).toBe(false);
  });

  it("ACCOUNTANT → success", async () => {
    const res = await getPayablesAction(COMPANY_ID);
    expect(res.success).toBe(true);
  });
});

// ─── recordPaymentAction ──────────────────────────────────────────────────────

describe("recordPaymentAction", () => {
  const VALID_INPUT = {
    companyId: COMPANY_ID,
    invoiceId: "inv-1",
    amount: "100.00",
    currency: "VES",
    method: "EFECTIVO",
    date: new Date().toISOString(),
    createdBy: "user-1",
    idempotencyKey: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  };

  it("sin sesión → error", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await recordPaymentAction(VALID_INPUT);
    expect(res.success).toBe(false);
  });

  it("datos inválidos (Zod) → error", async () => {
    const res = await recordPaymentAction({});
    expect(res.success).toBe(false);
  });

  it("WRITERS → success (vía canónica ADR-032 F2)", async () => {
    const res = await recordPaymentAction(VALID_INPUT);
    expect(res.success).toBe(true);
    // Ya NO se crea InvoicePayment legacy
    expect(ReceivableService.recordPayment).not.toHaveBeenCalled();
    // Saldo aplicado + PaymentRecord canónico con flag e idempotencia
    expect(PaymentService.applyPaymentToInvoice).toHaveBeenCalledTimes(1);
    expect(PaymentService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        appliedToInvoice: true,
        idempotencyKey: VALID_INPUT.idempotencyKey,
        createdBy: "user-1",
      }),
    );
  });

  it("idempotencyKey duplicada → mensaje de pago duplicado", async () => {
    vi.mocked(prisma.paymentRecord.findUnique).mockResolvedValueOnce({ id: "dup-1" } as never);
    const res = await recordPaymentAction(VALID_INPUT);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("Pago duplicado");
    expect(PaymentService.create).not.toHaveBeenCalled();
  });

  it("error genérico → mapPrismaError", async () => {
    vi.mocked(PaymentService.applyPaymentToInvoice).mockRejectedValueOnce(
      new Error("network issue") as never,
    );
    const res = await recordPaymentAction(VALID_INPUT);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("network issue");
  });

  it("SALE con bankAccountId → asiento COBRO (postPaymentRecordGL)", async () => {
    vi.mocked(prisma.companySettings.findUnique).mockResolvedValueOnce(
      { arAccountId: "acc-ar", apAccountId: "acc-ap", igtfPayableAccountId: null,
        fxGainAccountId: null, fxLossAccountId: null, ivaRetentionReceivableAccountId: null } as never,
    );
    const res = await recordPaymentAction({ ...VALID_INPUT, bankAccountId: "bank-1" });
    expect(res.success).toBe(true);
    expect(PaymentGLService.postPaymentRecordGL).toHaveBeenCalledTimes(1);
    expect(PaymentGLService.postVendorPaymentRecordGL).not.toHaveBeenCalled();
  });

  it("PURCHASE con bankAccountId → asiento PAGO (postVendorPaymentRecordGL — D-5)", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce(
      { type: "PURCHASE", igtfBase: new Decimal(0), igtfAmount: new Decimal(0), invoiceNumber: "0002" } as never,
    );
    vi.mocked(prisma.companySettings.findUnique).mockResolvedValueOnce(
      { arAccountId: "acc-ar", apAccountId: "acc-ap", igtfPayableAccountId: null,
        fxGainAccountId: null, fxLossAccountId: null, ivaRetentionReceivableAccountId: null } as never,
    );
    const res = await recordPaymentAction({ ...VALID_INPUT, bankAccountId: "bank-1" });
    expect(res.success).toBe(true);
    expect(PaymentGLService.postVendorPaymentRecordGL).toHaveBeenCalledTimes(1);
    expect(PaymentGLService.postPaymentRecordGL).not.toHaveBeenCalled();
  });

  it("sin bankAccountId → no postea GL (degradación graceful ADR-030)", async () => {
    const res = await recordPaymentAction(VALID_INPUT);
    expect(res.success).toBe(true);
    expect(PaymentGLService.postPaymentRecordGL).not.toHaveBeenCalled();
    expect(PaymentGLService.postVendorPaymentRecordGL).not.toHaveBeenCalled();
  });
});

// ─── cancelPaymentAction ──────────────────────────────────────────────────────

describe("cancelPaymentAction", () => {
  const VALID_INPUT = { companyId: COMPANY_ID, paymentId: "pay-1" };

  it("ACCOUNTANT (no ADMIN) → error", async () => {
    const res = await cancelPaymentAction(VALID_INPUT);
    expect(res.success).toBe(false);
  });

  it("ADMIN → success (pago legacy → flujo histórico)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    const res = await cancelPaymentAction(VALID_INPUT);
    expect(res.success).toBe(true);
    expect(ReceivableService.cancelPayment).toHaveBeenCalledTimes(1);
    expect(PaymentService.void).not.toHaveBeenCalled();
  });

  it("ADMIN → pago canónico: reverso GL + void + restaura saldo (ADR-032 D-4)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    vi.mocked(prisma.paymentRecord.findFirst).mockResolvedValueOnce(
      { id: "pay-1", deletedAt: null, invoiceId: "inv-1", appliedToInvoice: true,
        amountVes: new Decimal("100") } as never,
    );
    const res = await cancelPaymentAction(VALID_INPUT);
    expect(res.success).toBe(true);
    expect(PaymentGLService.reversePaymentRecordGL).toHaveBeenCalledTimes(1);
    expect(PaymentService.void).toHaveBeenCalledTimes(1);
    expect(PaymentService.revertPaymentFromInvoice).toHaveBeenCalledWith(
      expect.anything(), COMPANY_ID, "inv-1", "pay-1", expect.anything(),
    );
    expect(ReceivableService.cancelPayment).not.toHaveBeenCalled();
  });

  it("pago canónico legacy (appliedToInvoice=false) → NO restaura saldo", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    vi.mocked(prisma.paymentRecord.findFirst).mockResolvedValueOnce(
      { id: "pay-2", deletedAt: null, invoiceId: "inv-1", appliedToInvoice: false,
        amountVes: new Decimal("100") } as never,
    );
    const res = await cancelPaymentAction(VALID_INPUT);
    expect(res.success).toBe(true);
    expect(PaymentService.void).toHaveBeenCalledTimes(1);
    expect(PaymentService.revertPaymentFromInvoice).not.toHaveBeenCalled();
  });
});

// ─── getPaymentsByInvoiceAction ───────────────────────────────────────────────

describe("getPaymentsByInvoiceAction", () => {
  it("sin sesión → error", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await getPaymentsByInvoiceAction("inv-1", COMPANY_ID);
    expect(res.success).toBe(false);
  });

  it("ACCOUNTANT → success", async () => {
    const res = await getPaymentsByInvoiceAction("inv-1", COMPANY_ID);
    expect(res.success).toBe(true);
    if (res.success) expect(Array.isArray(res.data)).toBe(true);
  });
});

// ─── updatePaymentTermsAction ─────────────────────────────────────────────────

describe("updatePaymentTermsAction", () => {
  const VALID_INPUT = { companyId: COMPANY_ID, paymentTermDays: 60 };

  it("ACCOUNTANT (no ADMIN) → error", async () => {
    const res = await updatePaymentTermsAction(VALID_INPUT);
    expect(res.success).toBe(false);
  });

  it("ADMIN → success", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    const res = await updatePaymentTermsAction(VALID_INPUT);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.paymentTermDays).toBe(60);
  });
});

// ─── exportReceivablesAgingPDFAction ─────────────────────────────────────────

describe("exportReceivablesAgingPDFAction", () => {
  beforeEach(() => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ name: "Empresa", rif: "J-12345678-9" } as never);
  });

  it("sin sesión → error", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await exportReceivablesAgingPDFAction(COMPANY_ID);
    expect(res.success).toBe(false);
  });

  it("ACCOUNTANT → success, retorna pdf base64", async () => {
    const res = await exportReceivablesAgingPDFAction(COMPANY_ID);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(typeof res.data.pdf).toBe("string");
      expect(res.data.filename).toContain("CxC");
    }
  });
});

// ─── exportPayablesAgingPDFAction ─────────────────────────────────────────────

describe("exportPayablesAgingPDFAction", () => {
  beforeEach(() => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ name: "Empresa", rif: "J-12345678-9" } as never);
  });

  it("sin sesión → error", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await exportPayablesAgingPDFAction(COMPANY_ID);
    expect(res.success).toBe(false);
  });

  it("ACCOUNTANT → success, retorna pdf base64", async () => {
    const res = await exportPayablesAgingPDFAction(COMPANY_ID);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.filename).toContain("CxP");
  });
});
