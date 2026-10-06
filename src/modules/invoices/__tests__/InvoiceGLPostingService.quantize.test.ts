// src/modules/invoices/__tests__/InvoiceGLPostingService.quantize.test.ts
//
// SPEC-001 / ADR-058: el asiento de la factura se cuantiza al céntimo ANTES de persistir y cuadra
// EXACTO (Σ = 0). La causación de facturas era el único generador de asientos que no pasaba por
// `quantizeGLEntries` / `assertBalancedGLEntries`: con el trigger de cuadre de la BD (T = 0), una
// factura cuyas líneas se guardaran con Σ ≠ 0 haría fallar el COMMIT en producción.
//
// Regla del residuo (ADR-058): cae en la línea de BASE (ingresos / inventario) y nunca en las
// líneas de tercero (CxC/CxP) ni en las obligaciones fiscales (IVA, IGTF, retención IVA).
//
// Environment: node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import { InvoiceGLPostingService } from "../services/InvoiceGLPostingService";
import type { InvoiceGLConfig, InvoiceForGL } from "../services/InvoiceGLPostingService";

const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const TX_ID = "tx-gl-1";

const CONFIG: InvoiceGLConfig = {
  arAccountId: "acc-cxc",
  apAccountId: "acc-prov",
  salesAccountId: "acc-ventas",
  purchaseExpenseAccountId: null,
  inventoryAccountId: "acc-inventario",
  ivaDFAccountId: "acc-iva-df",
  ivaCFAccountId: "acc-iva-cf",
  ivaRetentionPayableAccountId: null,
  igtfPayableAccountId: null,
};

// Totales con MÁS de 2 decimales (p. ej. conversión de moneda): rounded a 2 decimales cada línea,
// la suma de las líneas redondeadas deja un residuo de un céntimo.
//   total 10.005 → 10.01 | IVA 1.004 → 1.00 | base 10.005 − 1.004 = 9.001 → 9.00
const SALE: InvoiceForGL = {
  id: "inv-1",
  type: "SALE",
  invoiceNumber: "0100",
  counterpartName: "Cliente ABC",
  date: new Date("2026-04-01"),
  periodId: "period-1",
  totalAmountVes: new Decimal("10.005"),
  taxLines: [{ taxType: "IVA_GENERAL", base: new Decimal("9.001"), amount: new Decimal("1.004") }],
};

const PURCHASE: InvoiceForGL = {
  ...SALE,
  type: "PURCHASE",
  invoiceNumber: "C-0100",
  counterpartName: "Proveedor XYZ",
};

