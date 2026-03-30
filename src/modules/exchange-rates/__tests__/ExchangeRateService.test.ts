// src/modules/exchange-rates/__tests__/ExchangeRateService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import { ExchangeRateService } from "../services/ExchangeRateService";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    exchangeRate: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

const DATE = new Date("2026-03-30T00:00:00.000Z");
const RATE_RECORD = {
  id: "rate-1",
  companyId: "company-1",
  currency: "USD" as const,
  rate: new Decimal("46.50"),
  date: DATE,
  source: "BCV",
  createdAt: new Date("2026-03-30"),
  createdBy: "user-1",
  invoices: [],
};

describe("ExchangeRateService.upsert", () => {
  beforeEach(() => vi.clearAllMocks());

  it("llama a upsert con los datos correctos", async () => {
    vi.mocked(prisma.exchangeRate.upsert).mockResolvedValue(RATE_RECORD as never);

    const tx = prisma;
    const result = await ExchangeRateService.upsert(
      tx,
      "company-1",
      "USD",
      DATE,
      new Decimal("46.50"),
      "BCV",
      "user-1",
    );

    expect(prisma.exchangeRate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId_currency_date: { companyId: "company-1", currency: "USD", date: DATE } },
      }),
    );
    expect(result.rate).toBe("46.5");
  });
});

describe("ExchangeRateService.getRateForDate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna la tasa si existe", async () => {
    vi.mocked(prisma.exchangeRate.findUnique).mockResolvedValue(RATE_RECORD as never);

    const result = await ExchangeRateService.getRateForDate("company-1", "USD", DATE);

    expect(result.currency).toBe("USD");
    expect(result.rate).toBe("46.5");
  });

  it("lanza error si no existe tasa para la fecha", async () => {
    vi.mocked(prisma.exchangeRate.findUnique).mockResolvedValue(null as never);

    await expect(
      ExchangeRateService.getRateForDate("company-1", "USD", DATE),
    ).rejects.toThrow("No hay tasa BCV registrada para USD el 2026-03-30");
  });
});

describe("ExchangeRateService.getLatestRate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna el registro más reciente", async () => {
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(RATE_RECORD as never);

    const result = await ExchangeRateService.getLatestRate("company-1", "USD");

    expect(result).not.toBeNull();
    expect(result!.rate).toBe("46.5");
  });

  it("retorna null si no hay tasas", async () => {
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(null as never);

    const result = await ExchangeRateService.getLatestRate("company-1", "USD");
    expect(result).toBeNull();
  });
});

describe("ExchangeRateService.list", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna la lista serializada", async () => {
    vi.mocked(prisma.exchangeRate.findMany).mockResolvedValue([RATE_RECORD] as never);

    const result = await ExchangeRateService.list("company-1");

    expect(result).toHaveLength(1);
    expect(result[0].currency).toBe("USD");
    expect(result[0].rate).toBe("46.5");
  });
});

describe("ExchangeRateService.toVES", () => {
  it("convierte monto a VES correctamente", () => {
    const amount = new Decimal("100");
    const rate = new Decimal("46.50");
    const result = ExchangeRateService.toVES(amount, rate);
    expect(result.toFixed(2)).toBe("4650.00");
  });

  it("redondea a 2 decimales", () => {
    const amount = new Decimal("1");
    const rate = new Decimal("46.505555");
    const result = ExchangeRateService.toVES(amount, rate);
    expect(result.decimalPlaces()).toBeLessThanOrEqual(2);
  });
});
