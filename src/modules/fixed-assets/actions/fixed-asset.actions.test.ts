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
      getSchedule: vi.fn().mockResolvedValue({ asset: { name: "Vehículo Toyota" }, projected: [], posted: [] }),
      postDepreciation: vi.fn().mockResolvedValue({ created: true }),
      postClosedYearCatchUpDepreciation: vi.fn().mockResolvedValue({ processed: 0 }),
      postINPCRestatement: vi.fn().mockResolvedValue({ processed: 2, skipped: 0, totalAdjustment: { toFixed: () => "1200.00" } }),
      getGLReconciliation: vi.fn().mockResolvedValue([]),
      getINPCRestatementHistory: vi.fn().mockResolvedValue([]),
    },
    generateDepreciationSchedule: vi.fn().mockReturnValue([]),
  };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember:    { findFirst: vi.fn().mockResolvedValue(mockMember) },
    accountingPeriod: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    expense:          { findMany: vi.fn().mockResolvedValue([]) },
    fixedAsset:       { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    depreciationEntry: { findUnique: vi.fn().mockResolvedValue(null) },
    fiscalYearClose:  { findMany: vi.fn().mockResolvedValue([]) },
    $transaction:     mockTransaction,
  },
}));

import {
  createFixedAssetAction,
  postMonthlyDepreciationAction,
  disposeFixedAssetAction,
  getFixedAssetsAction,
  getDepreciationScheduleAction,
  catchUpAssetDepreciationAction,
  catchUpAllAssetsDepreciationAction,
  previewDepreciationScheduleAction,
  postFixedAssetINPCRestatementAction,
  getFixedAssetGLReconciliationAction,
  getFixedAssetINPCHistoryAction,
  getExpensesForAssetImportAction,
} from "./fixed-asset.actions";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/ratelimit";
import { FiscalYearCloseService } from "@/modules/fiscal-close/services/FiscalYearCloseService";
import { FixedAssetService, generateDepreciationSchedule } from "../services/FixedAssetService";

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
  vi.mocked(prisma.fixedAsset.findMany).mockResolvedValue([]);
  vi.mocked(prisma.fixedAsset.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.fiscalYearClose.findMany).mockResolvedValue([]);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true });
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

  it("hallazgo #8: pasa acquisitionCounterpartAccountId a FixedAssetService.create", async () => {
    const inputWithCounterpart = { ...BASE_INPUT, acquisitionCounterpartAccountId: "acc-cxp-001" };
    await createFixedAssetAction(inputWithCounterpart);
    expect(FixedAssetService.create).toHaveBeenCalledWith(
      expect.objectContaining({ acquisitionCounterpartAccountId: "acc-cxp-001" }),
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

  it("Art. 66 LIVA — pasa applyArt66, ivaCFAccountId y art66ExpenseAccountId al service (server recalcula monto — N1)", async () => {
    vi.mocked(FixedAssetService.dispose).mockResolvedValue(undefined);
    const r = await disposeFixedAssetAction({
      ...DISPOSE_INPUT,
      applyArt66:            true,
      art66ExpenseAccountId: "acc-gasto-iva-reintegro",
      ivaCFAccountId:        "acc-iva-cf",
    });
    expect(r.success).toBe(true);
    expect(vi.mocked(FixedAssetService.dispose)).toHaveBeenCalledWith(
      expect.objectContaining({
        applyArt66:            true,
        art66ExpenseAccountId: "acc-gasto-iva-reintegro",
        ivaCFAccountId:        "acc-iva-cf",
      }),
      expect.any(String),
      expect.anything(),
    );
  });

  it("Art. 66 LIVA — sin applyArt66 no pasa campos al service", async () => {
    vi.mocked(FixedAssetService.dispose).mockResolvedValue(undefined);
    const r = await disposeFixedAssetAction({ ...DISPOSE_INPUT });
    expect(r.success).toBe(true);
    expect(vi.mocked(FixedAssetService.dispose)).toHaveBeenCalledWith(
      expect.objectContaining({ applyArt66: false }),
      expect.any(String),
      expect.anything(),
    );
  });
});

// ─── postFixedAssetINPCRestatementAction ──────────────────────────────────────

describe("postFixedAssetINPCRestatementAction", () => {
  const INPC_INPUT = {
    companyId:           "company-001",
    periodYear:          2026,
    periodMonth:         3,
    patrimonioAccountId: "acc-patrimonio",
  };

  it("retorna error si no hay sesión", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await postFixedAssetINPCRestatementAction(INPC_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("retorna error si no hay membresía", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const r = await postFixedAssetINPCRestatementAction(INPC_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("acceso denegado");
  });

  it("VIEWER no puede generar reajuste INPC", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const r = await postFixedAssetINPCRestatementAction(INPC_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("contable");
  });

  it("retorna error si el año fiscal está cerrado (R-3)", async () => {
    vi.mocked(FiscalYearCloseService.isFiscalYearClosed).mockResolvedValue(true);
    const r = await postFixedAssetINPCRestatementAction(INPC_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("cerrado");
  });

  it("retorna error si el período mensual está cerrado (R-3)", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);
    const r = await postFixedAssetINPCRestatementAction(INPC_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("cerrado");
  });

  it("retorna error si input inválido (Zod)", async () => {
    const r = await postFixedAssetINPCRestatementAction({ companyId: "", periodYear: 2026, periodMonth: 3 });
    expect(r.success).toBe(false);
  });

  it("happy path: retorna resumen de activos ajustados", async () => {
    vi.mocked(FixedAssetService.postINPCRestatement).mockResolvedValue({
      processed: 3,
      skipped: 1,
      totalAdjustment: { toFixed: () => "2500.00" } as never,
    });
    const r = await postFixedAssetINPCRestatementAction(INPC_INPUT);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.processed).toBe(3);
      expect(r.data.skipped).toBe(1);
      expect(r.data.totalAdjustment).toBe("2500.00");
    }
  });
});

// ─── getFixedAssetGLReconciliationAction ──────────────────────────────────────

describe("getFixedAssetGLReconciliationAction", () => {
  it("retorna error si no hay sesión", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await getFixedAssetGLReconciliationAction("company-001");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("retorna error si no hay membresía", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const r = await getFixedAssetGLReconciliationAction("company-001");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("acceso denegado");
  });

  it("VIEWER no puede ejecutar la conciliación", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const r = await getFixedAssetGLReconciliationAction("company-001");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("contable");
  });

  it("happy path — sin activos: retorna array vacío", async () => {
    vi.mocked(FixedAssetService.getGLReconciliation).mockResolvedValue([]);
    const r = await getFixedAssetGLReconciliationAction("company-001");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual([]);
  });

  it("happy path — retorna filas serializadas con difference cuadrado", async () => {
    const { Decimal } = await import("decimal.js");
    vi.mocked(FixedAssetService.getGLReconciliation).mockResolvedValue([
      {
        accDepreciationAccountId: "acc-contra",
        accountCode:  "1.5.1",
        accountName:  "Dep. Acumulada Vehículos",
        moduleTotal:  new Decimal("1500.00"),
        glTotal:      new Decimal("1500.00"),
        difference:   new Decimal("0.00"),
        assetCount:   2,
      },
    ] as never);
    const r = await getFixedAssetGLReconciliationAction("company-001");
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0]!.moduleTotal).toBe("1500.00");
      expect(r.data[0]!.glTotal).toBe("1500.00");
      expect(r.data[0]!.difference).toBe("0.00");
      expect(r.data[0]!.assetCount).toBe(2);
    }
  });

  it("happy path — detecta diferencia GL vs. módulo", async () => {
    const { Decimal } = await import("decimal.js");
    vi.mocked(FixedAssetService.getGLReconciliation).mockResolvedValue([
      {
        accDepreciationAccountId: "acc-contra",
        accountCode:  "1.5.1",
        accountName:  "Dep. Acumulada",
        moduleTotal:  new Decimal("1000.00"),
        glTotal:      new Decimal("1250.00"),
        difference:   new Decimal("250.00"),
        assetCount:   1,
      },
    ] as never);
    const r = await getFixedAssetGLReconciliationAction("company-001");
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data[0]!.difference).toBe("250.00");
    }
  });
});

