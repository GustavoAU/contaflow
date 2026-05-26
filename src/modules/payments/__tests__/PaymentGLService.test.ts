// src/modules/payments/__tests__/PaymentGLService.test.ts
// ADR-030 — tests unitarios para PaymentGLService

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  default: {
    bankAccount: { findFirst: vi.fn() },
    accountingPeriod: { findFirst: vi.fn() },
    transaction: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    paymentRecord: { findFirst: vi.fn(), update: vi.fn() },
    paymentBatch: { findFirst: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

import { PaymentGLService } from "../services/PaymentGLService";
import type { Prisma } from "@prisma/client";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_ID = "company-1";
const BANK_ACCOUNT_ID = "bankacct-1";
const GL_ACCOUNT_ID = "bankgl-1"; // cuenta GL del banco
const AR_ACCOUNT_ID = "ar-1";
const AP_ACCOUNT_ID = "ap-1";
const IGTF_PAYABLE_ID = "igtf-payable-1";
const PERIOD_ID = "period-1";
const TX_ID = "tx-1";
const PAYMENT_RECORD_ID = "pr-1";
const PAYMENT_BATCH_ID = "pb-1";
const USER_ID = "user-1";

const BASE_CONTEXT = {
  companyId: COMPANY_ID,
  date: new Date("2026-05-26"),
  createdBy: USER_ID,
  description: "Cobro FAC-001 — PAGOMOVIL",
};

// Prisma tx mock — reutilizable
function makeTxMock(overrides: Partial<typeof import("@/lib/prisma")["default"]> = {}) {
  return {
    bankAccount: { findFirst: vi.fn().mockResolvedValue({ accountId: GL_ACCOUNT_ID }) },
    accountingPeriod: { findFirst: vi.fn().mockResolvedValue({ id: PERIOD_ID }) },
    transaction: {
      findFirst: vi.fn().mockResolvedValue({ id: TX_ID, number: "2026-05-000001" }),
      create: vi.fn().mockResolvedValue({ id: TX_ID }),
      update: vi.fn().mockResolvedValue({}),
    },
    paymentRecord: {
      findFirst: vi.fn().mockResolvedValue({ glTransactionId: null }),
      update: vi.fn().mockResolvedValue({}),
    },
    paymentBatch: {
      findFirst: vi.fn().mockResolvedValue({ glTransactionId: null }),
      update: vi.fn().mockResolvedValue({}),
    },
    // Fix 2: postPaymentRecordGL consulta invoice para diferencial cambiario NIC 21
    // Fix 4: postPaymentBatchGL consulta invoices para descripción enriquecida
    invoice: {
      findFirst: vi.fn().mockResolvedValue(null),   // sin tasa de factura por defecto
      findMany: vi.fn().mockResolvedValue([]),       // batch: sin datos de factura por defecto
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  } as unknown as Prisma.TransactionClient;
}

// ─── postPaymentRecordGL ──────────────────────────────────────────────────────

describe("PaymentGLService.postPaymentRecordGL", () => {
  it("caso cobro sin IGTF — crea asiento con 2 líneas balanceadas", async () => {
    const tx = makeTxMock();
    const amount = new Decimal("1000.00");

    const result = await PaymentGLService.postPaymentRecordGL(
      tx,
      {
        paymentRecordId: PAYMENT_RECORD_ID,
        bankAccountId: BANK_ACCOUNT_ID,
        amountVes: amount,
        igtfAmount: null,
        context: BASE_CONTEXT,
      },
      { arAccountId: AR_ACCOUNT_ID, igtfPayableAccountId: null, fxGainAccountId: null, fxLossAccountId: null, ivaRetentionReceivableAccountId: null },
    );

    expect(result.journalEntriesCount).toBe(2);
    expect(result.transactionId).toBe(TX_ID);

    // Verificar que create fue llamado con 2 entries
    const createCall = vi.mocked(tx.transaction.create).mock.calls[0][0];
    const entries = (createCall as { data: { entries: { create: unknown[] } } }).data.entries.create;
    expect(entries).toHaveLength(2);

    // Dr. Banco + Cr. CxC — partida doble: suma total = 0 (Débito + Crédito negativo = 0)
    const debit = (entries as { amount: Decimal }[]).find((e) => e.amount.greaterThan(0));
    const credit = (entries as { amount: Decimal }[]).find((e) => e.amount.lessThan(0));
    expect(debit).toBeDefined();
    expect(credit).toBeDefined();
    // debit (+1000) + credit (-1000) = 0
    expect(debit!.amount.plus(credit!.amount).toNumber()).toBe(0);
  });

  it("caso cobro con IGTF y cuenta igtfPayableAccountId — crea asiento con 4 líneas", async () => {
    const tx = makeTxMock();
    const amount = new Decimal("1000.00");
    const igtf = new Decimal("30.00");

    const result = await PaymentGLService.postPaymentRecordGL(
      tx,
      {
        paymentRecordId: PAYMENT_RECORD_ID,
        bankAccountId: BANK_ACCOUNT_ID,
        amountVes: amount,
        igtfAmount: igtf,
        context: BASE_CONTEXT,
      },
      { arAccountId: AR_ACCOUNT_ID, igtfPayableAccountId: IGTF_PAYABLE_ID, fxGainAccountId: null, fxLossAccountId: null, ivaRetentionReceivableAccountId: null },
    );

    expect(result.journalEntriesCount).toBe(4);

    const createCall = vi.mocked(tx.transaction.create).mock.calls[0][0];
    const entries = (createCall as { data: { entries: { create: unknown[] } } }).data.entries.create;
    expect(entries).toHaveLength(4);

    // Verificar partida doble: suma total débitos = suma total créditos
    const debits = (entries as { amount: Decimal }[])
      .filter((e) => e.amount.greaterThan(0))
      .reduce((s, e) => s.plus(e.amount), new Decimal(0));
    const credits = (entries as { amount: Decimal }[])
      .filter((e) => e.amount.lessThan(0))
      .reduce((s, e) => s.plus(e.amount.abs()), new Decimal(0));

    expect(debits.toNumber()).toBe(credits.toNumber());
  });

  it("IGTF_GL_SKIPPED — asiento 2 líneas + AuditLog con action IGTF_GL_SKIPPED si igtfPayableAccountId es null", async () => {
    const tx = makeTxMock();
    const amount = new Decimal("1000.00");
    const igtf = new Decimal("30.00");

    const result = await PaymentGLService.postPaymentRecordGL(
      tx,
      {
        paymentRecordId: PAYMENT_RECORD_ID,
        bankAccountId: BANK_ACCOUNT_ID,
        amountVes: amount,
        igtfAmount: igtf,
        context: BASE_CONTEXT,
      },
      { arAccountId: AR_ACCOUNT_ID, igtfPayableAccountId: null, fxGainAccountId: null, fxLossAccountId: null, ivaRetentionReceivableAccountId: null },
    );

    // Solo 2 líneas (sin IGTF)
    expect(result.journalEntriesCount).toBe(2);

    // Debe haber 2 llamadas a auditLog.create: GL_POSTED + IGTF_GL_SKIPPED
    expect(vi.mocked(tx.auditLog.create)).toHaveBeenCalledTimes(2);
    const auditCalls = vi.mocked(tx.auditLog.create).mock.calls;
    const actions = auditCalls.map((call) => (call[0] as { data: { action: string } }).data.action);
    expect(actions).toContain("GL_POSTED");
    expect(actions).toContain("IGTF_GL_SKIPPED");
  });

  it("lanza error si bankAccountId no pertenece a la empresa", async () => {
    const tx = makeTxMock({
      bankAccount: { findFirst: vi.fn().mockResolvedValue(null) } as never,
    } as never);

    await expect(
      PaymentGLService.postPaymentRecordGL(
        tx,
        {
          paymentRecordId: PAYMENT_RECORD_ID,
          bankAccountId: "otro-banco",
          amountVes: new Decimal("1000.00"),
          igtfAmount: null,
          context: BASE_CONTEXT,
        },
        { arAccountId: AR_ACCOUNT_ID, igtfPayableAccountId: null, fxGainAccountId: null, fxLossAccountId: null, ivaRetentionReceivableAccountId: null },
      ),
    ).rejects.toThrow("La cuenta bancaria no pertenece a esta empresa");
  });

  it("lanza error si no hay período contable abierto", async () => {
    const tx = makeTxMock({
      accountingPeriod: { findFirst: vi.fn().mockResolvedValue(null) } as never,
    } as never);

    await expect(
      PaymentGLService.postPaymentRecordGL(
        tx,
        {
          paymentRecordId: PAYMENT_RECORD_ID,
          bankAccountId: BANK_ACCOUNT_ID,
          amountVes: new Decimal("1000.00"),
          igtfAmount: null,
          context: BASE_CONTEXT,
        },
        { arAccountId: AR_ACCOUNT_ID, igtfPayableAccountId: null, fxGainAccountId: null, fxLossAccountId: null, ivaRetentionReceivableAccountId: null },
      ),
    ).rejects.toThrow("No hay período contable abierto");
  });

  it("actualiza PaymentRecord.glTransactionId al ID del asiento generado", async () => {
    const tx = makeTxMock();

    await PaymentGLService.postPaymentRecordGL(
      tx,
      {
        paymentRecordId: PAYMENT_RECORD_ID,
        bankAccountId: BANK_ACCOUNT_ID,
        amountVes: new Decimal("500.00"),
        igtfAmount: null,
        context: BASE_CONTEXT,
      },
      { arAccountId: AR_ACCOUNT_ID, igtfPayableAccountId: null, fxGainAccountId: null, fxLossAccountId: null, ivaRetentionReceivableAccountId: null },
    );

    expect(vi.mocked(tx.paymentRecord.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAYMENT_RECORD_ID },
        data: expect.objectContaining({ glTransactionId: TX_ID }),
      }),
    );
  });
});

// ─── postPaymentBatchGL ───────────────────────────────────────────────────────

describe("PaymentGLService.postPaymentBatchGL", () => {
  const BATCH_LINES = [
    { invoiceId: "inv-1", amountVes: new Decimal("500.00"), igtfAmount: null },
    { invoiceId: "inv-2", amountVes: new Decimal("300.00"), igtfAmount: null },
  ];

  it("N líneas sin IGTF — asiento con 2N JournalEntries balanceadas", async () => {
    const tx = makeTxMock();

    const result = await PaymentGLService.postPaymentBatchGL(
      tx,
      {
        paymentBatchId: PAYMENT_BATCH_ID,
        bankAccountId: BANK_ACCOUNT_ID,
        lines: BATCH_LINES,
        context: { ...BASE_CONTEXT, description: "Pago lote batch-1 — TRANSFERENCIA" },
      },
      { apAccountId: AP_ACCOUNT_ID, igtfPayableAccountId: null },
    );

    // 2 líneas × 2 entries = 4 entries
    expect(result.journalEntriesCount).toBe(4);

    const createCall = vi.mocked(tx.transaction.create).mock.calls[0][0];
    const entries = (createCall as { data: { entries: { create: unknown[] } } }).data.entries.create;

    // Verificar partida doble global
    const debits = (entries as { amount: Decimal }[])
      .filter((e) => e.amount.greaterThan(0))
      .reduce((s, e) => s.plus(e.amount), new Decimal(0));
    const credits = (entries as { amount: Decimal }[])
      .filter((e) => e.amount.lessThan(0))
      .reduce((s, e) => s.plus(e.amount.abs()), new Decimal(0));

    expect(debits.toNumber()).toBe(credits.toNumber());
  });

  it("N líneas con IGTF — asiento con 4N JournalEntries", async () => {
    const tx = makeTxMock();
    const linesWithIgtf = [
      { invoiceId: "inv-1", amountVes: new Decimal("500.00"), igtfAmount: new Decimal("15.00") },
      { invoiceId: "inv-2", amountVes: new Decimal("300.00"), igtfAmount: new Decimal("9.00") },
    ];

    const result = await PaymentGLService.postPaymentBatchGL(
      tx,
      {
        paymentBatchId: PAYMENT_BATCH_ID,
        bankAccountId: BANK_ACCOUNT_ID,
        lines: linesWithIgtf,
        context: BASE_CONTEXT,
      },
      { apAccountId: AP_ACCOUNT_ID, igtfPayableAccountId: IGTF_PAYABLE_ID },
    );

    // 2 líneas × 4 entries = 8 entries
    expect(result.journalEntriesCount).toBe(8);
  });

  it("actualiza PaymentBatch.glTransactionId", async () => {
    const tx = makeTxMock();

    await PaymentGLService.postPaymentBatchGL(
      tx,
      {
        paymentBatchId: PAYMENT_BATCH_ID,
        bankAccountId: BANK_ACCOUNT_ID,
        lines: BATCH_LINES,
        context: BASE_CONTEXT,
      },
      { apAccountId: AP_ACCOUNT_ID, igtfPayableAccountId: null },
    );

    expect(vi.mocked(tx.paymentBatch.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAYMENT_BATCH_ID },
        data: expect.objectContaining({ glTransactionId: TX_ID }),
      }),
    );
  });
});

