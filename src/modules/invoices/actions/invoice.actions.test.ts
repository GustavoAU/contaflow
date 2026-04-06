// src/modules/invoices/actions/invoice.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createInvoiceAction,
  getInvoiceBookAction,
  exportInvoiceBookPDFAction,
  exportInvoiceVoucherPDFAction,
  getInvoicesPaginatedAction,
} from "./invoice.actions";
import { InvoiceService } from "../services/InvoiceService";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { generateInvoiceBookPDF } from "../services/InvoiceBookPDFService";
import { generateInvoiceVoucherPDF } from "../services/InvoiceVoucherPDFService";
import { ExchangeRateService } from "@/modules/exchange-rates/services/ExchangeRateService";

const TEST_IDEMPOTENCY_KEY = "550e8400-e29b-41d4-a716-446655440000";
const TEST_IDEMPOTENCY_KEY_2 = "660e8400-e29b-41d4-a716-446655440001";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {}, ocr: {} },
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

vi.mock("../services/InvoiceService", () => ({
  InvoiceService: {
    create: vi.fn(),
    getBook: vi.fn(),
    getById: vi.fn(),
    getInvoicesPaginated: vi.fn(),
  },
}));

vi.mock("@/modules/invoices/services/InvoiceBookPDFService", () => ({
  generateInvoiceBookPDF: vi.fn(),
}));

vi.mock("@/modules/invoices/services/InvoiceVoucherPDFService", () => ({
  generateInvoiceVoucherPDF: vi.fn(),
}));

