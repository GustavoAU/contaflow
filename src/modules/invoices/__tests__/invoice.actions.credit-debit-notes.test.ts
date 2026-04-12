// src/modules/invoices/__tests__/invoice.actions.credit-debit-notes.test.ts
// TDD RED phase — Fase 23C NC/ND Workflow — Action tests
// These tests import actions that do NOT exist yet → all tests will FAIL (RED)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { fiscal: {}, ocr: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findUnique: vi.fn() },
    invoice: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi.fn().mockImplementation(
    (_companyId: string, _tx: unknown, fn: (_tx: unknown) => unknown) => fn(_tx),
  ),
}));
vi.mock("@/modules/invoices/services/InvoiceService", () => ({
  InvoiceService: {
    create: vi.fn(),
    createCreditNote: vi.fn(),
    createDebitNote: vi.fn(),
  },
}));
vi.mock("@/modules/fiscal-close/services/FiscalYearCloseService", () => ({
  FiscalYearCloseService: {
    isFiscalYearClosed: vi.fn().mockResolvedValue(false),
  },
}));

// ─── Imports (actions don't exist yet — will cause RED) ──────────────────────
import prisma from "@/lib/prisma";
import { InvoiceService } from "@/modules/invoices/services/InvoiceService";
import {
  createCreditNoteAction,
  createDebitNoteAction,
} from "@/modules/invoices/actions/invoice.actions";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const MEMBER_ACCOUNTANT = { userId: USER_ID, companyId: COMPANY_ID, role: "ACCOUNTANT" };
const MEMBER_VIEWER = { userId: USER_ID, companyId: COMPANY_ID, role: "VIEWER" };

const VALID_NC_INPUT = {
  companyId: COMPANY_ID,
  relatedInvoiceId: "inv-original",
  type: "SALE" as const,
  docType: "NOTA_CREDITO" as const,
  taxCategory: "GRAVADA" as const,
  invoiceNumber: "NC-0000001",
  date: "2026-04-10",
  counterpartName: "Cliente ABC",
  counterpartRif: "J-12345678-9",
  currency: "VES" as const,
  taxLines: [
    { taxType: "IVA_GENERAL" as const, base: "862.07", rate: "16", amount: "137.93" },
  ],
  ivaRetentionAmount: "0",
  islrRetentionAmount: "0",
  igtfBase: "0",
  igtfAmount: "0",
};

const VALID_ND_INPUT = {
  companyId: COMPANY_ID,
  relatedInvoiceId: "inv-original",
  type: "SALE" as const,
  docType: "NOTA_DEBITO" as const,
  taxCategory: "GRAVADA" as const,
  invoiceNumber: "ND-0000001",
  date: "2026-04-10",
  counterpartName: "Cliente ABC",
  counterpartRif: "J-12345678-9",
  currency: "VES" as const,
  taxLines: [
    { taxType: "IVA_GENERAL" as const, base: "172.41", rate: "16", amount: "27.59" },
  ],
  ivaRetentionAmount: "0",
  islrRetentionAmount: "0",
  igtfBase: "0",
  igtfAmount: "0",
};

const mockNcResult = {
  id: "nc-1",
  docType: "NOTA_CREDITO",
  invoiceNumber: "NC-0000001",
  companyId: COMPANY_ID,
  totalAmountVes: new Decimal("1000"),
};

const mockNdResult = {
  id: "nd-1",
  docType: "NOTA_DEBITO",
  invoiceNumber: "ND-0000001",
  companyId: COMPANY_ID,
  totalAmountVes: new Decimal("200"),
};

// ─── createCreditNoteAction tests ─────────────────────────────────────────────
describe("createCreditNoteAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(
      MEMBER_ACCOUNTANT as never,
    );
    vi.mocked(InvoiceService.createCreditNote).mockResolvedValue(
      mockNcResult as never,
    );
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
  });

  // ── Test 1: rejects unauthenticated ──────────────────────────────────────
  it("rechaza solicitud sin sesión autenticada", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await createCreditNoteAction(VALID_NC_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(prisma.companyMember.findUnique).not.toHaveBeenCalled();
  });

  // ── Test 2: rejects rate limited ─────────────────────────────────────────
  it("rechaza cuando rate limit está excedido", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false });

    const result = await createCreditNoteAction(VALID_NC_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/límite|rate|limite/i);
  });

  // ── Test 3: rejects invalid schema (missing relatedInvoiceId) ─────────────
  it("rechaza input sin relatedInvoiceId (validación de schema)", async () => {
    const invalidInput = { ...VALID_NC_INPUT };
    // @ts-expect-error intentionally testing invalid input
    delete invalidInput.relatedInvoiceId;

    const result = await createCreditNoteAction(invalidInput);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error).toMatch(/relatedInvoiceId|factura original/i);
  });

  // ── Test 4: rejects VIEWER role ──────────────────────────────────────────
  it("rechaza usuario con rol VIEWER", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(
      MEMBER_VIEWER as never,
    );

    const result = await createCreditNoteAction(VALID_NC_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(InvoiceService.createCreditNote).not.toHaveBeenCalled();
  });

  // ── Test 5: happy path calls service and returns success ─────────────────
  it("llama al servicio y retorna success en happy path", async () => {
    const result = await createCreditNoteAction(VALID_NC_INPUT);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeDefined();
      expect(result.data.id).toBe("nc-1");
    }
    expect(InvoiceService.createCreditNote).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ relatedInvoiceId: "inv-original" }),
      USER_ID,
    );
  });

  // ── Test 6: strips relatedDocNumber from input (MEDIUM security finding) ──
  it("elimina relatedDocNumber del input del cliente antes de llamar al servicio", async () => {
    const inputWithRelatedDocNumber = {
      ...VALID_NC_INPUT,
      relatedDocNumber: "INJECTED-DOC-NUMBER", // client trying to inject
    };

    await createCreditNoteAction(inputWithRelatedDocNumber);

    // relatedDocNumber must NOT be passed to the service
    expect(InvoiceService.createCreditNote).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.not.objectContaining({ relatedDocNumber: "INJECTED-DOC-NUMBER" }),
      USER_ID,
    );
  });
});

// ─── createDebitNoteAction tests ──────────────────────────────────────────────
describe("createDebitNoteAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(
      MEMBER_ACCOUNTANT as never,
    );
    vi.mocked(InvoiceService.createDebitNote).mockResolvedValue(
      mockNdResult as never,
    );
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
  });

  // ── Test 7: rejects VIEWER role ──────────────────────────────────────────
  it("rechaza usuario con rol VIEWER", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(
      MEMBER_VIEWER as never,
    );

    const result = await createDebitNoteAction(VALID_ND_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(InvoiceService.createDebitNote).not.toHaveBeenCalled();
  });

  // ── Test 8: happy path ────────────────────────────────────────────────────
  it("llama al servicio y retorna success en happy path", async () => {
    const result = await createDebitNoteAction(VALID_ND_INPUT);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeDefined();
      expect(result.data.id).toBe("nd-1");
    }
    expect(InvoiceService.createDebitNote).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ relatedInvoiceId: "inv-original" }),
      USER_ID,
    );
  });
});
