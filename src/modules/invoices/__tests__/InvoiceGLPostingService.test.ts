// src/modules/invoices/__tests__/InvoiceGLPostingService.test.ts
// Tests unitarios para causación automática de facturas al GL (ADR-026)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import { InvoiceGLPostingService } from "../services/InvoiceGLPostingService";
import type { InvoiceGLConfig, InvoiceForGL } from "../services/InvoiceGLPostingService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const TX_ID = "tx-gl-1";
const INVOICE_ID = "inv-1";

const FULL_SALE_CONFIG: InvoiceGLConfig = {
  arAccountId: "acc-cxc",
  apAccountId: "acc-prov",
  salesAccountId: "acc-ventas",
  purchaseExpenseAccountId: "acc-compras",
  ivaDFAccountId: "acc-iva-df",
  ivaCFAccountId: "acc-iva-cf",
};

const SALE_INVOICE: InvoiceForGL = {
  id: INVOICE_ID,
  type: "SALE",
  invoiceNumber: "0001",
  counterpartName: "Cliente ABC",
  date: new Date("2026-04-01"),
  periodId: "period-1",
  totalAmountVes: new Decimal("116.00"), // 100 base + 16 IVA
  taxLines: [{ taxType: "IVA_GENERAL", base: new Decimal("100"), amount: new Decimal("16") }],
};

const PURCHASE_INVOICE: InvoiceForGL = {
  id: INVOICE_ID,
  type: "PURCHASE",
  invoiceNumber: "C-0001",
  counterpartName: "Proveedor XYZ",
  date: new Date("2026-04-02"),
  periodId: "period-1",
  totalAmountVes: new Decimal("232.00"), // 200 base + 32 IVA
  taxLines: [{ taxType: "IVA_GENERAL", base: new Decimal("200"), amount: new Decimal("32") }],
};

const EXEMPT_INVOICE: InvoiceForGL = {
  id: INVOICE_ID,
  type: "SALE",
  invoiceNumber: "0002",
  counterpartName: "Cliente Exento",
  date: new Date("2026-04-03"),
  periodId: "period-1",
  totalAmountVes: new Decimal("500.00"),
  taxLines: [{ taxType: "EXENTO", base: new Decimal("500"), amount: new Decimal("0") }],
};

// ─── Mock db (Prisma.TransactionClient) ───────────────────────────────────────
function makeMockDb() {
  return {
    transaction: {
      create: vi.fn().mockResolvedValue({ id: TX_ID }),
    },
    invoice: {
      update: vi.fn().mockResolvedValue({ id: INVOICE_ID, transactionId: TX_ID }),
    },
  } as unknown as import("@prisma/client").Prisma.TransactionClient;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InvoiceGLPostingService.canPost()", () => {
  it("retorna true para SALE con config completa", () => {
    expect(InvoiceGLPostingService.canPost("SALE", FULL_SALE_CONFIG)).toBe(true);
  });

  it("retorna true para PURCHASE con config completa", () => {
    expect(InvoiceGLPostingService.canPost("PURCHASE", FULL_SALE_CONFIG)).toBe(true);
  });

  it("retorna false para SALE sin arAccountId", () => {
    const config = { ...FULL_SALE_CONFIG, arAccountId: null };
    expect(InvoiceGLPostingService.canPost("SALE", config)).toBe(false);
  });

  it("retorna false para SALE sin salesAccountId", () => {
    const config = { ...FULL_SALE_CONFIG, salesAccountId: null };
    expect(InvoiceGLPostingService.canPost("SALE", config)).toBe(false);
  });

  it("retorna false para PURCHASE sin apAccountId", () => {
    const config = { ...FULL_SALE_CONFIG, apAccountId: null };
    expect(InvoiceGLPostingService.canPost("PURCHASE", config)).toBe(false);
  });

  it("retorna false para PURCHASE sin purchaseExpenseAccountId", () => {
    const config = { ...FULL_SALE_CONFIG, purchaseExpenseAccountId: null };
    expect(InvoiceGLPostingService.canPost("PURCHASE", config)).toBe(false);
  });
});