vi.mock("@/modules/exchange-rates/services/ExchangeRateService", () => ({
  ExchangeRateService: {
    getRateForDate: vi.fn(),
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_INPUT = {
  companyId: "company-1",
  type: "SALE",
  docType: "FACTURA",
  taxCategory: "GRAVADA",
  invoiceNumber: "0000001",
  controlNumber: "00-0000001",
  date: "2026-03-01",
  counterpartName: "Cliente Demo C.A.",
  counterpartRif: "J-12345678-9",
  taxLines: [{ taxType: "IVA_GENERAL", base: "1000.00", rate: "16", amount: "160.00" }],
  ivaRetentionAmount: "0",
  islrRetentionAmount: "0",
  igtfBase: "0",
  igtfAmount: "0",
  createdBy: "user-1",
};

const BASE_FILTER = {
  companyId: "company-1",
  type: "SALE",
  year: 2026,
  month: 3,
};

const EMPTY_SUMMARY = {
  totalBaseGeneral: "0.00",
  totalIvaGeneral: "0.00",
  totalBaseReduced: "0.00",
  totalIvaReduced: "0.00",
  totalBaseAdditional: "0.00",
  totalIvaAdditional: "0.00",
  totalExempt: "0.00",
  totalIvaRetention: "0.00",
  totalIslrRetention: "0.00",
  totalIgtf: "0.00",
};

const EMPTY_PAGE = { data: [], nextCursor: null, hasNextPage: false };

const mockCompany = {
  id: "company-1",
  name: "Empresa Test C.A.",
  rif: "J-12345678-9",
  address: null,
  status: "ACTIVE",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockMembership = {
  id: "mem-1",
  userId: "user-1",
  companyId: "company-1",
  role: "ACCOUNTANT",
  company: mockCompany,
};

// ─── createInvoiceAction ──────────────────────────────────────────────────────

describe("createInvoiceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn({ auditLog: prisma.auditLog })) as never);
  });

  it("retorna success true con input válido", async () => {
    vi.mocked(InvoiceService.create).mockResolvedValue({ id: "inv-1" } as never);

    const result = await createInvoiceAction(BASE_INPUT);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("inv-1");
  });

  it("retorna error si falta invoiceNumber", async () => {
    const result = await createInvoiceAction({ ...BASE_INPUT, invoiceNumber: "" });
    expect(result.success).toBe(false);
  });

  it("retorna error si falta counterpartRif", async () => {
    const result = await createInvoiceAction({ ...BASE_INPUT, counterpartRif: "" });
    expect(result.success).toBe(false);
  });

  it("retorna error si falta counterpartName", async () => {
    const result = await createInvoiceAction({ ...BASE_INPUT, counterpartName: "" });
    expect(result.success).toBe(false);
  });

  it("retorna error si el service lanza excepción genérica", async () => {
    vi.mocked(InvoiceService.create).mockRejectedValue(new Error("DB error") as never);

    const result = await createInvoiceAction(BASE_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Error al registrar la factura");
  });

  it("retorna error si el input no es válido", async () => {
    const result = await createInvoiceAction({ invalid: true });
    expect(result.success).toBe(false);
  });

  it("acepta factura con taxLines vacíos", async () => {
    vi.mocked(InvoiceService.create).mockResolvedValue({ id: "inv-2" } as never);

    const result = await createInvoiceAction({ ...BASE_INPUT, taxLines: [] });
    expect(result.success).toBe(true);
  });

  // ── líneas 31-36: fast-path idempotencia ────────────────────────────────────
  it("retorna el id existente sin crear duplicado si idempotencyKey ya existe (líneas 31-36)", async () => {
    // Sobrescribir DESPUÉS del beforeEach — este mock tiene prioridad
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ id: "inv-existente" } as never);

    const result = await createInvoiceAction({
      ...BASE_INPUT,
      idempotencyKey: TEST_IDEMPOTENCY_KEY,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("inv-existente");
    expect(InvoiceService.create).not.toHaveBeenCalled();
    expect(auth).not.toHaveBeenCalled();
  });

  // ── línea 53: guard de ejercicio cerrado ────────────────────────────────────
  it("retorna error si el ejercicio económico está cerrado (línea 53)", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue({ id: "fyc-1" } as never);

    const result = await createInvoiceAction(BASE_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("ejercicio económico");
  });

  // ── líneas 62-77: multimoneda — tasa encontrada ─────────────────────────────
  it("resuelve exchangeRateId automáticamente para facturas en USD (líneas 62-77)", async () => {
    vi.mocked(ExchangeRateService.getRateForDate).mockResolvedValue({
      id: "rate-1",
      rate: "36.50",
    } as never);
    vi.mocked(InvoiceService.create).mockResolvedValue({ id: "inv-usd-1" } as never);

    const result = await createInvoiceAction({
      ...BASE_INPUT,
      currency: "USD",
    });

    expect(result.success).toBe(true);
    expect(ExchangeRateService.getRateForDate).toHaveBeenCalledOnce();
    expect(InvoiceService.create).toHaveBeenCalledWith(
      expect.objectContaining({ exchangeRateId: "rate-1" }),
      expect.anything()
    );
  });

  // ── líneas 62-77: multimoneda — tasa no encontrada ──────────────────────────
  it("retorna error si no hay tasa BCV para la fecha de la factura en USD (líneas 62-77)", async () => {
    vi.mocked(ExchangeRateService.getRateForDate).mockRejectedValue(
      new Error("No existe tasa de cambio para USD en la fecha 2026-03-01") as never
    );

    const result = await createInvoiceAction({
      ...BASE_INPUT,
      currency: "USD",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("No existe tasa de cambio");
  });

  // ── líneas 112-119: P2002 recovery con idempotencyKey ───────────────────────
  it("recupera factura existente tras P2002 en race condition con idempotencyKey (líneas 112-119)", async () => {
    const p2002 = new Error("P2002 Unique constraint failed");
    vi.mocked(InvoiceService.create).mockRejectedValue(p2002 as never);
    // Primera llamada: fast-path no encuentra nada (pasa el guard)
    // Segunda llamada: recovery después del P2002 encuentra la factura
    vi.mocked(prisma.invoice.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "inv-race-winner" } as never);

    const result = await createInvoiceAction({
      ...BASE_INPUT,
      idempotencyKey: TEST_IDEMPOTENCY_KEY_2,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("inv-race-winner");
  });

  // ── línea 125: P2002 sin idempotencyKey → mensaje de negocio ────────────────
  it("retorna mensaje de negocio para P2002 sin idempotencyKey (línea 125)", async () => {
    const p2002 = new Error("P2002 Unique constraint failed");
    vi.mocked(InvoiceService.create).mockRejectedValue(p2002 as never);

    // Sin idempotencyKey en el input
    const result = await createInvoiceAction(BASE_INPUT);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error).toBe("Ya existe una factura con ese número para esta empresa");
  });

  // ── P2003 ────────────────────────────────────────────────────────────────────
  it("retorna mensaje de negocio para P2003 (FK inválida)", async () => {
    const p2003 = new Error("P2003 Foreign key constraint failed");
    vi.mocked(InvoiceService.create).mockRejectedValue(p2003 as never);

    const result = await createInvoiceAction(BASE_INPUT);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error).toBe("Datos de referencia inválidos (empresa o período no existe)");
  });
});

// ─── getInvoiceBookAction ─────────────────────────────────────────────────────

describe("getInvoiceBookAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna success true con filtro válido", async () => {
    vi.mocked(InvoiceService.getBook).mockResolvedValue({
      rows: [],
      summary: EMPTY_SUMMARY,
    } as never);

    const result = await getInvoiceBookAction(BASE_FILTER);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rows).toHaveLength(0);
  });

  it("retorna error si falta companyId", async () => {
    const result = await getInvoiceBookAction({ ...BASE_FILTER, companyId: "" });
    expect(result.success).toBe(false);
  });

  it("retorna error si mes es inválido", async () => {
    const result = await getInvoiceBookAction({ ...BASE_FILTER, month: 13 });
    expect(result.success).toBe(false);
  });

  it("retorna error si año es inválido", async () => {
    const result = await getInvoiceBookAction({ ...BASE_FILTER, year: 1999 });
    expect(result.success).toBe(false);
  });

  it("retorna error si el service lanza excepción", async () => {
    vi.mocked(InvoiceService.getBook).mockRejectedValue(new Error("DB error") as never);

    const result = await getInvoiceBookAction(BASE_FILTER);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Error al obtener el libro");
  });
});

// ─── exportInvoiceBookPDFAction ───────────────────────────────────────────────

describe("exportInvoiceBookPDFAction", () => {
  const validParams = {
    companyId: "company-1",
    type: "SALE" as const,
    year: 2026,
    month: 1,
  };

  beforeEach(() => vi.clearAllMocks());

  it("retorna error si no hay sesión autenticada", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await exportInvoiceBookPDFAction(validParams);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna error si la empresa no pertenece al usuario", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);

    const result = await exportInvoiceBookPDFAction(validParams);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("acceso denegado");
  });

  it("happy path: retorna buffer PDF serializable", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMembership as never);
    vi.mocked(InvoiceService.getBook).mockResolvedValue({
      rows: [],
      summary: EMPTY_SUMMARY,
    } as never);
    vi.mocked(generateInvoiceBookPDF).mockResolvedValue(Buffer.from("fake-pdf"));

    const result = await exportInvoiceBookPDFAction(validParams);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.buffer).toEqual(expect.any(Array));
      expect(result.buffer.length).toBeGreaterThan(0);
    }
    expect(generateInvoiceBookPDF).toHaveBeenCalledOnce();
  });
});

