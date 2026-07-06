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
    paymentRecord: { findFirst: vi.fn() }, // H6: pre-check de idempotencia (con companyId)

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
// H-003: tasa BCV autoritativa server-side para pagos en divisa
vi.mock("@/modules/exchange-rates/services/ExchangeRateService", () => ({
  ExchangeRateService: {
    getRateForDate: vi.fn(),
  },
}));
// H-004 (R-3): la fecha del pago debe caer en el período contable abierto
vi.mock("@/modules/accounting/services/PeriodService", () => ({
  PeriodService: {
    assertDateInOpenPeriod: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { createPaymentAction, listPaymentsAction, analyzeReceiptAction } from "../actions/payment.actions";
import { PaymentService } from "../services/PaymentService";
import { ExchangeRateService } from "@/modules/exchange-rates/services/ExchangeRateService";
import { PeriodService } from "@/modules/accounting/services/PeriodService";

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
  idempotencyKey: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",   // H6: obligatoria desde ADR-032 F2
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
        fn({ auditLog: prisma.auditLog, invoice: prisma.invoice, paymentRecord: prisma.paymentRecord })) as never,
    );
    // H6: sin duplicado por defecto — el pre-check de idempotencia pasa
    vi.mocked(prisma.paymentRecord.findFirst).mockResolvedValue(null as never);
    vi.mocked(PaymentService.create).mockResolvedValue(MOCK_PAYMENT as never);
    vi.mocked(PeriodService.assertDateInOpenPeriod).mockResolvedValue({ id: "period-1", year: 2026, month: 3 } as never);
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

// ─── createPaymentAction — H-004: fecha del pago dentro del período abierto ──
// R-3 / Z-3: la FECHA del pago debe caer en el período contable OPEN. Un pago con
// fecha fuera del período (cerrado o inexistente) debe rechazarse SIEMPRE, genere
// asiento o no — consistente con Caja Chica (assertDateInOpenPeriod).
// ─── H6 (ADR-032): idempotencia en la vía individual de pagos ─────────────────
describe("createPaymentAction — H6 idempotencia (Z-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER as never);
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ isSpecialContributor: false } as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({ auditLog: prisma.auditLog, invoice: prisma.invoice, paymentRecord: prisma.paymentRecord })) as never,
    );
    vi.mocked(prisma.paymentRecord.findFirst).mockResolvedValue(null as never);
    vi.mocked(PaymentService.create).mockResolvedValue(MOCK_PAYMENT as never);
    vi.mocked(PeriodService.assertDateInOpenPeriod).mockResolvedValue({ id: "period-1", year: 2026, month: 3 } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
  });

  it("rechaza el input sin idempotencyKey (Zod — obligatoria en la vía canónica)", async () => {
    const { idempotencyKey: _omit, ...withoutKey } = VALID_INPUT;
    const result = await createPaymentAction(withoutKey);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("idempotencia");
    expect(PaymentService.create).not.toHaveBeenCalled();
  });

  it("rechaza una key que no es UUID (security-agent: no contaminar el namespace global)", async () => {
    const result = await createPaymentAction({ ...VALID_INPUT, idempotencyKey: "texto-libre-123" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Clave de idempotencia inválida");
    expect(PaymentService.create).not.toHaveBeenCalled();
  });

  it("reintento con la misma key NO crea un segundo pago (pre-check dentro de la tx)", async () => {
    vi.mocked(prisma.paymentRecord.findFirst).mockResolvedValue({ id: "pay-previo" } as never);

    const result = await createPaymentAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("clave de idempotencia");
    // security-agent LOW: el pre-check filtra por companyId (no es oráculo global)
    expect(prisma.paymentRecord.findFirst).toHaveBeenCalledWith({
      where: { idempotencyKey: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff", companyId: COMPANY_ID },
      select: { id: true },
    });
    expect(PaymentService.create).not.toHaveBeenCalled();
  });

  it("race de dos submits simultáneos: el @unique de BD gana → mensaje de negocio", async () => {
    // Ambos pasan el pre-check (aún no existe fila) pero el segundo insert choca con el unique
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["idempotencyKey"] },
    });
    vi.mocked(PaymentService.create).mockRejectedValue(p2002);

    const result = await createPaymentAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Pago duplicado");
  });

  it("un P2002 de OTRO unique no se disfraza de duplicado de idempotencia", async () => {
    const p2002Other = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["glTransactionId"] },
    });
    vi.mocked(PaymentService.create).mockRejectedValue(p2002Other);

    const result = await createPaymentAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).not.toContain("Pago duplicado");
  });

  it("happy path: la key llega al service para persistirse en PaymentRecord", async () => {
    const result = await createPaymentAction(VALID_INPUT);

    expect(result.success).toBe(true);
    expect(PaymentService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ idempotencyKey: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff" }),
    );
  });
});