// ─── getFixedAssetINPCHistoryAction (N3) ─────────────────────────────────────

describe("getFixedAssetINPCHistoryAction", () => {
  it("retorna error si no hay sesión", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await getFixedAssetINPCHistoryAction("company-001");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("VIEWER no puede acceder al historial INPC", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const r = await getFixedAssetINPCHistoryAction("company-001");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("contable");
  });

  it("happy path — sin historial: retorna array vacío", async () => {
    vi.mocked(FixedAssetService.getINPCRestatementHistory).mockResolvedValue([]);
    const r = await getFixedAssetINPCHistoryAction("company-001");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual([]);
  });

  it("happy path — retorna filas serializadas correctamente", async () => {
    const { Decimal } = await import("decimal.js");
    vi.mocked(FixedAssetService.getINPCRestatementHistory).mockResolvedValue([
      {
        id:                "restatement-001",
        assetId:           "asset-001",
        assetName:         "Vehículo Toyota",
        inpcPeriodYear:    2026,
        inpcPeriodMonth:   3,
        factor:            new Decimal("1.524300"),
        adjustmentAmount:  new Decimal("3000.00"),
        previousBookValue: new Decimal("20000.00"),
        newRestatedValue:  new Decimal("23000.00"),
        equityAccountId:   "acc-patrimonio",
        transactionId:     "tx-001-asset-001",
        createdAt:         new Date("2026-03-31T12:00:00Z"),
      },
    ] as never);
    const r = await getFixedAssetINPCHistoryAction("company-001", "asset-001");
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0]!.assetName).toBe("Vehículo Toyota");
      expect(r.data[0]!.adjustmentAmount).toBe("3000.00");
      expect(r.data[0]!.factor).toBe("1.524300");
    }
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

// ─── getExpensesForAssetImportAction (N4) ─────────────────────────────────────

describe("getExpensesForAssetImportAction", () => {
  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-test" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMember as never);
    vi.mocked(prisma.expense.findMany).mockResolvedValue([] as never);
  });

  it("retorna error si no hay sesión", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await getExpensesForAssetImportAction("company-001");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("VIEWER no puede listar gastos para importar", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const r = await getExpensesForAssetImportAction("company-001");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("contable");
  });

  it("happy path — sin gastos: retorna array vacío", async () => {
    vi.mocked(prisma.expense.findMany).mockResolvedValue([] as never);
    const r = await getExpensesForAssetImportAction("company-001");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual([]);
  });

  it("happy path — serializa campos de proveedor correctamente", async () => {
    const { Decimal } = await import("decimal.js");
    vi.mocked(prisma.expense.findMany).mockResolvedValue([
      {
        id:            "exp-001",
        concept:       "Compra Vehículo Toyota Hilux",
        amount:        new Decimal("50000.00"),
        currency:      "USD",
        invoiceNumber: "00-000123",
        invoiceDate:   new Date("2026-01-15"),
        supplierName:  null,
        vendor:        { name: "Importadora Toyota", rif: "J-12345678-9" },
      },
    ] as never);
    const r = await getExpensesForAssetImportAction("company-001");
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0]!.concept).toBe("Compra Vehículo Toyota Hilux");
      expect(r.data[0]!.amount).toBe("50000.00");
      expect(r.data[0]!.currency).toBe("USD");
      expect(r.data[0]!.invoiceNumber).toBe("00-000123");
      expect(r.data[0]!.invoiceDate).toBe("2026-01-15");
      expect(r.data[0]!.vendorName).toBe("Importadora Toyota");
      expect(r.data[0]!.vendorRif).toBe("J-12345678-9");
    }
  });

  it("usa supplierName cuando no hay vendor vinculado", async () => {
    const { Decimal } = await import("decimal.js");
    vi.mocked(prisma.expense.findMany).mockResolvedValue([
      {
        id:            "exp-002",
        concept:       "Equipo de oficina",
        amount:        new Decimal("1500.00"),
        currency:      "VES",
        invoiceNumber: null,
        invoiceDate:   null,
        supplierName:  "Tienda Genérica",
        vendor:        null,
      },
    ] as never);
    const r = await getExpensesForAssetImportAction("company-001");
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data[0]!.vendorName).toBe("Tienda Genérica");
      expect(r.data[0]!.vendorRif).toBeNull();
      expect(r.data[0]!.invoiceDate).toBeNull();
    }
  });
});

