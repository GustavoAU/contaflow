// src/modules/invoices/actions/invoice-batch.actions.test.ts
//
// TDD SPEC (RED primero) — importInvoiceBatchAction NO pasa hoy por ningún schema
// de factura (ADR-049, "Fuera de alcance"): el RIF no se valida, el Nº de Control
// no es obligatorio en compras, la fecha no tiene rango (typo de año), los montos
// no tienen tope (MAX_INVOICE_AMOUNT), una retención IVA > 0 sin comprobante se
// acepta (H-14, Prov. 0049 Art. 11), y las ventas NUNCA reciben Nº de Control
// autogenerado (Z-1, Prov. 0071 Art. 14).
//
// Estos tests describen el comportamiento QUE DEBE TENER la action después de
// reescribirla para pasar por `getInvoiceSchemas(getFiscalConfig(ctx.country)).create`
// (mismo patrón que `createInvoiceAction` en invoice.actions.ts). No se modifica
// código de producción en este archivo.
//
// `getInvoiceSchemas`/`getFiscalConfig` NO se mockean — son puros y la validación
// debe ser real para que estos tests tengan sentido.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { importInvoiceBatchAction, type BatchRow } from "./invoice-batch.actions";
import { InvoiceService } from "../services/InvoiceService";
import { getNextControlNumber } from "../services/InvoiceSequenceService";
import { withSerializableRetry } from "@/lib/tx-helpers";
import { hasModuleAccess } from "@/lib/module-access";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { assertWriteAllowed } from "@/modules/billing/services/SubscriptionService";

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Fn compartida entre el mock de `@/lib/prisma` y el de `@/lib/tx-helpers`: la
// implementación futura puede usar CUALQUIERA de las dos vías de $transaction
// (Serializable para SALE, normal para PURCHASE) y en ambas el AuditLog debe
// terminar pasando por el MISMO mock — así las aserciones sobre `auditLog.create`
// no dependen de cuál de las dos rutas tomó el código.
const { auditLogCreateMock } = vi.hoisted(() => ({ auditLogCreateMock: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  fiscalKey: vi.fn((companyId: string, userId: string) => `${companyId}:${userId}`),
  limiters: { fiscal: {}, read: {}, ocr: {} },
}));

vi.mock("@/lib/module-access", () => ({
  hasModuleAccess: vi.fn().mockResolvedValue(true),
  moduleAccessError: vi.fn().mockReturnValue("Sin acceso al módulo de facturación"),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    auditLog: { create: auditLogCreateMock },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi.fn().mockImplementation(
    (_companyId: string, tx: unknown, fn: (_tx: unknown) => unknown) => fn(tx)
  ),
}));

vi.mock("../services/InvoiceService", () => ({
  InvoiceService: { create: vi.fn() },
}));

vi.mock("../services/InvoiceSequenceService", () => ({
  getNextControlNumber: vi.fn(),
}));

// Z-1: SALE debe usar Serializable (withSerializableRetry), no `prisma.$transaction`
// directo. El mock NO reintenta (a diferencia del real) — no hace falta para RED/GREEN.
vi.mock("@/lib/tx-helpers", () => ({
  withSerializableRetry: vi.fn((fn: (tx: unknown) => unknown) => fn({ auditLog: { create: auditLogCreateMock } })),
}));