describe("createPaymentAction — H-004 fecha en período abierto (R-3, Z-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER as never);
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ isSpecialContributor: false } as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({ auditLog: prisma.auditLog, invoice: prisma.invoice, paymentRecord: prisma.paymentRecord })) as never,
    );
    // H6: sin duplicado por defecto — el pre-check de idempotencia pasa
    vi.mocked(prisma.paymentRecord.findFirst).mockResolvedValue(null as never);
    vi.mocked(PaymentService.create).mockResolvedValue(MOCK_PAYMENT as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(PeriodService.assertDateInOpenPeriod).mockResolvedValue(
      { id: "period-1", year: 2026, month: 3 } as never,
    );
  });

  it("fecha fuera del período abierto → error y NO crea el pago", async () => {
    vi.mocked(PeriodService.assertDateInOpenPeriod).mockRejectedValueOnce(
      new Error(
        "La fecha (01/2024) está fuera del período contable abierto (03/2026). Solo se pueden registrar operaciones del período abierto actual.",
      ),
    );

    const result = await createPaymentAction({ ...VALID_INPUT, date: "2024-01-15" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("fuera del período contable abierto");
    expect(PaymentService.create).not.toHaveBeenCalled();
  });

  it("sin período contable abierto → error y NO crea el pago", async () => {
    vi.mocked(PeriodService.assertDateInOpenPeriod).mockRejectedValueOnce(
      new Error("No hay período contable abierto"),
    );

    const result = await createPaymentAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("No hay período contable abierto");
    expect(PaymentService.create).not.toHaveBeenCalled();
  });

  it("fecha dentro del período abierto → success (valida antes de aplicar)", async () => {
    const result = await createPaymentAction(VALID_INPUT);

    expect(result.success).toBe(true);
    expect(PeriodService.assertDateInOpenPeriod).toHaveBeenCalledTimes(1);
    const [companyArg, dateArg] =
      vi.mocked(PeriodService.assertDateInOpenPeriod).mock.calls[0];
    expect(companyArg).toBe(COMPANY_ID);
    expect((dateArg as Date).toISOString()).toBe("2026-03-10T00:00:00.000Z");
    expect(PaymentService.create).toHaveBeenCalledTimes(1);
  });
});

