// src/modules/payments/__tests__/payment.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { fiscal: {}, read: {}, ocr: {} },
}));
vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi.fn().mockImplementation(
    (_companyId: string, _tx: unknown, fn: (_tx: unknown) => unknown) => fn(_tx),
  ),
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
    invoice: { findUnique: vi.fn(), update: vi.fn() },
    paymentAttachment: { findFirst: vi.fn() },
    companySettings: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../services/PaymentService", () => ({
  PaymentService: {
    create: vi.fn(),
    list: vi.fn(),
    // ADR-032 F1: aplicación/reversa de saldo
    applyPaymentToInvoice: vi.fn(),
    revertPaymentFromInvoice: vi.fn(),
  },
}));
vi.mock("../services/PaymentGLService", () => ({
  PaymentGLService: {
    postPaymentRecordGL: vi.fn(),
    reversePaymentRecordGL: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { createPaymentAction, listPaymentsAction, analyzeReceiptAction } from "../actions/payment.actions";
import { PaymentService } from "../services/PaymentService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const MEMBER = { userId: USER_ID, companyId: COMPANY_ID, role: "ACCOUNTANT" };

const VALID_INPUT = {
  companyId: COMPANY_ID,
  method: "TRANSFERENCIA" as const,
  amountVes: "1160.00",
  currency: "VES" as const,
  date: "2026-03-10",
  referenceNumber: "REF-001",       // TRANSFERENCIA requiere referencia (#2)
  notes: "Concepto de prueba",      // obligatorio desde #12
};

const MOCK_PAYMENT = {
  id: "pay-1",
  companyId: COMPANY_ID,
  method: "TRANSFERENCIA",
  amountVes: { toString: () => "1160.00" },
  currency: "VES",
  date: new Date("2026-03-10"),
  createdAt: new Date(),
};

// ─── createPaymentAction — security regression tests ─────────────────────────
describe("createPaymentAction — security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER as never);
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ isSpecialContributor: false } as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({ auditLog: prisma.auditLog, invoice: prisma.invoice })) as never,
    );
    vi.mocked(PaymentService.create).mockResolvedValue(MOCK_PAYMENT as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
  });

  it("retorna { success: false } si no hay sesión autenticada", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await createPaymentAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("retorna { success: false } si el usuario no es miembro de la empresa", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    const result = await createPaymentAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("acceso denegado");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("retorna { success: false } si el rol es VIEWER", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(
      { ...MEMBER, role: "VIEWER" } as never,
    );

    const result = await createPaymentAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("usa userId autenticado como createdBy (ignora cliente)", async () => {
    await createPaymentAction({ ...VALID_INPUT, createdBy: "attacker-user" });

    expect(PaymentService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ createdBy: USER_ID }),
    );
  });

  it("happy path: crea pago y retorna { success: true }", async () => {
    const result = await createPaymentAction(VALID_INPUT);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe("pay-1");
  });

  it("retorna { success: false } si rate limit está agotado", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      error: "Demasiadas solicitudes. Intenta de nuevo en 30 segundos.",
    });

    const result = await createPaymentAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas solicitudes");
  });

  // ─── ADR-032 F1: aplicación del pago al saldo de la factura ────────────────
  it("con invoiceId aplica el pago al saldo DENTRO de la tx y marca appliedToInvoice", async () => {
    vi.mocked(PaymentService.applyPaymentToInvoice).mockResolvedValue({} as never);

    const result = await createPaymentAction({ ...VALID_INPUT, invoiceId: "inv-1" });

    expect(result.success).toBe(true);
    expect(PaymentService.applyPaymentToInvoice).toHaveBeenCalledTimes(1);
    const [, companyArg, invoiceArg, amountArg] =
      vi.mocked(PaymentService.applyPaymentToInvoice).mock.calls[0];
    expect(companyArg).toBe(COMPANY_ID);
    expect(invoiceArg).toBe("inv-1");
    expect(amountArg.toString()).toBe("1160");
    expect(PaymentService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ appliedToInvoice: true }),
    );
  });

  it("sin invoiceId NO toca el saldo y appliedToInvoice queda false", async () => {
    const result = await createPaymentAction(VALID_INPUT);

    expect(result.success).toBe(true);
    expect(PaymentService.applyPaymentToInvoice).not.toHaveBeenCalled();
    expect(PaymentService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ appliedToInvoice: false }),
    );
  });

  it("si el pago excede el saldo (guard ADR-032), retorna error y NO crea el pago", async () => {
    // Once: evita contaminar describes posteriores (clearAllMocks no resetea implementaciones)
    vi.mocked(PaymentService.applyPaymentToInvoice).mockRejectedValueOnce(
      new Error("El monto del pago excede el saldo pendiente de la factura"),
    );

    const result = await createPaymentAction({ ...VALID_INPUT, invoiceId: "inv-1" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("excede el saldo pendiente");
    expect(PaymentService.create).not.toHaveBeenCalled();
  });
});

