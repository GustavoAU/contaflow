// src/modules/exchange-rates/__tests__/ExchangeDifferentialService.test.ts
import { describe, it, expect, vi } from "vitest";
import { Decimal } from "decimal.js";
import {
  ExchangeDifferentialService,
  type FxDiffLine,
} from "../services/ExchangeDifferentialService";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLine(
  invoiceType: "SALE" | "PURCHASE",
  outstandingForeign: number,
  originalRate: number,
  revalRate: number
): FxDiffLine {
  const outstanding = new Decimal(outstandingForeign);
  const orig = new Decimal(originalRate);
  const reval = new Decimal(revalRate);
  const vesAtOriginal = outstanding.times(orig).toDecimalPlaces(4);
  const vesAtReval = outstanding.times(reval).toDecimalPlaces(4);
  return {
    invoiceId: "inv-1",
    invoiceNumber: "F-001",
    invoiceType,
    currency: "USD",
    outstandingForeign: outstanding,
    originalRate: orig,
    revalRate: reval,
    vesAtOriginal,
    vesAtReval,
    differential: vesAtReval.minus(vesAtOriginal).toDecimalPlaces(4),
  };
}

// ─── aggregate() ─────────────────────────────────────────────────────────────

describe("ExchangeDifferentialService.aggregate", () => {
  it("SALE: rate increase → gain on CxC", () => {
    // Invoice 100 USD @ 40, revalued @ 45 → gain 500
    const line = makeLine("SALE", 100, 40, 45);
    const summary = ExchangeDifferentialService.aggregate([line]);

    expect(summary.totalFxGain.toFixed(2)).toBe("500.00");
    expect(summary.totalFxLoss.toFixed(2)).toBe("0.00");
    expect(summary.netCxCMovement.toFixed(2)).toBe("500.00"); // CxC Dr+500
    expect(summary.netCxPMovement.toFixed(2)).toBe("0.00");
  });

  it("SALE: rate decrease → loss on CxC", () => {
    // Invoice 100 USD @ 45, revalued @ 40 → loss 500
    const line = makeLine("SALE", 100, 45, 40);
    const summary = ExchangeDifferentialService.aggregate([line]);

    expect(summary.totalFxLoss.toFixed(2)).toBe("500.00");
    expect(summary.totalFxGain.toFixed(2)).toBe("0.00");
    expect(summary.netCxCMovement.toFixed(2)).toBe("-500.00"); // CxC Cr 500
  });

  it("PURCHASE: rate increase → loss on CxP (owe more VES)", () => {
    const line = makeLine("PURCHASE", 100, 40, 45);
    const summary = ExchangeDifferentialService.aggregate([line]);

    expect(summary.totalFxLoss.toFixed(2)).toBe("500.00");
    expect(summary.totalFxGain.toFixed(2)).toBe("0.00");
    expect(summary.netCxPMovement.toFixed(2)).toBe("500.00"); // CxP Cr 500 (liability ↑)
  });

  it("PURCHASE: rate decrease → gain on CxP (owe less VES)", () => {
    const line = makeLine("PURCHASE", 100, 45, 40);
    const summary = ExchangeDifferentialService.aggregate([line]);

    expect(summary.totalFxGain.toFixed(2)).toBe("500.00");
    expect(summary.totalFxLoss.toFixed(2)).toBe("0.00");
    expect(summary.netCxPMovement.toFixed(2)).toBe("-500.00"); // CxP Dr 500 (liability ↓)
  });

  it("GL invariant: netCxC + (-netCxP) + (-totalFxGain) + totalFxLoss = 0", () => {
    const lines = [
      makeLine("SALE", 100, 40, 45), // gain 500 on CxC
      makeLine("PURCHASE", 50, 38, 45), // loss 350 on CxP
    ];
    const s = ExchangeDifferentialService.aggregate(lines);

    // CxC +500, CxP Cr(-350), FxGain Cr(-500), FxLoss Dr +350
    const gl = s.netCxCMovement
      .plus(s.netCxPMovement.negated()) // CxP entry is negated (liability Cr)
      .plus(s.totalFxGain.negated())
      .plus(s.totalFxLoss);

    expect(gl.toFixed(4)).toBe("0.0000");
  });

  it("mixed SALE gain + SALE loss nets correctly", () => {
    const lines = [
      makeLine("SALE", 100, 40, 45), // diff +500 (gain)
      makeLine("SALE", 80, 50, 45), // diff -400 (loss)
    ];
    const s = ExchangeDifferentialService.aggregate(lines);

    expect(s.totalFxGain.toFixed(2)).toBe("500.00");
    expect(s.totalFxLoss.toFixed(2)).toBe("400.00");
    expect(s.netCxCMovement.toFixed(2)).toBe("100.00"); // 500 - 400
  });

  it("returns all zeros when lines is empty", () => {
    const s = ExchangeDifferentialService.aggregate([]);
    expect(s.totalFxGain.toFixed(2)).toBe("0.00");
    expect(s.totalFxLoss.toFixed(2)).toBe("0.00");
    expect(s.netCxCMovement.toFixed(2)).toBe("0.00");
    expect(s.netCxPMovement.toFixed(2)).toBe("0.00");
  });

  it("invoice with identical rates produces zero differential", () => {
    const line = makeLine("SALE", 100, 40, 40);
    expect(line.differential.toFixed(4)).toBe("0.0000");
    const s = ExchangeDifferentialService.aggregate([line]);
    expect(s.totalFxGain.toFixed(2)).toBe("0.00");
    expect(s.totalFxLoss.toFixed(2)).toBe("0.00");
  });
});