// ─── reversePaymentRecordGL ───────────────────────────────────────────────────

describe("PaymentGLService.reversePaymentRecordGL", () => {
  const ORIGINAL_ENTRIES = [
    { id: "je-1", accountId: GL_ACCOUNT_ID, amount: new Decimal("1000.00"), description: "Cobro" },
    { id: "je-2", accountId: AR_ACCOUNT_ID, amount: new Decimal("-1000.00"), description: "Cobro" },
  ];

  it("no hace nada si PaymentRecord.glTransactionId es null", async () => {
    const tx = makeTxMock({
      paymentRecord: {
        findFirst: vi.fn().mockResolvedValue({ glTransactionId: null }),
        update: vi.fn(),
      } as never,
    } as never);

    await PaymentGLService.reversePaymentRecordGL(
      tx, PAYMENT_RECORD_ID, COMPANY_ID, USER_ID, BASE_CONTEXT,
    );

    expect(vi.mocked(tx.transaction.create)).not.toHaveBeenCalled();
  });

  it("crea asiento de reverso con líneas invertidas", async () => {
    // tx.transaction.findFirst es llamado dos veces:
    //   1. Para buscar la TX original (by id + companyId)
    //   2. Para generateTxNumber (by number startsWith prefix) → null → sequence=1
    const txFindFirst = vi.fn()
      .mockResolvedValueOnce({ id: TX_ID, status: "POSTED", description: "Cobro FAC-001", entries: ORIGINAL_ENTRIES, number: "2026-05-000001" })
      .mockResolvedValueOnce(null); // generateTxNumber: no hay asientos previos

    const tx = makeTxMock({
      paymentRecord: {
        findFirst: vi.fn().mockResolvedValue({ glTransactionId: TX_ID }),
        update: vi.fn(),
      } as never,
      transaction: {
        findFirst: txFindFirst,
        create: vi.fn().mockResolvedValue({ id: "tx-reverse-1" }),
        update: vi.fn().mockResolvedValue({}),
      } as never,
    } as never);

    await PaymentGLService.reversePaymentRecordGL(
      tx, PAYMENT_RECORD_ID, COMPANY_ID, USER_ID,
      { ...BASE_CONTEXT, description: "Anulación pago" },
    );

    // Debe crear asiento de reverso
    expect(vi.mocked(tx.transaction.create)).toHaveBeenCalledTimes(1);

    // Verificar que las entradas del reverso tienen signos invertidos
    const createCall = vi.mocked(tx.transaction.create).mock.calls[0][0];
    const reverseEntries = (createCall as { data: { entries: { create: { amount: Decimal }[] } } }).data.entries.create;
    expect(reverseEntries).toHaveLength(2);

    // El reverso de +1000 debe ser -1000 y viceversa
    const reversedAmounts = reverseEntries.map((e) => e.amount.toNumber());
    expect(reversedAmounts).toContain(-1000);
    expect(reversedAmounts).toContain(1000);

    // La Transaction original debe marcarse VOIDED
    expect(vi.mocked(tx.transaction.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TX_ID },
        data: expect.objectContaining({ status: "VOIDED" }),
      }),
    );
  });

  it("no hace nada si la Transaction original ya está VOIDED (idempotencia)", async () => {
    const tx = makeTxMock({
      paymentRecord: {
        findFirst: vi.fn().mockResolvedValue({ glTransactionId: TX_ID }),
        update: vi.fn(),
      } as never,
      transaction: {
        findFirst: vi.fn().mockResolvedValue({
          id: TX_ID,
          status: "VOIDED",
          description: "Cobro",
          entries: ORIGINAL_ENTRIES,
          number: "2026-05-000001",
        }),
        create: vi.fn(),
        update: vi.fn(),
      } as never,
    } as never);

    await PaymentGLService.reversePaymentRecordGL(
      tx, PAYMENT_RECORD_ID, COMPANY_ID, USER_ID, BASE_CONTEXT,
    );

    expect(vi.mocked(tx.transaction.create)).not.toHaveBeenCalled();
  });
});