// ─── getDepreciationScheduleAction ───────────────────────────────────────────

describe("getDepreciationScheduleAction", () => {
  it("retorna error si no hay sesión", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await getDepreciationScheduleAction("asset-001", "company-001");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("retorna error si no hay membresía", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const r = await getDepreciationScheduleAction("asset-001", "company-001");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("acceso denegado");
  });

  it("happy path — retorna tabla de depreciación serializada", async () => {
    const { Decimal } = await import("decimal.js");
    vi.mocked(FixedAssetService.getSchedule).mockResolvedValue({
      asset: { name: "Vehículo Toyota" },
      projected: [
        { year: 2026, month: 2, amount: new Decimal("750.00"), accumulated: new Decimal("750.00"), bookValue: new Decimal("49250.00") },
      ],
      posted: [{ periodYear: 2026, periodMonth: 1 }],
    } as never);
    const r = await getDepreciationScheduleAction("asset-001", "company-001");
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.asset.name).toBe("Vehículo Toyota");
      expect(r.data.projected).toHaveLength(1);
      expect(r.data.projected[0]!.amount).toBe("750.00");
      expect(r.data.posted).toHaveLength(1);
    }
  });
});

// ─── previewDepreciationScheduleAction ───────────────────────────────────────

describe("previewDepreciationScheduleAction", () => {
  const PREVIEW_INPUT = {
    acquisitionCost: "50000.00",
    residualValue: "5000.00",
    usefulLifeMonths: 60,
    depreciationMethod: "LINEA_RECTA" as const,
    acquisitionDate: new Date("2026-01-01"),
  };

  it("retorna error si no hay sesión", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await previewDepreciationScheduleAction(PREVIEW_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("retorna error si rate limit agotado", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, error: "Demasiadas solicitudes." });
    const r = await previewDepreciationScheduleAction(PREVIEW_INPUT);
    expect(r.success).toBe(false);
  });

  it("happy path — delega a generateDepreciationSchedule y retorna resultado", async () => {
    vi.mocked(generateDepreciationSchedule).mockReturnValue([{ year: 2026, month: 2 }] as never);
    const r = await previewDepreciationScheduleAction(PREVIEW_INPUT);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveLength(1);
    expect(generateDepreciationSchedule).toHaveBeenCalled();
  });
});