// ─── ADR-054: diferencial cambiario por tercero ──────────────────────────────

describe("ExchangeDifferentialService.aggregate — tercero por línea (ADR-054)", () => {
  it("agrupa el movimiento neto de CxC por customerId", () => {
    const lineA1 = { ...makeLine("SALE", 100, 40, 45), customerId: "cust-A" }; // +500
    const lineA2 = { ...makeLine("SALE", 80, 50, 45), customerId: "cust-A" }; // -400
    const lineB = { ...makeLine("SALE", 100, 40, 45), customerId: "cust-B" }; // +500

    const s = ExchangeDifferentialService.aggregate([lineA1, lineA2, lineB]);

    const custA = s.cxcByParty.find((p) => p.partyId === "cust-A");
    const custB = s.cxcByParty.find((p) => p.partyId === "cust-B");
    expect(custA?.netMovement.toFixed(2)).toBe("100.00"); // 500 - 400
    expect(custB?.netMovement.toFixed(2)).toBe("500.00");
    // Suma de los grupos == el agregado total (mismo dato, sin perder precisión)
    const sumOfParties = s.cxcByParty.reduce((acc, p) => acc.plus(p.netMovement), new Decimal(0));
    expect(sumOfParties.toFixed(2)).toBe(s.netCxCMovement.toFixed(2));
  });

  it("agrupa el movimiento neto de CxP por vendorId", () => {
    const lineA = { ...makeLine("PURCHASE", 100, 40, 45), vendorId: "vend-A" }; // loss +500 (owe more)
    const lineB = { ...makeLine("PURCHASE", 100, 45, 40), vendorId: "vend-B" }; // gain -500 (owe less)

    const s = ExchangeDifferentialService.aggregate([lineA, lineB]);

    const vendA = s.cxpByParty.find((p) => p.partyId === "vend-A");
    const vendB = s.cxpByParty.find((p) => p.partyId === "vend-B");
    expect(vendA?.netMovement.toFixed(2)).toBe("500.00");
    expect(vendB?.netMovement.toFixed(2)).toBe("-500.00");
  });

  it("líneas sin tercero resuelto se agrupan bajo partyId undefined (no se pierden)", () => {
    const lineNoParty = makeLine("SALE", 100, 40, 45); // sin customerId
    const s = ExchangeDifferentialService.aggregate([lineNoParty]);

    expect(s.cxcByParty).toHaveLength(1);
    expect(s.cxcByParty[0].partyId).toBeUndefined();
    expect(s.cxcByParty[0].netMovement.toFixed(2)).toBe("500.00");
  });

  it("cxpByParty queda vacío si no hay líneas PURCHASE (no mezcla con CxC)", () => {
    const line = { ...makeLine("SALE", 100, 40, 45), customerId: "cust-A" };
    const s = ExchangeDifferentialService.aggregate([line]);
    expect(s.cxpByParty).toHaveLength(0);
  });
});