// ─── exportInvoiceVoucherPDFAction ────────────────────────────────────────────

const mockInvoice = {
  id: "inv-1",
  invoiceNumber: "0000001",
  controlNumber: "00-0000001",
  type: "SALE",
  docType: "FACTURA",
  date: new Date("2026-03-01"),
  counterpartName: "Cliente Demo C.A.",
  counterpartRif: "J-12345678-9",
  taxLines: [
    {
      taxType: "IVA_GENERAL",
      base: { toFixed: () => "1000.00" },
      rate: { toFixed: () => "16.00" },
      amount: { toFixed: () => "160.00" },
    },
  ],
  ivaRetentionAmount: { toFixed: () => "0.00" },
  ivaRetentionVoucher: null,
  islrRetentionAmount: { toFixed: () => "0.00" },
  igtfBase: { toFixed: () => "0.00" },
  igtfAmount: { toFixed: () => "0.00" },
  company: {
    name: "Empresa Test C.A.",
    rif: "J-12345678-9",
    address: null,
  },
};

describe("exportInvoiceVoucherPDFAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna error si no hay sesión autenticada", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await exportInvoiceVoucherPDFAction("inv-1", "company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna error si la empresa no pertenece al usuario", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);

    const result = await exportInvoiceVoucherPDFAction("inv-1", "company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("acceso denegado");
  });

  it("retorna error si la factura no existe", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ id: "mem-1" } as never);
    vi.mocked(InvoiceService.getById).mockResolvedValue(null as never);

    const result = await exportInvoiceVoucherPDFAction("inv-inexistente", "company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Factura no encontrada");
  });

  it("happy path: retorna buffer PDF serializable", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ id: "mem-1" } as never);
    vi.mocked(InvoiceService.getById).mockResolvedValue(mockInvoice as never);
    vi.mocked(generateInvoiceVoucherPDF).mockResolvedValue(Buffer.from("fake-voucher-pdf"));

    const result = await exportInvoiceVoucherPDFAction("inv-1", "company-1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.buffer).toEqual(expect.any(Array));
      expect(result.buffer.length).toBeGreaterThan(0);
    }
    expect(generateInvoiceVoucherPDF).toHaveBeenCalledOnce();
  });

  it("retorna error genérico si generateInvoiceVoucherPDF lanza excepción", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ id: "mem-1" } as never);
    vi.mocked(InvoiceService.getById).mockResolvedValue(mockInvoice as never);
    vi.mocked(generateInvoiceVoucherPDF).mockRejectedValue(new Error("render failed") as never);

    const result = await exportInvoiceVoucherPDFAction("inv-1", "company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Error al generar PDF de factura");
  });
});