// ─── catchUpAssetDepreciationAction ──────────────────────────────────────────

describe("catchUpAssetDepreciationAction", () => {
  const ASSET_ROW = {
    id: "asset-001",
    status: "ACTIVE",
    acquisitionDate: new Date("2025-01-01"),
    name: "Vehículo Toyota",
  };

  const CATCH_UP_INPUT = { assetId: "asset-001", companyId: "company-001" };

  beforeEach(() => {
    vi.mocked(prisma.fixedAsset.findFirst).mockResolvedValue(ASSET_ROW as never);
  });

  it("retorna error si no hay sesión", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await catchUpAssetDepreciationAction(CATCH_UP_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("retorna error si activo no encontrado", async () => {
    vi.mocked(prisma.fixedAsset.findFirst).mockResolvedValue(null);
    const r = await catchUpAssetDepreciationAction(CATCH_UP_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("no encontrado");
  });

  it("retorna error si activo no está ACTIVE", async () => {
    vi.mocked(prisma.fixedAsset.findFirst).mockResolvedValue({ ...ASSET_ROW, status: "DISPOSED" } as never);
    const r = await catchUpAssetDepreciationAction(CATCH_UP_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("activo");
  });

  it("VIEWER no puede ejecutar catch-up", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const r = await catchUpAssetDepreciationAction(CATCH_UP_INPUT);
    expect(r.success).toBe(false);
  });

  it("happy path — sin períodos abiertos: retorna processed >= 0", async () => {
    vi.mocked(FixedAssetService.postDepreciation).mockResolvedValue({ created: true } as never);
    const r = await catchUpAssetDepreciationAction(CATCH_UP_INPUT);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(typeof r.data.processed).toBe("number");
      expect(Array.isArray(r.data.errors)).toBe(true);
    }
  });
});

// ─── catchUpAllAssetsDepreciationAction ──────────────────────────────────────

describe("catchUpAllAssetsDepreciationAction", () => {
  const ALL_INPUT = { companyId: "company-001" };

  it("retorna error si no hay sesión", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await catchUpAllAssetsDepreciationAction(ALL_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("VIEWER no puede ejecutar catch-up masivo", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const r = await catchUpAllAssetsDepreciationAction(ALL_INPUT);
    expect(r.success).toBe(false);
  });

  it("happy path — sin activos activos: retorna ceros", async () => {
    vi.mocked(prisma.fixedAsset.findMany).mockResolvedValue([]);
    const r = await catchUpAllAssetsDepreciationAction(ALL_INPUT);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.totalProcessed).toBe(0);
      expect(r.data.totalSkipped).toBe(0);
      expect(r.data.assetErrors).toEqual({});
    }
  });

  it("retorna error si input inválido (Zod)", async () => {
    const r = await catchUpAllAssetsDepreciationAction({ companyId: "" });
    expect(r.success).toBe(false);
  });
});