// ─── ExchangeDifferentialService.calculate — resolución de tercero ───────────

describe("ExchangeDifferentialService.calculate — resolución de tercero por vínculo o RIF", () => {
  const REVAL_RATE = new Decimal("45");

  function makeInvoiceRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "inv-1",
      invoiceNumber: "F-001",
      type: "SALE",
      totalAmountVes: new Decimal("4500.00"), // 100 USD @ 45
      customerId: null,
      vendorId: null,
      counterpartRif: null,
      exchangeRate: { rate: new Decimal("40") }, // originalRate 40 → outstanding 100 USD
      invoicePayments: [],
      ...overrides,
    };
  }

  function makeDb(
    overrides: Partial<{
      invoices: unknown[];
      customerRows: { id: string; rif: string }[];
      vendorRows: { id: string; rif: string }[];
    }> = {}
  ) {
    return {
      invoice: { findMany: vi.fn().mockResolvedValue(overrides.invoices ?? []) },
      customer: { findMany: vi.fn().mockResolvedValue(overrides.customerRows ?? []) },
      vendor: { findMany: vi.fn().mockResolvedValue(overrides.vendorRows ?? []) },
    } as unknown as import("@prisma/client").Prisma.TransactionClient;
  }

  it("SALE con customerId ya vinculado → la línea lo usa directo, sin consultar por RIF", async () => {
    const db = makeDb({
      invoices: [makeInvoiceRow({ customerId: "cust-linked", counterpartRif: "J-11111111-1" })],
    });

    const summary = await ExchangeDifferentialService.calculate("co-1", "USD", REVAL_RATE, db);

    expect(summary.lines[0].customerId).toBe("cust-linked");
    expect(
      vi.mocked(
        (db as unknown as { customer: { findMany: ReturnType<typeof vi.fn> } }).customer.findMany
      )
    ).not.toHaveBeenCalled();
  });

  it("SALE sin vínculo, resuelve customerId por RIF en una sola query batch", async () => {
    const db = makeDb({
      invoices: [
        makeInvoiceRow({ id: "inv-1", counterpartRif: "J-11111111-1" }),
        makeInvoiceRow({ id: "inv-2", counterpartRif: "J-22222222-2" }),
      ],
      customerRows: [
        { id: "cust-1", rif: "J-11111111-1" },
        { id: "cust-2", rif: "J-22222222-2" },
      ],
    });

    const summary = await ExchangeDifferentialService.calculate("co-1", "USD", REVAL_RATE, db);

    expect(summary.lines.find((l) => l.invoiceId === "inv-1")?.customerId).toBe("cust-1");
    expect(summary.lines.find((l) => l.invoiceId === "inv-2")?.customerId).toBe("cust-2");
    expect(
      vi.mocked(
        (db as unknown as { customer: { findMany: ReturnType<typeof vi.fn> } }).customer.findMany
      )
    ).toHaveBeenCalledTimes(1);
  });

  it("PURCHASE sin vínculo, resuelve vendorId por RIF", async () => {
    const db = makeDb({
      invoices: [makeInvoiceRow({ type: "PURCHASE", counterpartRif: "J-33333333-3" })],
      vendorRows: [{ id: "vend-1", rif: "J-33333333-3" }],
    });

    const summary = await ExchangeDifferentialService.calculate("co-1", "USD", REVAL_RATE, db);

    expect(summary.lines[0].vendorId).toBe("vend-1");
  });

  it("sin RIF y sin vínculo → customerId/vendorId undefined, no bloquea el cálculo", async () => {
    const db = makeDb({ invoices: [makeInvoiceRow()] });

    const summary = await ExchangeDifferentialService.calculate("co-1", "USD", REVAL_RATE, db);

    expect(summary.lines[0].customerId).toBeUndefined();
    expect(summary.lines[0].vendorId).toBeUndefined();
  });
});

