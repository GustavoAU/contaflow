// src/modules/fixed-assets/actions/fixed-asset.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const { mockMember, mockTransaction } = vi.hoisted(() => ({
  mockMember: { role: "ADMIN" as const },
  mockTransaction: vi.fn().mockImplementation(((fn: (tx: unknown) => unknown) => fn({})) as never),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user-test" }),
}));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {}, ocr: {} },
}));

vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi.fn().mockImplementation((_companyId, _tx, fn) => fn(_tx)),
}));

vi.mock("@/modules/fiscal-close/services/FiscalYearCloseService", () => ({
  FiscalYearCloseService: {
    isFiscalYearClosed: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("../services/FixedAssetService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/FixedAssetService")>();
  return {
    ...actual,
    FixedAssetService: {
      create: vi.fn().mockResolvedValue({ id: "asset-001" }),
      postMonthlyDepreciation: vi.fn().mockResolvedValue({ processed: 2, skipped: 0, errors: [] }),
      dispose: vi.fn().mockResolvedValue(undefined),
      getSummary: vi.fn().mockResolvedValue([]),
      getSchedule: vi.fn().mockResolvedValue({ asset: {}, projected: [], posted: [] }),
    },
  };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember:    { findFirst: vi.fn().mockResolvedValue(mockMember) },
    accountingPeriod: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    $transaction:     mockTransaction,
  },
}));

import {
  createFixedAssetAction,
  postMonthlyDepreciationAction,
  disposeFixedAssetAction,
  getFixedAssetsAction,
} from "./fixed-asset.actions";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { FiscalYearCloseService } from "@/modules/fiscal-close/services/FiscalYearCloseService";
import { FixedAssetService } from "../services/FixedAssetService";

const BASE_INPUT = {
  companyId: "company-001",
  name: "Vehículo Toyota",
  assetAccountId: "acc-asset",
  depreciationAccountId: "acc-dep-exp",
  accDepreciationAccountId: "acc-acc-dep",
  acquisitionDate: new Date("2026-01-01"),
  acquisitionCost: "50000.00",
  residualValue: "5000.00",
  usefulLifeMonths: 60,
  depreciationMethod: "LINEA_RECTA" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: "user-test" } as never);
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMember as never);
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) => fn({})) as never);
  vi.mocked(FiscalYearCloseService.isFiscalYearClosed).mockResolvedValue(false);
  vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.accountingPeriod.findMany).mockResolvedValue([]);
});

// ─── createFixedAssetAction ───────────────────────────────────────────────────

describe("createFixedAssetAction", () => {
  it("retorna error si no hay sesión", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await createFixedAssetAction(BASE_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("retorna error si no hay membresía", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const r = await createFixedAssetAction(BASE_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("acceso denegado");
  });

  it("retorna error si el rol es VIEWER (o no tiene acceso contable)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const r = await createFixedAssetAction(BASE_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/módulo contable|no autorizado/i);
  });

  it("retorna error si el año fiscal está cerrado", async () => {
    vi.mocked(FiscalYearCloseService.isFiscalYearClosed).mockResolvedValue(true);
    const r = await createFixedAssetAction(BASE_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("cerrado");
  });

  it("retorna error si el input es inválido (Zod)", async () => {
    const r = await createFixedAssetAction({ companyId: "" });
    expect(r.success).toBe(false);
  });

  it("happy path: retorna el id del activo creado", async () => {
    vi.mocked(FixedAssetService.create).mockResolvedValue({ id: "asset-001" } as never);
    const r = await createFixedAssetAction(BASE_INPUT);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("asset-001");
  });

  it("llama a FixedAssetService.create con los datos correctos", async () => {
    await createFixedAssetAction(BASE_INPUT);
    expect(FixedAssetService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Vehículo Toyota", companyId: "company-001" }),
      "user-test",
      expect.anything(),
    );
  });
});

// ─── postMonthlyDepreciationAction ────────────────────────────────────────────

describe("postMonthlyDepreciationAction", () => {
  const DEPR_INPUT = { companyId: "company-001", year: 2026, month: 3 };

  it("retorna error si no hay sesión", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await postMonthlyDepreciationAction(DEPR_INPUT);
    expect(r.success).toBe(false);
  });

  it("retorna error si año cerrado", async () => {
    vi.mocked(FiscalYearCloseService.isFiscalYearClosed).mockResolvedValue(true);
    const r = await postMonthlyDepreciationAction(DEPR_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("cerrado");
  });

  it("retorna error si el período mensual está cerrado (R-3)", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);
    const r = await postMonthlyDepreciationAction(DEPR_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("cerrado");
  });

  it("happy path: retorna resumen de procesados", async () => {
    vi.mocked(FixedAssetService.postMonthlyDepreciation).mockResolvedValue({
      processed: 3,
      skipped: 1,
      errors: [],
    });
    const r = await postMonthlyDepreciationAction(DEPR_INPUT);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.processed).toBe(3);
      expect(r.data.skipped).toBe(1);
    }
  });

  it("VIEWER no puede calcular depreciación", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const r = await postMonthlyDepreciationAction(DEPR_INPUT);
    expect(r.success).toBe(false);
  });
});

// ─── disposeFixedAssetAction ──────────────────────────────────────────────────

describe("disposeFixedAssetAction", () => {
  const DISPOSE_INPUT = {
    assetId:           "asset-001",
    companyId:         "company-001",
    disposalDate:      new Date("2026-04-01"),
    reason:            "OBSOLETE" as const,
    saleProceeds:      "0",
    proceedsAccountId: null,
    gainLossAccountId: null,
  };

  it("solo ADMIN puede dar de baja activos", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    const r = await disposeFixedAssetAction(DISPOSE_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("administrador");
  });

  it("retorna error si el año fiscal está cerrado (R-3)", async () => {
    vi.mocked(FiscalYearCloseService.isFiscalYearClosed).mockResolvedValue(true);
    const r = await disposeFixedAssetAction(DISPOSE_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("cerrado");
  });

  it("retorna error si el período mensual está cerrado (R-3)", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);
    const r = await disposeFixedAssetAction(DISPOSE_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("cerrado");
  });

  it("happy path: da de baja correctamente", async () => {
    vi.mocked(FixedAssetService.dispose).mockResolvedValue(undefined);
    const r = await disposeFixedAssetAction(DISPOSE_INPUT);
    expect(r.success).toBe(true);
  });

  it("retorna error si no hay sesión", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await disposeFixedAssetAction(DISPOSE_INPUT);
    expect(r.success).toBe(false);
  });
});

// ─── getFixedAssetsAction ─────────────────────────────────────────────────────

describe("getFixedAssetsAction", () => {
  it("retorna lista vacía si no hay activos", async () => {
    vi.mocked(FixedAssetService.getSummary).mockResolvedValue([]);
    const r = await getFixedAssetsAction("company-001");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual([]);
  });

  it("retorna error si no hay sesión", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await getFixedAssetsAction("company-001");
    expect(r.success).toBe(false);
  });

  it("retorna error si no hay membresía", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const r = await getFixedAssetsAction("company-001");
    expect(r.success).toBe(false);
  });
});
