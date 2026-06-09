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
    $transaction: vi.fn(),
  },
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
      })) as never
  );
  vi.mocked(prisma.company.findUnique).mockResolvedValue({ paymentTermDays: 30 } as never);
  vi.mocked(prisma.company.update).mockResolvedValue({ paymentTermDays: 60 } as never);
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

  it("WRITERS → success", async () => {
    const res = await recordPaymentAction(VALID_INPUT);
    expect(res.success).toBe(true);
  });

  it("P2002 → mensaje de pago duplicado", async () => {
    vi.mocked(ReceivableService.recordPayment).mockRejectedValue(
      new Error("Unique constraint failed on the fields: P2002") as never
    );
    const res = await recordPaymentAction(VALID_INPUT);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("Pago duplicado");
  });

  it("error genérico → mapPrismaError", async () => {
    vi.mocked(ReceivableService.recordPayment).mockRejectedValue(new Error("network issue") as never);
    const res = await recordPaymentAction(VALID_INPUT);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("network issue");
  });
});

// ─── cancelPaymentAction ──────────────────────────────────────────────────────

describe("cancelPaymentAction", () => {
  const VALID_INPUT = { companyId: COMPANY_ID, paymentId: "pay-1" };

  it("ACCOUNTANT (no ADMIN) → error", async () => {
    const res = await cancelPaymentAction(VALID_INPUT);
    expect(res.success).toBe(false);
  });

  it("ADMIN → success", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    const res = await cancelPaymentAction(VALID_INPUT);
    expect(res.success).toBe(true);
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
