// src/modules/invoices/__tests__/invoice.actions.test.ts
// Security regression tests for createInvoiceAction — ADR-006 D-1
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { fiscal: {}, ocr: {} },
}));
vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi.fn().mockImplementation(
    (_companyId: string, _tx: unknown, fn: (_tx: unknown) => unknown) => fn(_tx),
  ),
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    invoice: { findFirst: vi.fn() },
    fiscalYearClose: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/modules/invoices/services/InvoiceService", () => ({
  InvoiceService: { create: vi.fn() },
}));
vi.mock("@/modules/exchange-rates/services/ExchangeRateService", () => ({
  ExchangeRateService: { getRateForDate: vi.fn() },
}));
vi.mock("@/modules/fiscal-close/services/FiscalYearCloseService", () => ({
  FiscalYearCloseService: { isFiscalYearClosed: vi.fn().mockResolvedValue(false) },
}));

import prisma from "@/lib/prisma";
import { InvoiceService } from "@/modules/invoices/services/InvoiceService";
import { createInvoiceAction } from "@/modules/invoices/actions/invoice.actions";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const MEMBER = { userId: USER_ID, companyId: COMPANY_ID, role: "ACCOUNTANT" };

const VALID_INPUT = {
  companyId: COMPANY_ID,
  type: "PURCHASE" as const,
  docType: "FACTURA" as const,
  taxCategory: "GRAVADA" as const,
  invoiceNumber: "B00000001",
  controlNumber: "00-00000001",
  date: "2026-03-10",
  counterpartName: "Proveedor ABC C.A.",
  counterpartRif: "J-12345678-9",
  currency: "VES" as const,
  taxLines: [],
  ivaRetentionAmount: "0",
  islrRetentionAmount: "0",
  igtfBase: "0",
  igtfAmount: "0",
};

// ─── createInvoiceAction — security regression (ADR-006 D-1) ─────────────────
describe("createInvoiceAction — ADR-006 D-1 security regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({ auditLog: prisma.auditLog })) as never,
    );
    vi.mocked(InvoiceService.create).mockResolvedValue({ id: "inv-1" } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("rechaza request sin sesión autenticada", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await createInvoiceAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rechaza VIEWER — no puede crear facturas", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(
      { ...MEMBER, role: "VIEWER" } as never,
    );

    const result = await createInvoiceAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rechaza usuario sin membresía en la empresa", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    const result = await createInvoiceAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("acceso denegado");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("verifica auth ANTES de la consulta de idempotencia", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    await createInvoiceAction({
      ...VALID_INPUT,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440099",
    });

    // La consulta de idempotencia NO debe ejecutarse antes de auth
    expect(prisma.invoice.findFirst).not.toHaveBeenCalled();
  });

  it("ACCOUNTANT puede crear facturas", async () => {
    const result = await createInvoiceAction(VALID_INPUT);
    expect(result.success).toBe(true);
  });
});
