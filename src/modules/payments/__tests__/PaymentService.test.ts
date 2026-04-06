// src/modules/payments/__tests__/PaymentService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import { PaymentService } from "../services/PaymentService";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    paymentRecord: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

const DATE = new Date("2026-03-30T00:00:00.000Z");

const PAYMENT_ROW = {
  id: "pay-1",
  companyId: "company-1",
  invoiceId: null,
  method: "PAGOMOVIL" as const,
  amountVes: new Decimal("500.00"),
  currency: "VES" as const,
  amountOriginal: null,
  exchangeRateId: null,
  referenceNumber: "REF-12345678",
  originBank: "Banco de Venezuela",
  destBank: "Banesco",
  commissionPct: null,
  commissionAmount: null,
  igtfAmount: null,
  date: DATE,
  notes: null,
  createdAt: DATE,
  createdBy: "user-1",
};

const ZELLE_ROW = {
  ...PAYMENT_ROW,
  id: "pay-2",
  method: "ZELLE" as const,
  amountVes: new Decimal("4650.00"),
  currency: "USD" as const,
  amountOriginal: new Decimal("100.00"),
  referenceNumber: null,
  originBank: null,
  destBank: null,
  igtfAmount: new Decimal("139.50"),
};

const CASHEA_ROW = {
  ...PAYMENT_ROW,
  id: "pay-3",
  method: "CASHEA" as const,
  amountVes: new Decimal("1000.00"),
  commissionPct: new Decimal("3.50"),
  commissionAmount: new Decimal("35.00"),
  referenceNumber: null,
  originBank: null,
  destBank: null,
};

describe("PaymentService.create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("crea un pago PagoMóvil con datos correctos", async () => {
    vi.mocked(prisma.paymentRecord.create).mockResolvedValue(PAYMENT_ROW as never);

    const tx = prisma;
    const result = await PaymentService.create(tx, {
      companyId: "company-1",
      method: "PAGOMOVIL",
      amountVes: new Decimal("500.00"),
      currency: "VES",
      referenceNumber: "REF-12345678",
      originBank: "Banco de Venezuela",
      destBank: "Banesco",
      date: DATE,
      createdBy: "user-1",
    });

    expect(prisma.paymentRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          method: "PAGOMOVIL",
          referenceNumber: "REF-12345678",
          currency: "VES",
        }),
      }),
    );
    expect(result.amountVes).toBe("500");
    expect(result.method).toBe("PAGOMOVIL");
  });

  it("crea un pago Zelle con monto USD y IGTF", async () => {
    vi.mocked(prisma.paymentRecord.create).mockResolvedValue(ZELLE_ROW as never);

    const result = await PaymentService.create(prisma, {
      companyId: "company-1",
      method: "ZELLE",
      amountVes: new Decimal("4650.00"),
      currency: "USD",
      amountOriginal: new Decimal("100.00"),
      igtfAmount: new Decimal("139.50"),
      date: DATE,
      createdBy: "user-1",
    });

    expect(result.method).toBe("ZELLE");
    expect(result.currency).toBe("USD");
    expect(result.amountOriginal).toBe("100");
    expect(result.igtfAmount).toBe("139.5");
  });

  it("crea un pago Cashea con comisión", async () => {
    vi.mocked(prisma.paymentRecord.create).mockResolvedValue(CASHEA_ROW as never);

    const result = await PaymentService.create(prisma, {
      companyId: "company-1",
      method: "CASHEA",
      amountVes: new Decimal("1000.00"),
      currency: "VES",
      commissionPct: new Decimal("3.50"),
      commissionAmount: new Decimal("35.00"),
      date: DATE,
      createdBy: "user-1",
    });

    expect(result.method).toBe("CASHEA");
    expect(result.commissionPct).toBe("3.5");
    expect(result.commissionAmount).toBe("35");
  });
});

describe("PaymentService.list", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna lista serializada", async () => {
    vi.mocked(prisma.paymentRecord.findMany).mockResolvedValue([PAYMENT_ROW] as never);

    const result = await PaymentService.list("company-1");

    expect(result).toHaveLength(1);
    expect(result[0].amountVes).toBe("500");
    expect(result[0].method).toBe("PAGOMOVIL");
  });

  it("retorna lista vacía si no hay pagos", async () => {
    vi.mocked(prisma.paymentRecord.findMany).mockResolvedValue([] as never);

    const result = await PaymentService.list("company-1");
    expect(result).toHaveLength(0);
  });
});

describe("PaymentService.calcIgtf", () => {
  it("calcula 3% correctamente", () => {
    const result = PaymentService.calcIgtf(new Decimal("4650.00"));
    expect(result.toFixed(2)).toBe("139.50");
  });

  it("redondea a 2 decimales", () => {
    const result = PaymentService.calcIgtf(new Decimal("100.01"));
    expect(result.decimalPlaces()).toBeLessThanOrEqual(2);
  });
});

describe("PaymentService.calcCommission", () => {
  it("calcula comisión Cashea 3.5%", () => {
    const result = PaymentService.calcCommission(new Decimal("1000.00"), new Decimal("3.50"));
    expect(result.toFixed(2)).toBe("35.00");
  });

  it("redondea a 2 decimales", () => {
    const result = PaymentService.calcCommission(new Decimal("333.33"), new Decimal("3.50"));
    expect(result.decimalPlaces()).toBeLessThanOrEqual(2);
  });
});