function makeDb() {
  return {
    transaction: { create: vi.fn().mockResolvedValue({ id: TX_ID }) },
    invoice: { update: vi.fn().mockResolvedValue({ id: "inv-1", transactionId: TX_ID }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as import("@prisma/client").Prisma.TransactionClient & {
    transaction: { create: ReturnType<typeof vi.fn> };
    auditLog: { create: ReturnType<typeof vi.fn> };
  };
}

type Line = { accountId: string; amount: Decimal };

function linesOf(db: ReturnType<typeof makeDb>): Line[] {
  const call = vi.mocked(db.transaction.create).mock.calls[0]![0] as {
    data: { entries: { create: Line[] } };
  };
  return call.data.entries.create;
}
const amountOf = (lines: Line[], accountId: string) =>
  lines.find((l) => l.accountId === accountId)?.amount.toString();
const sumOf = (lines: Line[]) => lines.reduce((s, l) => s.plus(l.amount), new Decimal(0));

describe("InvoiceGLPostingService — asiento cuantizado al céntimo (SPEC-001 / ADR-058)", () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => {
    db = makeDb();
  });

  it("VENTA: cada línea a 2 decimales y Σ = 0 exacta; el residuo cae en Ingresos", async () => {
    await InvoiceGLPostingService.postInvoice(SALE, CONFIG, COMPANY_ID, USER_ID, db);

    const lines = linesOf(db);
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(new Decimal(l.amount).times(100).isInteger()).toBe(true);
    expect(sumOf(lines).isZero()).toBe(true);

    // CxC (línea de tercero) y IVA (fiscal) quedan EXACTOS: no absorben el residuo
    expect(amountOf(lines, "acc-cxc")).toBe("10.01");
    expect(amountOf(lines, "acc-iva-df")).toBe("-1");
    // La base absorbe el céntimo: −9.00 − 0.01
    expect(amountOf(lines, "acc-ventas")).toBe("-9.01");
  });

  it("COMPRA: cada línea a 2 decimales y Σ = 0 exacta; el residuo cae en Inventario", async () => {
    await InvoiceGLPostingService.postInvoice(PURCHASE, CONFIG, COMPANY_ID, USER_ID, db);

    const lines = linesOf(db);
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(new Decimal(l.amount).times(100).isInteger()).toBe(true);
    expect(sumOf(lines).isZero()).toBe(true);

    // CxP (tercero) e IVA crédito fiscal exactos; el inventario absorbe: 9.00 + 0.01
    expect(amountOf(lines, "acc-prov")).toBe("-10.01");
    expect(amountOf(lines, "acc-iva-cf")).toBe("1");
    expect(amountOf(lines, "acc-inventario")).toBe("9.01");
  });

  it("deja constancia del residuo en el AuditLog (R-6, ADR-058 D-8) solo cuando existe", async () => {
    await InvoiceGLPostingService.postInvoice(SALE, CONFIG, COMPANY_ID, USER_ID, db);

    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    const data = vi.mocked(db.auditLog.create).mock.calls[0]![0].data as {
      action: string;
      entityName: string;
      entityId: string;
      newValue: { glRounding: { residual: string; scale: number } };
    };
    expect(data.entityName).toBe("Invoice");
    expect(data.entityId).toBe("inv-1");
    expect(new Decimal(data.newValue.glRounding.residual).abs().toFixed(2)).toBe("0.01");
    expect(data.newValue.glRounding.scale).toBe(2);
  });

  it("una factura ya a 2 decimales no genera residuo ni AuditLog (sin regresión)", async () => {
    const exacta: InvoiceForGL = {
      ...SALE,
      totalAmountVes: new Decimal("116.00"),
      taxLines: [{ taxType: "IVA_GENERAL", base: new Decimal("100"), amount: new Decimal("16") }],
    };
    await InvoiceGLPostingService.postInvoice(exacta, CONFIG, COMPANY_ID, USER_ID, db);

    const lines = linesOf(db);
    expect(amountOf(lines, "acc-cxc")).toBe("116");
    expect(amountOf(lines, "acc-ventas")).toBe("-100");
    expect(amountOf(lines, "acc-iva-df")).toBe("-16");
    expect(sumOf(lines).isZero()).toBe(true);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("la nota de crédito (reverso) también se cuantiza: mismas cuentas, signos opuestos, Σ = 0", async () => {
    const nc: InvoiceForGL = { ...SALE, docType: "NOTA_CREDITO" };
    await InvoiceGLPostingService.postCreditNote(nc, CONFIG, COMPANY_ID, USER_ID, db);

    const lines = linesOf(db);
    for (const l of lines) expect(new Decimal(l.amount).times(100).isInteger()).toBe(true);
    expect(sumOf(lines).isZero()).toBe(true);
    expect(amountOf(lines, "acc-cxc")).toBe("-10.01");
    expect(amountOf(lines, "acc-iva-df")).toBe("1");
    expect(amountOf(lines, "acc-ventas")).toBe("9.01");
  });

  it("no pasa el campo interno `noAbsorb` a Prisma (rechazaría la clave desconocida)", async () => {
    await InvoiceGLPostingService.postInvoice(SALE, CONFIG, COMPANY_ID, USER_ID, db);
    for (const l of linesOf(db)) expect(Object.keys(l)).not.toContain("noAbsorb");
  });
});