describe("InvoiceGLPostingService.postInvoice() — VENTA", () => {
  let db: ReturnType<typeof makeMockDb>;

  beforeEach(() => { db = makeMockDb(); });

  it("crea Transaction + 3 JournalEntries balanceadas (Dr CxC / Cr Ventas / Cr IVA-DF)", async () => {
    const txId = await InvoiceGLPostingService.postInvoice(
      SALE_INVOICE,
      FULL_SALE_CONFIG,
      COMPANY_ID,
      USER_ID,
      db
    );

    expect(txId).toBe(TX_ID);

    const createCall = vi.mocked(db.transaction.create).mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries = (createCall.data as any).entries.create as Array<{ accountId: string; amount: Decimal }>;

    expect(entries).toHaveLength(3);

    // Dr CxC = 116 (positivo)
    const cxcEntry = entries.find((e) => e.accountId === "acc-cxc");
    expect(cxcEntry).toBeDefined();
    expect(new Decimal(cxcEntry!.amount.toString()).toFixed(2)).toBe("116.00");

    // Cr Ventas = -100 (negativo)
    const ventasEntry = entries.find((e) => e.accountId === "acc-ventas");
    expect(ventasEntry).toBeDefined();
    expect(new Decimal(ventasEntry!.amount.toString()).toFixed(2)).toBe("-100.00");

    // Cr IVA-DF = -16 (negativo)
    const ivaEntry = entries.find((e) => e.accountId === "acc-iva-df");
    expect(ivaEntry).toBeDefined();
    expect(new Decimal(ivaEntry!.amount.toString()).toFixed(2)).toBe("-16.00");

    // Invariante: Σ = 0
    const sum = entries.reduce((s, e) => s.plus(new Decimal(e.amount.toString())), new Decimal(0));
    expect(sum.abs().lessThan(new Decimal("0.01"))).toBe(true);
  });

  it("vincula el asiento a la factura via invoice.update", async () => {
    await InvoiceGLPostingService.postInvoice(SALE_INVOICE, FULL_SALE_CONFIG, COMPANY_ID, USER_ID, db);

    expect(vi.mocked(db.invoice.update)).toHaveBeenCalledWith({
      where: { id: INVOICE_ID },
      data: { transactionId: TX_ID },
    });
  });

  it("número de transaction usa prefijo FAC-", async () => {
    await InvoiceGLPostingService.postInvoice(SALE_INVOICE, FULL_SALE_CONFIG, COMPANY_ID, USER_ID, db);
    const createCall = vi.mocked(db.transaction.create).mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((createCall.data as any).number).toBe("FAC-0001");
  });

  it("omite entrada IVA-DF cuando ivaTotal = 0 (factura EXENTA)", async () => {
    await InvoiceGLPostingService.postInvoice(EXEMPT_INVOICE, FULL_SALE_CONFIG, COMPANY_ID, USER_ID, db);

    const createCall = vi.mocked(db.transaction.create).mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries = (createCall.data as any).entries.create as Array<{ accountId: string }>;

    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.accountId === "acc-iva-df")).toBeUndefined();

    // Invariante: Σ = 0
    const sum = entries.reduce(
      (s, e) => s.plus(new Decimal((e as { accountId: string; amount: Decimal }).amount.toString())),
      new Decimal(0)
    );
    expect(sum.abs().lessThan(new Decimal("0.01"))).toBe(true);
  });
});

describe("InvoiceGLPostingService.postInvoice() — COMPRA", () => {
  let db: ReturnType<typeof makeMockDb>;

  beforeEach(() => { db = makeMockDb(); });

  it("crea Transaction + 3 JournalEntries balanceadas (Dr Gasto / Dr IVA-CF / Cr AP)", async () => {
    const txId = await InvoiceGLPostingService.postInvoice(
      PURCHASE_INVOICE,
      FULL_SALE_CONFIG,
      COMPANY_ID,
      USER_ID,
      db
    );

    expect(txId).toBe(TX_ID);

    const createCall = vi.mocked(db.transaction.create).mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries = (createCall.data as any).entries.create as Array<{ accountId: string; amount: Decimal }>;

    expect(entries).toHaveLength(3);

    // Dr Gasto = 200 (positivo)
    const gastoEntry = entries.find((e) => e.accountId === "acc-compras");
    expect(gastoEntry).toBeDefined();
    expect(new Decimal(gastoEntry!.amount.toString()).toFixed(2)).toBe("200.00");

    // Cr AP = -232 (negativo)
    const apEntry = entries.find((e) => e.accountId === "acc-prov");
    expect(apEntry).toBeDefined();
    expect(new Decimal(apEntry!.amount.toString()).toFixed(2)).toBe("-232.00");

    // Dr IVA-CF = 32 (positivo)
    const ivaEntry = entries.find((e) => e.accountId === "acc-iva-cf");
    expect(ivaEntry).toBeDefined();
    expect(new Decimal(ivaEntry!.amount.toString()).toFixed(2)).toBe("32.00");

    // Invariante: Σ = 0
    const sum = entries.reduce((s, e) => s.plus(new Decimal(e.amount.toString())), new Decimal(0));
    expect(sum.abs().lessThan(new Decimal("0.01"))).toBe(true);
  });

  it("número de transaction usa prefijo CMP-", async () => {
    await InvoiceGLPostingService.postInvoice(PURCHASE_INVOICE, FULL_SALE_CONFIG, COMPANY_ID, USER_ID, db);
    const createCall = vi.mocked(db.transaction.create).mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((createCall.data as any).number).toBe("CMP-C-0001");
  });
});

describe("InvoiceGLPostingService — invariante de cuadre", () => {
  it("lanza error si el asiento resulta desbalanceado (totalAmountVes incorrecto)", async () => {
    const db = makeMockDb();
    const badInvoice: InvoiceForGL = {
      ...SALE_INVOICE,
      totalAmountVes: new Decimal("999.00"), // no coincide con base+iva = 116
    };

    await expect(
      InvoiceGLPostingService.postInvoice(badInvoice, FULL_SALE_CONFIG, COMPANY_ID, USER_ID, db)
    ).rejects.toThrow(/desbalanceado/);

    expect(vi.mocked(db.transaction.create)).not.toHaveBeenCalled();
  });
});