// Corte por suscripción vencida — se mockea "permitido" por defecto (el real es fail-open y las
// otras 20+ pruebas de este archivo no configuran una suscripción; un solo test la desvía).
vi.mock("@/modules/billing/services/SubscriptionService", () => ({
  assertWriteAllowed: vi.fn().mockResolvedValue(undefined),
  READ_ONLY_MESSAGE: "Tu suscripción venció. Estás en modo solo lectura — renueva tu plan para volver a operar.",
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const goodSaleRow = (overrides: Partial<BatchRow> = {}): BatchRow => ({
  tipo: "VENTA",
  tipo_doc: "FACTURA",
  rif: "J-12345678-9",
  nombre: "Cliente Demo C.A.",
  nro_factura: "0000001",
  nro_control: "",
  fecha: "2026-03-01",
  base_16: "1000",
  base_8: "0",
  exento: "0",
  ret_iva: "0",
  ret_islr: "0",
  ...overrides,
});

const goodPurchaseRow = (overrides: Partial<BatchRow> = {}): BatchRow => ({
  tipo: "COMPRA",
  tipo_doc: "FACTURA",
  rif: "J-98765432-1",
  nombre: "Proveedor Demo C.A.",
  nro_factura: "F-0001",
  nro_control: "00-00000001",
  fecha: "2026-03-01",
  base_16: "1000",
  base_8: "0",
  exento: "0",
  ret_iva: "0",
  ret_islr: "0",
  ...overrides,
});

describe("importInvoiceBatchAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "ACCOUNTANT",
      company: { country: "VEN" },
    } as never);
    vi.mocked(hasModuleAccess).mockResolvedValue(true);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) => fn({ auditLog: prisma.auditLog })) as never
    );
    vi.mocked(InvoiceService.create).mockResolvedValue({ id: "inv-created" } as never);
    vi.mocked(getNextControlNumber).mockResolvedValue("00-00000099" as never);
  });

  // ── 1. RIF inválido ─────────────────────────────────────────────────────
  it("RED — RIF inválido en fila de venta: error menciona RIF, no crea nada", async () => {
    const rows = [goodSaleRow({ rif: "no-es-un-rif" })];

    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(0);
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0].row).toBe(1);
      expect(result.data.errors[0].message).toMatch(/RIF/i);
    }
    expect(InvoiceService.create).not.toHaveBeenCalled();
  });

  // ── 2. RIF válido (GUARDA) ───────────────────────────────────────────────
  it("GUARDA — RIF válido: crea la factura sin errores", async () => {
    const rows = [goodSaleRow()];

    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(1);
      expect(result.data.errors).toHaveLength(0);
    }
    expect(InvoiceService.create).toHaveBeenCalledTimes(1);
  });

  // ── 3. Compra sin Nº de Control ──────────────────────────────────────────
  it("RED — compra sin Nº de Control: error menciona control, no crea nada", async () => {
    const rows = [goodPurchaseRow({ nro_control: "" })];

    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(0);
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0].message).toMatch(/control/i);
    }
    expect(InvoiceService.create).not.toHaveBeenCalled();
  });

  // ── 4. Compra con Nº de Control válido (GUARDA) ─────────────────────────
  it("GUARDA — compra con Nº de Control válido: crea la factura sin errores", async () => {
    const rows = [goodPurchaseRow()];

    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(1);
      expect(result.data.errors).toHaveLength(0);
    }
    expect(InvoiceService.create).toHaveBeenCalledTimes(1);
  });

  // ── 5. Venta sin Nº de Control → se autogenera (Z-1) ────────────────────
  it("RED — venta sin Nº de Control: genera uno con getNextControlNumber y lo pasa al service", async () => {
    vi.mocked(getNextControlNumber).mockResolvedValue("00-00000042" as never);
    const rows = [goodSaleRow({ nro_control: "" })];

    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(1);
      expect(result.data.errors).toHaveLength(0);
    }
    expect(getNextControlNumber).toHaveBeenCalledWith(expect.anything(), "company-1", "SALE");
    expect(InvoiceService.create).toHaveBeenCalledWith(
      expect.objectContaining({ controlNumber: "00-00000042" }),
      expect.anything(),
    );
  });

  // ── 6. Venta CON Nº de Control provisto por el CSV (GUARDA parcial) ─────
  it("GUARDA — venta con Nº de Control del CSV: no genera uno nuevo y lo pasa tal cual", async () => {
    const rows = [goodSaleRow({ nro_control: "00-00000007" })];

    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.created).toBe(1);
    expect(getNextControlNumber).not.toHaveBeenCalled();
    expect(InvoiceService.create).toHaveBeenCalledWith(
      expect.objectContaining({ controlNumber: "00-00000007" }),
      expect.anything(),
    );
  });

  // ── 7. Fecha con typo de año (clase de bug CLAUDE.md dinámica #4) ────────
  it("RED — fecha con typo de año (12026): error menciona fecha, no crea nada", async () => {
    // `new Date("12026-01-01")` NO es Invalid Date (V8 acepta años extendidos) —
    // el chequeo actual (`isNaN(parsedDate.getTime())`) no detecta esto.
    const rows = [goodSaleRow({ fecha: "12026-01-01" })];

    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(0);
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0].message).toMatch(/fecha/i);
    }
    expect(InvoiceService.create).not.toHaveBeenCalled();
  });

  // ── 8. Fecha no parseable (GUARDA — ya se rechaza hoy) ───────────────────
  it("GUARDA — fecha no parseable: sigue rechazándose", async () => {
    const rows = [goodSaleRow({ fecha: "no-es-fecha" })];

    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(0);
      expect(result.data.errors).toHaveLength(1);
    }
    expect(InvoiceService.create).not.toHaveBeenCalled();
  });

  // ── 9. Monto fuera de rango (ADR-006 D-2, MAX_INVOICE_AMOUNT) ────────────
  it("RED — base_16 fuera del rango MAX_INVOICE_AMOUNT: error, no crea nada", async () => {
    // MAX_INVOICE_AMOUNT = "9999999999.9999" (~10 mil millones) — 20 mil millones lo excede.
    const rows = [goodSaleRow({ base_16: "20000000000" })];

    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(0);
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0].message).toMatch(/(rango|monto)/i);
    }
    expect(InvoiceService.create).not.toHaveBeenCalled();
  });

  // ── 10. Retención IVA sin comprobante (H-14, Prov. 0049 Art. 11) ────────
  it("RED — retención IVA sin comprobante: error, no crea nada", async () => {
    // El CSV no tiene columna de comprobante: ivaRetentionVoucher queda undefined siempre.
    const rows = [goodSaleRow({ ret_iva: "500" })];

    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(0);
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0].message).toMatch(/(comprobante|retenci[oó]n)/i);
    }
    expect(InvoiceService.create).not.toHaveBeenCalled();
  });

  it("GUARDA — ret_iva en 0: sigue aceptándose sin exigir comprobante", async () => {
    const rows = [goodSaleRow({ ret_iva: "0" })];

    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(1);
      expect(result.data.errors).toHaveLength(0);
    }
  });

  // ── 11. SALE usa Serializable, PURCHASE no (Z-1) ─────────────────────────
  it("RED — venta usa withSerializableRetry, no prisma.$transaction directo", async () => {
    const rows = [goodSaleRow()];

    await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(withSerializableRetry).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("GUARDA — compra usa prisma.$transaction normal, no withSerializableRetry", async () => {
    const rows = [goodPurchaseRow()];

    await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(withSerializableRetry).not.toHaveBeenCalled();
  });

  // ── 12. Mapeo de error Prisma P2002 en SALE (Z-1) ────────────────────────
  it("RED — P2002 en secuencia de Nº Control (SALE): mensaje de negocio, no el crudo de Prisma", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`invoiceType`)", {
      code: "P2002",
      clientVersion: "7.0.0",
      meta: { target: ["companyId", "invoiceType"] },
    });
    vi.mocked(InvoiceService.create).mockRejectedValueOnce(p2002 as never);

    const rows = [goodSaleRow({ nro_control: "" })];
    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(0);
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0].message).toBe(
        "Error transitorio al generar Nº Control — intenta de nuevo."
      );
    }
  });

  it("RED — P2002 genérico (no de invoiceType): mensaje de negocio de duplicado, no el crudo de Prisma", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "7.0.0",
      meta: { target: ["companyId", "invoiceNumber"] },
    });
    vi.mocked(InvoiceService.create).mockRejectedValueOnce(p2002 as never);

    const rows = [goodPurchaseRow()];
    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0].message).toBe(
        "Ya existe una factura con ese número para esta empresa"
      );
    }
  });

  it("RED — P2003 (FK inválida): mensaje de negocio, no el crudo de Prisma", async () => {
    const p2003 = new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed", {
      code: "P2003",
      clientVersion: "7.0.0",
    });
    vi.mocked(InvoiceService.create).mockRejectedValueOnce(p2003 as never);

    const rows = [goodPurchaseRow()];
    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0].message).toBe("Datos de referencia inválidos");
    }
  });

  // ── 13. Regresión — batch mixto ──────────────────────────────────────────
  it("REGRESIÓN — batch mixto: created cuenta solo las filas válidas y errors apunta al índice correcto", async () => {
    const rows = [
      goodPurchaseRow(),                        // row 1: válida
      goodSaleRow({ rif: "no-es-un-rif" }),     // row 2: inválida
      goodSaleRow({ nro_factura: "0000099" }),  // row 3: válida
    ];

    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(2);
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0].row).toBe(2);
    }
    expect(InvoiceService.create).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith("/company/company-1/invoices");

    // idempotencyKey único por fila (las 2 filas válidas no comparten clave)
    const calls = vi.mocked(InvoiceService.create).mock.calls as unknown as Array<[{ idempotencyKey?: string }]>;
    const keys = calls.map(([payload]) => payload.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("REGRESIÓN — batch sin filas válidas: no llama a revalidatePath", async () => {
    const rows = [goodSaleRow({ rif: "no-es-un-rif" })];

    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.created).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  // ── 14. hasModuleAccess y rate limiting intactos (GUARDA) ────────────────
  it("GUARDA — sin acceso al módulo de facturación: no toca ninguna fila", async () => {
    vi.mocked(hasModuleAccess).mockResolvedValueOnce(false);

    const result = await importInvoiceBatchAction("company-1", "period-1", [goodSaleRow()]);

    expect(result).toEqual({ success: false, error: "Sin acceso al módulo de facturación" });
    expect(InvoiceService.create).not.toHaveBeenCalled();
  });

  it("GUARDA — sin sesión autenticada: no toca ninguna fila", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await importInvoiceBatchAction("company-1", "period-1", [goodSaleRow()]);

    expect(result).toEqual({ success: false, error: "No autorizado" });
    expect(InvoiceService.create).not.toHaveBeenCalled();
  });

  // ── 15. Errores Prisma fuera de P2002/P2003: nunca crudos (hallazgo security-agent) ──────
  it("RED — P2034 (Serializable agotado): mensaje de mapPrismaError, no el crudo de Prisma", async () => {
    const p2034 = new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict", {
      code: "P2034",
      clientVersion: "7.0.0",
    });
    vi.mocked(InvoiceService.create).mockRejectedValueOnce(p2034 as never);

    const rows = [goodPurchaseRow()];
    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0].message).toBe("Error transitorio — intenta de nuevo.");
    }
  });

  it("RED — error técnico de BD (keyword 'permission denied for schema public'): mensaje genérico, no el crudo", async () => {
    vi.mocked(InvoiceService.create).mockRejectedValueOnce(
      new Error("permission denied for schema public") as never
    );

    const rows = [goodPurchaseRow()];
    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0].message).toBe(
        "No se pudo completar la operación por un problema de base de datos. Intenta de nuevo; si el problema persiste, contacta al administrador."
      );
      expect(result.data.errors[0].message).not.toMatch(/permission denied/);
    }
  });

  it("GUARDA — un error de negocio normal (sin keyword técnica) sigue mostrando su propio mensaje", async () => {
    vi.mocked(InvoiceService.create).mockRejectedValueOnce(
      new Error("El Nº Control 00-00000001 ya fue registrado para el proveedor J-98765432-1") as never
    );

    const rows = [goodPurchaseRow()];
    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.errors[0].message).toBe(
        "El Nº Control 00-00000001 ya fue registrado para el proveedor J-98765432-1"
      );
    }
  });

  // ── 16. Tope de filas server-side (hallazgo security-agent — precedente: import.actions.ts) ──
  it("RED — más de 200 filas: rechaza el batch completo sin tocar ninguna fila", async () => {
    const rows = Array.from({ length: 201 }, () => goodPurchaseRow());

    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result).toEqual({
      success: false,
      error: "El archivo supera el límite de 200 facturas por importación.",
    });
    expect(InvoiceService.create).not.toHaveBeenCalled();
  });

  it("GUARDA — exactamente 200 filas: no lo bloquea el tope", async () => {
    const rows = Array.from({ length: 200 }, () => goodPurchaseRow());

    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.created).toBe(200);
  });

  // ── 17. NOTA_CREDITO/NOTA_DEBITO bloqueadas en el batch (hallazgo fiscal-agent H4) ────────
  it.each(["NOTA_CREDITO", "NOTA_DEBITO"] as const)(
    "RED — %s por CSV se rechaza (sin threading a la factura original, no toca InvoiceService)",
    async (tipo_doc) => {
      const rows = [goodPurchaseRow({ tipo_doc })];

      const result = await importInvoiceBatchAction("company-1", "period-1", rows);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.created).toBe(0);
        expect(result.data.errors).toHaveLength(1);
        expect(result.data.errors[0].message).toMatch(/notas de crédito\/débito/i);
      }
      expect(InvoiceService.create).not.toHaveBeenCalled();
    }
  );

  it("REGRESIÓN — FACTURA sigue funcionando junto a una NOTA_CREDITO rechazada en el mismo batch", async () => {
    const rows = [goodPurchaseRow(), goodPurchaseRow({ tipo_doc: "NOTA_CREDITO" })];

    const result = await importInvoiceBatchAction("company-1", "period-1", rows);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(1);
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0].row).toBe(2);
    }
  });

  // ── 18. Corte por suscripción vencida (hallazgo fiscal-agent H5 — consistencia con createInvoiceAction) ──
  it("RED — suscripción vencida: bloquea el batch completo con el mensaje de solo lectura, sin tocar ninguna fila", async () => {
    vi.mocked(assertWriteAllowed).mockRejectedValueOnce(
      new Error("Tu suscripción venció. Estás en modo solo lectura — renueva tu plan para volver a operar.")
    );

    const result = await importInvoiceBatchAction("company-1", "period-1", [goodPurchaseRow()]);

    expect(result).toEqual({
      success: false,
      error: "Tu suscripción venció. Estás en modo solo lectura — renueva tu plan para volver a operar.",
    });
    expect(InvoiceService.create).not.toHaveBeenCalled();
  });
});