// ─── R-5: Cero flotantes ──────────────────────────────────────────────────────

describe("R-5: PaymentGLService — Decimal.js en todos los cálculos", () => {
  it("los montos en JournalEntries son instancias de Decimal (no number)", async () => {
    const tx = makeTxMock();

    await PaymentGLService.postPaymentRecordGL(
      tx,
      {
        paymentRecordId: PAYMENT_RECORD_ID,
        bankAccountId: BANK_ACCOUNT_ID,
        amountVes: new Decimal("12345.67"),
        igtfAmount: null,
        context: BASE_CONTEXT,
      },
      { arAccountId: AR_ACCOUNT_ID, igtfPayableAccountId: null, fxGainAccountId: null, fxLossAccountId: null, ivaRetentionReceivableAccountId: null },
    );

    const createCall = vi.mocked(tx.transaction.create).mock.calls[0][0];
    const entries = (createCall as { data: { entries: { create: { amount: unknown }[] } } }).data.entries.create;

    for (const entry of entries) {
      // amount debe ser instancia de Decimal, no number
      expect(entry.amount).toBeInstanceOf(Decimal);
      expect(typeof entry.amount).not.toBe("number");
    }
  });
});

// ─── Riesgo-9 (Art. 33 COT): tipo COBRO / PAGO ──────────────────────────────

