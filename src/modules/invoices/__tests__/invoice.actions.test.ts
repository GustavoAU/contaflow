// src/modules/invoices/__tests__/invoice.actions.test.ts
// Security regression tests for createInvoiceAction — ADR-006 D-1
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
  fiscalKey: vi.fn((companyId: string, userId: string) => `${companyId}:${userId}`),
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
    rolePermission: { findFirst: vi.fn() },
    invoice: { findFirst: vi.fn() },
    fiscalYearClose: { findUnique: vi.fn() },
    controlNumberSequence: { upsert: vi.fn() },
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
import { Prisma } from "@prisma/client";
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
    vi.mocked(prisma.rolePermission.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({ auditLog: prisma.auditLog })) as never,
    );
    vi.mocked(InvoiceService.create).mockResolvedValue({ id: "inv-1", stockWarnings: [] } as never);
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
    // VIEWER sin grant explícito → hasModuleAccess retorna false (ADR-025)
    vi.mocked(prisma.rolePermission.findFirst).mockResolvedValue(null as never);

    const result = await createInvoiceAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Facturación");
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

// ─── createInvoiceAction — P2002 por target (Z-1) ─────────────────────────────
//
// Call-site: `p2002TargetIncludes(error, "controlNumber")` acotado a type === "SALE".
// Aquí se fija QUÉ target activa el mensaje transitorio del Nº Control y cuál no.
//
// Errores construidos como INSTANCIAS REALES de PrismaClientKnownRequestError:
// el guard es `isPrismaError` → `instanceof`. Un objeto con forma de pato no
// entra en NINGUNA de estas ramas (última prueba del bloque).
describe("createInvoiceAction — P2002 por target (Z-1 Nº Control / idempotencia)", () => {
  const MSG_TRANSITORIO = "Error transitorio al generar Nº Control — intenta de nuevo.";
  const MSG_DUP_NUMERO = "Ya existe una factura con ese número para esta empresa";

  const SALE_INPUT = { ...VALID_INPUT, type: "SALE" as const, controlNumber: undefined };

  const p2002 = (target?: unknown) =>
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields", {
      code: "P2002",
      clientVersion: "7.4.1",
      meta: target === undefined ? {} : { target },
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER as never);
    vi.mocked(prisma.rolePermission.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.controlNumberSequence.upsert).mockResolvedValue({ lastNumber: 7 } as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({ auditLog: prisma.auditLog, controlNumberSequence: prisma.controlNumberSequence })) as never,
    );
    vi.mocked(InvoiceService.create).mockResolvedValue({ id: "inv-1", stockWarnings: [] } as never);
  });

  async function errorFor(input: unknown): Promise<string> {
    const result = await createInvoiceAction(input);
    expect(result.success).toBe(false);
    return result.success ? "__NO_FALLO__" : result.error;
  }

  it("SALE: un target FICTICIO ['controlNumber'] ya NO dispara el mensaje transitorio", async () => {
    // `controlNumber` no es columna de ningún índice único — verificado en
    // schema.prisma y en todas las migraciones. La condición que lo miraba era
    // rama muerta. Este test fija que el target inventado no vuelva a colarse:
    // el único choque real de correlativo es ['companyId','invoiceType'].
    vi.mocked(prisma.controlNumberSequence.upsert).mockRejectedValue(p2002(["controlNumber"]));

    expect(await errorFor(SALE_INPUT)).not.toBe(MSG_TRANSITORIO);
  });

  it("PURCHASE: el MISMO P2002 no da el mensaje del Nº Control (la rama es sólo de SALE)", async () => {
    // Una compra no reserva correlativo: mandar al usuario a "reintentar por el
    // Nº Control" sería mentirle sobre la causa.
    vi.mocked(InvoiceService.create).mockRejectedValue(p2002(["controlNumber"]));

    const error = await errorFor({ ...VALID_INPUT, type: "PURCHASE" as const });
    expect(error).not.toBe(MSG_TRANSITORIO);
    expect(error).toBe(MSG_DUP_NUMERO);
  });

  it("SALE: P2002 de idempotencyKey NO cae en la rama del Nº Control — resuelve la carrera", async () => {
    vi.mocked(InvoiceService.create).mockRejectedValue(p2002(["companyId", "idempotencyKey"]));
    // 1ª llamada = pre-check de idempotencia (aún no existe); 2ª = lookup del catch,
    // donde ya ganó el request rival.
    vi.mocked(prisma.invoice.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: "inv-rival" } as never);

    const result = await createInvoiceAction({
      ...SALE_INPUT,
      idempotencyKey: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("inv-rival");
    // El lookup del catch va acotado por empresa (ADR-004): nunca devuelve la factura ajena.
    expect(prisma.invoice.findFirst).toHaveBeenLastCalledWith({
      where: { idempotencyKey: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff", companyId: COMPANY_ID },
      select: { id: true },
    });
  });

  it("SALE: P2002 SIN target no se disfraza de error transitorio (fail-closed)", async () => {
    vi.mocked(prisma.controlNumberSequence.upsert).mockRejectedValue(p2002());

    const error = await errorFor(SALE_INPUT);
    expect(error).not.toBe(MSG_TRANSITORIO);
    expect(error).toBe(MSG_DUP_NUMERO);
  });

  it("SALE: un P2002 con forma de pato (no instancia de Prisma) no entra en ninguna rama", async () => {
    const pato = Object.assign(new Error("Unique constraint failed on the fields"), {
      code: "P2002",
      meta: { target: ["controlNumber"] },
    });
    vi.mocked(prisma.controlNumberSequence.upsert).mockRejectedValue(pato);

    const error = await errorFor(SALE_INPUT);
    expect(error).not.toBe(MSG_TRANSITORIO);
    // Ni siquiera llega a `isPrismaError(error, "P2002")`: sale por el mapeo genérico.
    expect(error).not.toBe(MSG_DUP_NUMERO);
  });

  // REGRESIÓN (BUG CERRADO).
  //
  // RAMA MUERTA: no existe NINGÚN unique con una columna llamada `controlNumber`
  // (verificado en schema.prisma y en todas las migraciones). El único choque que
  // `getNextControlNumber` puede provocar es
  //   CREATE UNIQUE INDEX "ControlNumberSequence_companyId_invoiceType_key"
  //     ON "ControlNumberSequence"("companyId", "invoiceType")
  // cuyo target real es ["companyId","invoiceType"] — que NO contiene "controlNumber".
  // Resultado: la condición de la línea 192 de invoice.actions.ts nunca es cierta en
  // producción, y una colisión de correlativo se le reporta al usuario como
  // "Ya existe una factura con ese número para esta empresa" (falso: el número de
  // factura no chocó). La regla de CLAUDE.md (§Quick Reference, "P2002 en correlativo
  // al reintentar") describe un target que la BD no emite.
  //
  // `it.fails` mantiene el gate verde documentando el fallo REAL y se pone rojo en
  // cuanto se corrija el call-site (entonces pásalo a `it`).
  it(
    "REGRESIÓN: el P2002 real de ControlNumberSequence (['companyId','invoiceType']) da el mensaje transitorio",
    async () => {
      vi.mocked(prisma.controlNumberSequence.upsert).mockRejectedValue(
        p2002(["companyId", "invoiceType"]),
      );

      expect(await errorFor(SALE_INPUT)).toBe(MSG_TRANSITORIO);
    },
  );
});
