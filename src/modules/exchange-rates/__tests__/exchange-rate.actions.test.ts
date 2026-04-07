// src/modules/exchange-rates/__tests__/exchange-rate.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockFetchUsdVes = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { fiscal: {}, ocr: {} },
}));
vi.mock("../services/BcvFetchService", () => ({
  BcvFetchService: { fetchUsdVes: mockFetchUsdVes },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findUnique: vi.fn() },
    exchangeRate: { upsert: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import {
  fetchBcvRateAction,
  upsertExchangeRateAction,
  listExchangeRatesAction,
} from "../actions/exchange-rate.actions";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const TODAY = new Date("2026-04-07T00:00:00.000Z");
const RATE = new Decimal("46.50");

const RATE_RECORD = {
  id: "rate-1",
  companyId: COMPANY_ID,
  currency: "USD" as const,
  rate: RATE,
  date: TODAY,
  source: "BCV-AUTO",
  createdAt: new Date("2026-04-07"),
  createdBy: USER_ID,
};

const MEMBER = { userId: USER_ID, companyId: COMPANY_ID, role: "ACCOUNTANT" };

// ─── fetchBcvRateAction ───────────────────────────────────────────────────────
describe("fetchBcvRateAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(MEMBER as never);
    mockFetchUsdVes.mockResolvedValue({ rate: RATE, date: TODAY, rawRate: 46.5 });
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          exchangeRate: prisma.exchangeRate,
          auditLog: prisma.auditLog,
        })) as never,
    );
    vi.mocked(prisma.exchangeRate.upsert).mockResolvedValue(RATE_RECORD as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("retorna { success: true, data } cuando todo es correcto", async () => {
    const result = await fetchBcvRateAction(COMPANY_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe("USD");
      expect(result.data.source).toBe("BCV-AUTO");
    }
  });

  it("llama a BcvFetchService.fetchUsdVes una vez", async () => {
    await fetchBcvRateAction(COMPANY_ID);
    expect(mockFetchUsdVes).toHaveBeenCalledTimes(1);
  });

  it("guarda la tasa con source BCV-AUTO", async () => {
    await fetchBcvRateAction(COMPANY_ID);
    expect(prisma.exchangeRate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ source: "BCV-AUTO" }),
      }),
    );
  });

  it("crea AuditLog dentro del $transaction", async () => {
    await fetchBcvRateAction(COMPANY_ID);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityName: "ExchangeRate",
          action: "UPSERT",
          userId: USER_ID,
        }),
      }),
    );
  });

  it("retorna { success: false } si no hay sesión", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await fetchBcvRateAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna { success: false } si rate limit está agotado", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      error: "Demasiadas solicitudes. Intenta de nuevo en 30 segundos.",
    });
    const result = await fetchBcvRateAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas solicitudes");
  });

  it("retorna { success: false } si el usuario no es miembro de la empresa", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(null as never);
    const result = await fetchBcvRateAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Empresa no encontrada");
  });

  it("retorna { success: false } si BcvFetchService lanza error (API no disponible)", async () => {
    mockFetchUsdVes.mockRejectedValue(
      new Error("BcvFetchService: no se pudo contactar el endpoint BCV"),
    );
    const result = await fetchBcvRateAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("no se pudo contactar");
  });

  it("retorna { success: false } si companyId está vacío", async () => {
    const result = await fetchBcvRateAction("");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("companyId requerido");
  });

  it("no llama a BcvFetchService si el usuario no está autenticado", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    await fetchBcvRateAction(COMPANY_ID);
    expect(mockFetchUsdVes).not.toHaveBeenCalled();
  });
});

// ─── upsertExchangeRateAction (regresión — no debe romperse) ──────────────────
describe("upsertExchangeRateAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          exchangeRate: prisma.exchangeRate,
          auditLog: prisma.auditLog,
        })) as never,
    );
    vi.mocked(prisma.exchangeRate.upsert).mockResolvedValue(RATE_RECORD as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("retorna { success: true } con input válido", async () => {
    const result = await upsertExchangeRateAction({
      companyId: COMPANY_ID,
      currency: "USD",
      rate: "46.50",
      date: "2026-04-07",
      source: "BCV",
      createdBy: USER_ID,
    });
    expect(result.success).toBe(true);
  });

  it("retorna { success: false } con tasa inválida", async () => {
    const result = await upsertExchangeRateAction({
      companyId: COMPANY_ID,
      currency: "USD",
      rate: "no-es-un-numero",
      date: "2026-04-07",
      createdBy: USER_ID,
    });
    expect(result.success).toBe(false);
  });

  it("retorna { success: false } sin sesión", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await upsertExchangeRateAction({
      companyId: COMPANY_ID,
      currency: "USD",
      rate: "46.50",
      date: "2026-04-07",
      createdBy: USER_ID,
    });
    expect(result.success).toBe(false);
  });
});

// ─── listExchangeRatesAction ──────────────────────────────────────────────────
describe("listExchangeRatesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.exchangeRate.findMany).mockResolvedValue([RATE_RECORD] as never);
  });

  it("retorna lista cuando el usuario está autenticado", async () => {
    const result = await listExchangeRatesAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(1);
  });

  it("retorna { success: false } sin sesión", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await listExchangeRatesAction(COMPANY_ID);
    expect(result.success).toBe(false);
  });
});