// ─── getInvoicesPaginatedAction ───────────────────────────────────────────────

describe("getInvoicesPaginatedAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
  });

  it("retorna error si no hay sesión autenticada", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await getInvoicesPaginatedAction("company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna error si la empresa no pertenece al usuario", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);

    const result = await getInvoicesPaginatedAction("company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("acceso denegado");
  });

  it("happy path: retorna página con facturas", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(InvoiceService.getInvoicesPaginated).mockResolvedValue(EMPTY_PAGE as never);

    const result = await getInvoicesPaginatedAction("company-1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data).toHaveLength(0);
      expect(result.data.hasNextPage).toBe(false);
      expect(result.data.nextCursor).toBeNull();
    }
  });

  it("pasa filtros y cursor al service", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(InvoiceService.getInvoicesPaginated).mockResolvedValue(EMPTY_PAGE as never);

    const filters = { type: "SALE" as const, search: "Demo" };
    await getInvoicesPaginatedAction("company-1", filters, "cursor-abc", 25);

    expect(InvoiceService.getInvoicesPaginated).toHaveBeenCalledWith(
      "company-1",
      filters,
      "cursor-abc",
      25
    );
  });

  // ── línea 156: catch genérico ────────────────────────────────────────────────
  it("retorna el mensaje de la excepción si el service lanza un Error (línea 156)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(InvoiceService.getInvoicesPaginated).mockRejectedValue(
      new Error("DB error") as never
    );

    const result = await getInvoicesPaginatedAction("company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("DB error");
  });

  it("retorna mensaje genérico si se lanza un valor no-Error (línea 156)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(InvoiceService.getInvoicesPaginated).mockRejectedValue("string error" as never);

    const result = await getInvoicesPaginatedAction("company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Error al obtener las facturas");
  });
});
