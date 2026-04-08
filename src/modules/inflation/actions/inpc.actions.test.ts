// src/modules/inflation/actions/inpc.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockMember, mockTransaction } = vi.hoisted(() => ({
  mockMember: { role: "ADMIN" as const },
  mockTransaction: vi.fn().mockImplementation(((fn: (tx: unknown) => unknown) => fn({})) as never),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn().mockResolvedValue({ userId: "user_1" }) }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {}, ocr: {} },
}));
vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi.fn().mockImplementation(
    (_id: string, _tx: unknown, fn: (tx: unknown) => unknown) => fn({}),
  ),
}));
vi.mock("@/modules/fiscal-close/services/FiscalYearCloseService", () => ({
  FiscalYearCloseService: {
    isFiscalYearClosed: vi.fn().mockResolvedValue(false),
  },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: {
      findFirst: vi.fn().mockResolvedValue(mockMember),
    },
    $transaction: mockTransaction,
  },
}));

vi.mock("../services/INPCService", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/INPCService")>();
  return {
    ...original,
    INPCService: {
      upsertRate: vi.fn().mockResolvedValue({ id: "rate_1" }),
      getRates: vi.fn().mockResolvedValue([]),
      setInflationBase: vi.fn().mockResolvedValue(undefined),
      previewAdjustment: vi.fn().mockResolvedValue([]),
      runAdjustment: vi.fn().mockResolvedValue({
        adjustedAccounts: 3,
        totalAdjustment: new Decimal("1500.00"),
        transactionId: "tx_1",
        factor: new Decimal("1.15"),
      }),
    },
  };
});

import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { FiscalYearCloseService } from "@/modules/fiscal-close/services/FiscalYearCloseService";
import {
  upsertINPCRateAction,
  getINPCRatesAction,
  setInflationBaseAction,
  previewInflationAdjustmentAction,
  runInflationAdjustmentAction,
} from "./inpc.actions";

beforeEach(() => {
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) => fn({})) as never);
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMember as never);
});

// ─── upsertINPCRateAction ─────────────────────────────────────────────────────

describe("upsertINPCRateAction", () => {
  const validInput = { companyId: "co_1", year: 2026, month: 3, indexValue: "1850.50" };

  it("retorna éxito con id de rate", async () => {
    const r = await upsertINPCRateAction(validInput);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.id).toBe("rate_1");
  });

  it("falla si no está autenticado", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as never);
    const r = await upsertINPCRateAction(validInput);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("falla si role es VIEWER", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValueOnce({ role: "VIEWER" } as never);
    const r = await upsertINPCRateAction(validInput);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("falla con indexValue inválido (0)", async () => {
    const r = await upsertINPCRateAction({ ...validInput, indexValue: "0" });
    expect(r.success).toBe(false);
  });

  it("falla con mes fuera de rango", async () => {
    const r = await upsertINPCRateAction({ ...validInput, month: 13 });
    expect(r.success).toBe(false);
  });
});

// ─── getINPCRatesAction ───────────────────────────────────────────────────────

describe("getINPCRatesAction", () => {
  it("retorna lista vacía cuando no hay índices", async () => {
    const r = await getINPCRatesAction("co_1");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual([]);
  });

  it("falla si no es miembro de la empresa", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValueOnce(null);
    const r = await getINPCRatesAction("co_1");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/acceso denegado/);
  });
});

// ─── setInflationBaseAction ───────────────────────────────────────────────────

describe("setInflationBaseAction", () => {
  const validInput = { companyId: "co_1", inflationBaseYear: 2022, inflationBaseMonth: 1 };

  it("retorna éxito para ADMIN", async () => {
    const r = await setInflationBaseAction(validInput);
    expect(r.success).toBe(true);
  });

  it("falla si role no es ADMIN", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValueOnce({ role: "ACCOUNTANT" } as never);
    const r = await setInflationBaseAction(validInput);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/administradores/);
  });
});

// ─── previewInflationAdjustmentAction ────────────────────────────────────────

describe("previewInflationAdjustmentAction", () => {
  const validInput = {
    companyId: "co_1",
    periodYear: 2026,
    periodMonth: 3,
    adjustmentAccountId: "acc_adjust",
  };

  it("retorna preview vacío cuando no hay cuentas con saldo", async () => {
    const r = await previewInflationAdjustmentAction(validInput);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual([]);
  });

  it("falla si no está autenticado", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as never);
    const r = await previewInflationAdjustmentAction(validInput);
    expect(r.success).toBe(false);
  });
});

// ─── runInflationAdjustmentAction ─────────────────────────────────────────────

describe("runInflationAdjustmentAction", () => {
  const validInput = {
    companyId: "co_1",
    periodYear: 2026,
    periodMonth: 3,
    adjustmentAccountId: "acc_adjust",
  };

  it("retorna sumario del ajuste ejecutado", async () => {
    const r = await runInflationAdjustmentAction(validInput);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.adjustedAccounts).toBe(3);
      expect(r.data.transactionId).toBe("tx_1");
    }
  });

  it("falla si role no es ADMIN", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValueOnce({ role: "ACCOUNTANT" } as never);
    const r = await runInflationAdjustmentAction(validInput);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/administradores/);
  });

  it("falla si el año fiscal está cerrado (guard FiscalYearClose)", async () => {
    vi.mocked(FiscalYearCloseService.isFiscalYearClosed).mockResolvedValueOnce(true);
    const r = await runInflationAdjustmentAction(validInput);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/cerrado/);
  });

  it("falla con input inválido (sin adjustmentAccountId)", async () => {
    const r = await runInflationAdjustmentAction({ ...validInput, adjustmentAccountId: "" });
    expect(r.success).toBe(false);
  });
});