describe("Riesgo-9 — type COBRO en cobros y PAGO en pagos", () => {
  it("postPaymentRecordGL crea Transaction con type=COBRO", async () => {
    const tx = makeTxMock();

    await PaymentGLService.postPaymentRecordGL(
      tx,
      {
        paymentRecordId: PAYMENT_RECORD_ID,
        bankAccountId: BANK_ACCOUNT_ID,
        amountVes: new Decimal("1000.00"),
        igtfAmount: null,
        context: BASE_CONTEXT,
      },
      { arAccountId: AR_ACCOUNT_ID, igtfPayableAccountId: null, fxGainAccountId: null, fxLossAccountId: null, ivaRetentionReceivableAccountId: null },
    );

    const createCall = vi.mocked(tx.transaction.create).mock.calls[0][0];
    const data = (createCall as { data: { type: string } }).data;
    expect(data.type).toBe("COBRO");
  });

  it("postPaymentBatchGL crea Transaction con type=PAGO", async () => {
    const tx = makeTxMock();

    await PaymentGLService.postPaymentBatchGL(
      tx,
      {
        paymentBatchId: PAYMENT_BATCH_ID,
        bankAccountId: BANK_ACCOUNT_ID,
        lines: [{ invoiceId: "inv-1", amountVes: new Decimal("500.00"), igtfAmount: null }],
        context: BASE_CONTEXT,
      },
      { apAccountId: AP_ACCOUNT_ID, igtfPayableAccountId: null },
    );

    const createCall = vi.mocked(tx.transaction.create).mock.calls[0][0];
    const data = (createCall as { data: { type: string } }).data;
    expect(data.type).toBe("PAGO");
  });
});