// ─── createPaymentAction — IGTF acumulado en Invoice ─────────────────────────
describe("createPaymentAction — IGTF acumulado en Invoice", () => {
  const USD_INPUT = {
    companyId: COMPANY_ID,
    method: "ZELLE" as const,
    amountVes: "857397.00",
    currency: "USD" as const,
    amountOriginal: "1807.42",
    invoiceId: "invoice-1",
    date: "2026-04-03",
    notes: "Pago Zelle prueba",     // obligatorio desde #12
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER as never);
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ isSpecialContributor: false } as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({ auditLog: prisma.auditLog, invoice: prisma.invoice })) as never,
    );
    vi.mocked(PaymentService.create).mockResolvedValue(MOCK_PAYMENT as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
  });

  it("acumula igtfBase/igtfAmount en Invoice SALE cuando pago es en USD y empresa es CE (A5)", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ isSpecialContributor: true } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      type: "SALE", igtfBase: { toString: () => "0" }, igtfAmount: { toString: () => "0" },
    } as never);

    await createPaymentAction(USD_INPUT);

    expect(prisma.invoice.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "invoice-1" } }),
    );
    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "invoice-1" },
        data: expect.objectContaining({
          igtfBase:   expect.anything(),
          igtfAmount: expect.anything(),
        }),
      }),
    );
  });

  it("NO actualiza Invoice si el tipo es PURCHASE", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      type: "PURCHASE", igtfBase: { toString: () => "0" }, igtfAmount: { toString: () => "0" },
    } as never);

    await createPaymentAction(USD_INPUT);

    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("NO actualiza Invoice si el pago es en VES (IGTF no aplica)", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null as never);

    await createPaymentAction({ ...USD_INPUT, currency: "VES", amountOriginal: undefined });

    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("NO actualiza Invoice si no hay invoiceId (pago sin factura vinculada)", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null as never);
    const { invoiceId: _ignored, ...inputWithoutInvoice } = USD_INPUT;

    await createPaymentAction(inputWithoutInvoice);

    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });
});

// ─── listPaymentsAction — IDOR regression tests ───────────────────────────────
describe("listPaymentsAction — IDOR guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER as never);
    vi.mocked(PaymentService.list).mockResolvedValue([MOCK_PAYMENT] as never);
  });

  it("retorna { success: false } si no hay sesión autenticada", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await listPaymentsAction(COMPANY_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
    expect(PaymentService.list).not.toHaveBeenCalled();
  });

  it("retorna { success: false } si rate limit está agotado", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false });

    const result = await listPaymentsAction(COMPANY_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas solicitudes");
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
    expect(PaymentService.list).not.toHaveBeenCalled();
  });

  it("retorna { success: false } si el usuario no es miembro de la empresa (IDOR)", async () => {
    // Simula un usuario autenticado intentando listar pagos de OTRA empresa
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    const result = await listPaymentsAction("otra-empresa-id");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("acceso denegado");
    expect(PaymentService.list).not.toHaveBeenCalled();
  });

  it("permite acceso a VIEWER (operación de solo lectura — guard es de membresía)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(
      { ...MEMBER, role: "VIEWER" } as never,
    );

    const result = await listPaymentsAction(COMPANY_ID);

    // VIEWER es miembro válido — el guard IDOR verifica membresía, no rol de escritura
    expect(result.success).toBe(true);
    expect(PaymentService.list).toHaveBeenCalled();
  });

  it("happy path: retorna lista de pagos para miembro con acceso", async () => {
    const result = await listPaymentsAction(COMPANY_ID);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(1);
    expect(prisma.companyMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: COMPANY_ID, userId: USER_ID }),
      }),
    );
  });
});

// ─── analyzeReceiptAction — ADR-030 D-4 ──────────────────────────────────────
describe("analyzeReceiptAction — seguridad y degradación graceful", () => {
  const ATTACHMENT_ID = "attach-1";
  const MOCK_ATTACHMENT = {
    blobUrl: "https://blob.example.com/receipt.jpg",
    mimeType: "image/jpeg",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER as never);
    vi.mocked(prisma.paymentAttachment.findFirst).mockResolvedValue(MOCK_ATTACHMENT as never);
    // GEMINI_API_KEY no configurado por defecto en tests
    delete process.env.GEMINI_API_KEY;
  });

  it("retorna { success: false } si no hay sesión autenticada", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await analyzeReceiptAction(COMPANY_ID, ATTACHMENT_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna { success: false } si rate limit OCR está agotado", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false });

    const result = await analyzeReceiptAction(COMPANY_ID, ATTACHMENT_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas solicitudes");
  });

  it("retorna { success: false } si el usuario no es miembro (IDOR)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    const result = await analyzeReceiptAction(COMPANY_ID, ATTACHMENT_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("acceso denegado");
  });

  it("retorna { success: false } para rol VIEWER", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(
      { ...MEMBER, role: "VIEWER" } as never,
    );

    const result = await analyzeReceiptAction(COMPANY_ID, ATTACHMENT_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna { success: false } si attachmentId no pertenece a la empresa (ADR-004)", async () => {
    vi.mocked(prisma.paymentAttachment.findFirst).mockResolvedValue(null as never);

    const result = await analyzeReceiptAction(COMPANY_ID, ATTACHMENT_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Comprobante no encontrado");
  });

  it("retorna { success: false } con mensaje amigable si GEMINI_API_KEY no está configurado", async () => {
    delete process.env.GEMINI_API_KEY;

    const result = await analyzeReceiptAction(COMPANY_ID, ATTACHMENT_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("análisis con IA no está disponible");
    }
    // NUNCA exponer detalles técnicos al cliente
    if (!result.success) expect(result.error).not.toContain("GEMINI_API_KEY");
  });
});