// ─── createPaymentAction — H-003: amountVes autoritativo server-side ─────────
// Vulnerabilidad (CRÍTICO, Z-2): el campo "Equivalente en Bs.D" (amountVes) es
// editable en la UI. Antes el servidor usaba ese valor tal cual → manipularlo a "1"
// sub-declaraba el IGTF (Art. 4 LGTF). Ahora, para pagos en divisa, amountVes se
// RECALCULA = amountOriginal × tasa BCV oficial y el valor del cliente se ignora.
describe("createPaymentAction — H-003 recálculo amountVes (Z-2, CRÍTICO)", () => {
  const ZELLE_MANIPULATED = {
    companyId: COMPANY_ID,
    method: "ZELLE" as const,
    amountVes: "1",          // ← cliente manipuló el equivalente en Bs (ataque)
    currency: "USD" as const,
    amountOriginal: "50",    // 50 USD reales
    date: "2026-04-03",
    notes: "Pago Zelle prueba",
    idempotencyKey: "0d4a1b8e-4b3c-4a2d-9e1f-2a3b4c5d6e7f", // H6
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER as never);
    // Empresa CE para que aplique IGTF y verifiquemos su base
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ isSpecialContributor: true } as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({ auditLog: prisma.auditLog, invoice: prisma.invoice, paymentRecord: prisma.paymentRecord })) as never,
    );
    // H6: sin duplicado por defecto — el pre-check de idempotencia pasa
    vi.mocked(prisma.paymentRecord.findFirst).mockResolvedValue(null as never);
    vi.mocked(PaymentService.create).mockResolvedValue(MOCK_PAYMENT as never);
    vi.mocked(PeriodService.assertDateInOpenPeriod).mockResolvedValue({ id: "period-1", year: 2026, month: 3 } as never);
    vi.mocked(PaymentService.applyPaymentToInvoice).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(ExchangeRateService.getRateForDate).mockResolvedValue({
      id: "rate-1",
      currency: "USD",
      rate: "600",
      date: new Date("2026-04-03"),
      source: "BCV",
      createdAt: new Date(),
      createdBy: USER_ID,
    } as never);
  });

  it("ignora el amountVes manipulado del cliente y recalcula = amountOriginal × tasa BCV", async () => {
    const result = await createPaymentAction(ZELLE_MANIPULATED);

    expect(result.success).toBe(true);
    // 50 USD × 600 = 30000.00 — NO "1"
    const createArg = vi.mocked(PaymentService.create).mock.calls[0][1];
    expect(createArg.amountVes.toString()).toBe("30000");
    expect(createArg.amountVes.toString()).not.toBe("1");
  });

  it("calcula el IGTF sobre el amountVes autoritativo (30000), no sobre el manipulado (1)", async () => {
    await createPaymentAction(ZELLE_MANIPULATED);

    const createArg = vi.mocked(PaymentService.create).mock.calls[0][1];
    // IGTF 3% de 30000 = 900.00 — jamás 0.03 (3% de 1)
    expect(createArg.igtfAmount).toBeDefined();
    expect(createArg.igtfAmount!.toString()).toBe("900");
  });

  it("consulta la tasa BCV con (companyId, USD, fecha del pago)", async () => {
    await createPaymentAction(ZELLE_MANIPULATED);

    expect(ExchangeRateService.getRateForDate).toHaveBeenCalledTimes(1);
    const [companyArg, currencyArg, dateArg] =
      vi.mocked(ExchangeRateService.getRateForDate).mock.calls[0];
    expect(companyArg).toBe(COMPANY_ID);
    expect(currencyArg).toBe("USD");
    expect((dateArg as Date).toISOString()).toBe("2026-04-03T00:00:00.000Z");
  });

  it("aplica al saldo de la factura el amountVes autoritativo, no el manipulado", async () => {
    await createPaymentAction({ ...ZELLE_MANIPULATED, invoiceId: "inv-1" });

    const amountArg = vi.mocked(PaymentService.applyPaymentToInvoice).mock.calls[0][3];
    expect(amountArg.toString()).toBe("30000");
  });

  it("registra en AuditLog.newValue el amountVes autoritativo (no el manipulado)", async () => {
    await createPaymentAction(ZELLE_MANIPULATED);

    const auditArg = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    const newValue = auditArg.data.newValue as { amountVes: string };
    expect(newValue.amountVes).toBe("30000");
  });

  it("si no hay tasa BCV registrada, retorna error y NO crea el pago", async () => {
    vi.mocked(ExchangeRateService.getRateForDate).mockRejectedValueOnce(
      new Error(
        "No hay tasa BCV registrada para USD el 2026-04-03. Ingrese la tasa antes de registrar la transacción.",
      ),
    );

    const result = await createPaymentAction(ZELLE_MANIPULATED);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("No hay tasa BCV registrada");
    expect(PaymentService.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("pago en VES usa el amountVes tal cual (sin recálculo ni consulta de tasa)", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ isSpecialContributor: false } as never);

    const result = await createPaymentAction(VALID_INPUT); // currency VES, amountVes "1160.00"

    expect(result.success).toBe(true);
    expect(ExchangeRateService.getRateForDate).not.toHaveBeenCalled();
    const createArg = vi.mocked(PaymentService.create).mock.calls[0][1];
    expect(createArg.amountVes.toString()).toBe("1160");
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
    idempotencyKey: "7c9e6679-7425-40de-944b-e07fc1f90ae7",   // H6
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER as never);
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ isSpecialContributor: false } as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({ auditLog: prisma.auditLog, invoice: prisma.invoice, paymentRecord: prisma.paymentRecord })) as never,
    );
    // H6: sin duplicado por defecto — el pre-check de idempotencia pasa
    vi.mocked(prisma.paymentRecord.findFirst).mockResolvedValue(null as never);
    vi.mocked(PaymentService.create).mockResolvedValue(MOCK_PAYMENT as never);
    vi.mocked(PeriodService.assertDateInOpenPeriod).mockResolvedValue({ id: "period-1", year: 2026, month: 3 } as never);
    vi.mocked(PaymentService.applyPaymentToInvoice).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    // H-003: tasa BCV disponible para los pagos en divisa de este bloque
    vi.mocked(ExchangeRateService.getRateForDate).mockResolvedValue({
      id: "rate-1",
      currency: "USD",
      rate: "474.35",
      date: new Date("2026-04-03"),
      source: "BCV",
      createdAt: new Date(),
      createdBy: USER_ID,
    } as never);
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