// ADR-058 / SPEC-004 lote 2: el diferencial se redondea a 2 decimales en origen y el asiento cuadra.
describe("ExchangeDifferentialService — ADR-058 diferencial al centimo", () => {
  const dbCalc = (invoices: unknown[]) =>
    ({
      invoice: { findMany: vi.fn().mockResolvedValue(invoices) },
      customer: { findMany: vi.fn().mockResolvedValue([]) },
      vendor: { findMany: vi.fn().mockResolvedValue([]) },
    }) as unknown as import("@prisma/client").Prisma.TransactionClient;

  const row = (id: string, type: string, totalVes: string, rate: string, customerId?: string) => ({
    id,
    invoiceNumber: id,
    type,
    totalAmountVes: new Decimal(totalVes),
    customerId: type === "SALE" ? (customerId ?? null) : null,
    vendorId: type === "PURCHASE" ? "vend-1" : null,
    counterpartRif: null,
    exchangeRate: { rate: new Decimal(rate) },
    invoicePayments: [],
  });

  it("vesAtOriginal/vesAtReval a 2 decimales y differential = su resta exacta", async () => {
    // 12345.67 / 779.9522 = 15.828... USD (6 dec.) ; reval 812.3377
    const db = dbCalc([row("F-1", "SALE", "12345.67", "779.9522", "c1")]);
    const summary = await ExchangeDifferentialService.calculate(
      "co-1",
      "USD",
      new Decimal("812.3377"),
      db
    );
    const l = summary.lines[0];
    expect(l.vesAtOriginal.decimalPlaces()).toBeLessThanOrEqual(2);
    expect(l.vesAtReval.decimalPlaces()).toBeLessThanOrEqual(2);
    expect(l.differential.equals(l.vesAtReval.minus(l.vesAtOriginal))).toBe(true);
    expect(l.differential.mul(100).isInteger()).toBe(true);
  });

  it("post(): varias facturas con tasas de 4 decimales -> Σ = 0 exacto y multiplos de 0,01", async () => {
    const db = dbCalc([
      row("F-1", "SALE", "12345.67", "779.9522", "c1"),
      row("F-2", "SALE", "9876.54", "779.9522", "c2"),
      row("F-3", "PURCHASE", "4321.09", "779.9522"),
      row("F-4", "PURCHASE", "777.77", "770.1234"),
    ]);
    const summary = await ExchangeDifferentialService.calculate(
      "co-1",
      "USD",
      new Decimal("812.3377"),
      db
    );
    const create = vi.fn().mockResolvedValue({ id: "gl-fx" });
    const postDb = {
      transaction: { create },
    } as unknown as import("@prisma/client").Prisma.TransactionClient;

    await ExchangeDifferentialService.post(
      summary,
      { arAccountId: "ar", apAccountId: "ap", fxGainAccountId: "gain", fxLossAccountId: "loss" },
      "co-1",
      "user-1",
      new Date("2026-06-30"),
      "period-1",
      postDb
    );

    const lines = create.mock.calls[0][0].data.entries.create as {
      amount: Decimal;
      accountId: string;
    }[];
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.reduce((a, x) => a.plus(x.amount), new Decimal(0)).isZero()).toBe(true);
    expect(lines.every((x) => x.amount.mul(100).isInteger())).toBe(true);
    for (const x of lines) expect("noAbsorb" in x).toBe(false);
  });
});