// ─── Riesgo-6 (Prov. 0049): IVA retenido por cliente CE ─────────────────────

const IVA_RET_RECEIVABLE_ID = "iva-ret-recv-1";

describe("Riesgo-6 — IVA retenido por cliente CE en cobros", () => {
  it("con ivaRetentionAmount y cuenta configurada — crea 3 líneas: Dr.Banco + Dr.IVARet = Cr.CxC", async () => {
    const tx = makeTxMock();
    const amountVes = new Decimal("850.00");   // neto recibido
    const ivaRet = new Decimal("150.00");       // IVA retenido (75% del 16%)
    // Total factura = 850 + 150 = 1000

    await PaymentGLService.postPaymentRecordGL(
      tx,
      {
        paymentRecordId: PAYMENT_RECORD_ID,
        bankAccountId: BANK_ACCOUNT_ID,
        amountVes,
        igtfAmount: null,
        ivaRetentionAmount: ivaRet,
        context: BASE_CONTEXT,
      },
      {
        arAccountId: AR_ACCOUNT_ID,
        igtfPayableAccountId: null,
        fxGainAccountId: null,
        fxLossAccountId: null,
        ivaRetentionReceivableAccountId: IVA_RET_RECEIVABLE_ID,
      },
    );

    const createCall = vi.mocked(tx.transaction.create).mock.calls[0][0];
    const entries = (createCall as { data: { entries: { create: { accountId: string; amount: Decimal }[] } } }).data.entries.create;

    // 3 líneas: Dr. Banco + Dr. IVA Ret. x Cobrar + Cr. CxC
    expect(entries).toHaveLength(3);

    const bankEntry = entries.find((e) => e.accountId === GL_ACCOUNT_ID && e.amount.greaterThan(0));
    const ivaRetEntry = entries.find((e) => e.accountId === IVA_RET_RECEIVABLE_ID);
    const cxcEntry = entries.find((e) => e.accountId === AR_ACCOUNT_ID);

    expect(bankEntry).toBeDefined();
    expect(ivaRetEntry).toBeDefined();
    expect(cxcEntry).toBeDefined();

    // Dr. Banco = amountVes (neto)
    expect(bankEntry!.amount.toFixed(2)).toBe("850.00");
    // Dr. IVA Ret. x Cobrar = ivaRetentionAmount
    expect(ivaRetEntry!.amount.toFixed(2)).toBe("150.00");
    // Cr. CxC = amountVes + ivaRetentionAmount (total factura) — negativo
    expect(cxcEntry!.amount.toFixed(2)).toBe("-1000.00");

    // Partida doble: sum = 0
    const sum = entries.reduce((acc, e) => acc.plus(e.amount), new Decimal(0));
    expect(sum.toNumber()).toBe(0);
  });

  it("sin ivaRetentionAmount — comportamiento estándar (2 líneas)", async () => {
    const tx = makeTxMock();

    await PaymentGLService.postPaymentRecordGL(
      tx,
      {
        paymentRecordId: PAYMENT_RECORD_ID,
        bankAccountId: BANK_ACCOUNT_ID,
        amountVes: new Decimal("1000.00"),
        igtfAmount: null,
        context: BASE_CONTEXT,
      },
      {
        arAccountId: AR_ACCOUNT_ID,
        igtfPayableAccountId: null,
        fxGainAccountId: null,
        fxLossAccountId: null,
        ivaRetentionReceivableAccountId: IVA_RET_RECEIVABLE_ID, // configurada pero sin retención
      },
    );

    const createCall = vi.mocked(tx.transaction.create).mock.calls[0][0];
    const entries = (createCall as { data: { entries: { create: unknown[] } } }).data.entries.create;

    // Sin retención → 2 líneas estándar
    expect(entries).toHaveLength(2);
  });

  it("con ivaRetentionAmount pero sin cuenta configurada — usa 2 líneas estándar (no rompe)", async () => {
    const tx = makeTxMock();

    await PaymentGLService.postPaymentRecordGL(
      tx,
      {
        paymentRecordId: PAYMENT_RECORD_ID,
        bankAccountId: BANK_ACCOUNT_ID,
        amountVes: new Decimal("850.00"),
        igtfAmount: null,
        ivaRetentionAmount: new Decimal("150.00"),
        context: BASE_CONTEXT,
      },
      {
        arAccountId: AR_ACCOUNT_ID,
        igtfPayableAccountId: null,
        fxGainAccountId: null,
        fxLossAccountId: null,
        ivaRetentionReceivableAccountId: null, // no configurada
      },
    );

    const createCall = vi.mocked(tx.transaction.create).mock.calls[0][0];
    const entries = (createCall as { data: { entries: { create: unknown[] } } }).data.entries.create;

    // Sin cuenta → 2 líneas (Dr. Banco 850 + Cr. CxC 850)
    expect(entries).toHaveLength(2);
  });
});
