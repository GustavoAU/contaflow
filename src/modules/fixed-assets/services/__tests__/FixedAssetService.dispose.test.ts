// src/modules/fixed-assets/services/__tests__/FixedAssetService.dispose.test.ts
// Tests for FixedAssetService.dispose() — covers N1 (R-5 Art.66 recalc) and account fix.
// No @vitest-environment jsdom — server-side logic only.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import { FixedAssetService } from "../FixedAssetService";

// ─── Canonical tx mock ──────────────────────────────────────────────────────

function makeMockTx() {
  return {
    fixedAsset: {
      findFirstOrThrow: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    depreciationEntry: {
      aggregate: vi.fn(),
    },
    transaction: {
      create: vi.fn().mockResolvedValue({ id: "tx-1" }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

// ─── Helper: build a base FixedAsset record ─────────────────────────────────

function makeAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset-1",
    companyId: "company-1",
    name: "Equipo de Cómputo",
    status: "ACTIVE",
    acquisitionCost: new Decimal("1500"),
    residualValue: new Decimal("0"),
    usefulLifeMonths: 60,
    depreciationMethod: "LINEA_RECTA",
    assetAccountId: "acc-asset",
    depreciationAccountId: "acc-dep-expense",
    accDepreciationAccountId: "acc-dep-accumulated",
    acquisitionDate: new Date("2024-06-01"), // used in Art.66 tests
    totalUnits: null,
    ...overrides,
  };
}

// ─── Base input factory ──────────────────────────────────────────────────────

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    assetId: "asset-1",
    companyId: "company-1",
    disposalDate: new Date("2025-06-01"),
    reason: "OBSOLETE" as const,
    saleProceeds: "0",
    proceedsAccountId: null,
    gainLossAccountId: null,
    notes: null,
    applyIva: false,
    ivaDFAccountId: null,
    applyArt66: false,
    art66ExpenseAccountId: null,
    ivaCFAccountId: null,
    ...overrides,
  };
}

const USER_ID = "user-test";

// ────────────────────────────────────────────────────────────────────────────
// Suite 1 — Art. 66 recalculates server-side (R-5 / D-3)
// ────────────────────────────────────────────────────────────────────────────
describe("FixedAssetService.dispose — Art. 66 LIVA recalc server-side (N1 / R-5)", () => {
  let mockTx: ReturnType<typeof makeMockTx>;

  beforeEach(() => {
    mockTx = makeMockTx();
    // Asset acquired 2024-06-01, disposed 2025-06-01 → 12 months used
    mockTx.fixedAsset.findFirstOrThrow.mockResolvedValue(
      makeAsset({ acquisitionDate: new Date("2024-06-01") })
    );
    // No prior depreciation
    mockTx.depreciationEntry.aggregate.mockResolvedValue({ _sum: { amount: null } });
  });

  it("calculates Art.66 reintegro using server-side Decimal.js, not client value", async () => {
    // cost=1500, used=12 months, 16%, reintegro = 1500 × 0.16 × (36-12)/36 = 160.00
    const input = makeInput({
      disposalDate: new Date("2025-06-01"),
      applyArt66: true,
      art66ExpenseAccountId: "acc-art66-expense",
      ivaCFAccountId: "acc-iva-cf",
    });

    await FixedAssetService.dispose(input, USER_ID, mockTx as never);

    const createCall = mockTx.transaction.create.mock.calls[0]![0];
    const entries: { accountId: string; amount: Decimal; description: string }[] =
      createCall.data.entries.create;

    // Find Art.66 expense entry (positive DEBE)
    const art66DebeEntry = entries.find(
      (e) => e.accountId === "acc-art66-expense" && e.description.includes("Art. 66")
    );
    const art66HaberEntry = entries.find(
      (e) => e.accountId === "acc-iva-cf" && e.description.includes("Art. 66")
    );

    expect(art66DebeEntry).toBeDefined();
    expect(art66HaberEntry).toBeDefined();

    // 1500 × 0.16 × (36−12)/36 = 1500 × 0.16 × 0.6667 = 160.00
    const expectedArt66 = new Decimal("160.00");
    expect(new Decimal(art66DebeEntry!.amount.toString()).equals(expectedArt66)).toBe(true);
    expect(new Decimal(art66HaberEntry!.amount.toString()).equals(expectedArt66.negated())).toBe(
      true
    );
  });

  it("ignores any ivaRate-like field the client could have sent — rate is hardcoded 16%", async () => {
    // The schema no longer accepts ivaRate, but we verify the service computes 16% regardless.
    // cost=1000, 12 months used → reintegro = 1000 × 0.16 × (24/36) = 106.67
    mockTx.fixedAsset.findFirstOrThrow.mockResolvedValue(
      makeAsset({ acquisitionCost: new Decimal("1000"), acquisitionDate: new Date("2024-06-01") })
    );

    const input = makeInput({
      disposalDate: new Date("2025-06-01"),
      applyArt66: true,
      art66ExpenseAccountId: "acc-art66-expense",
      ivaCFAccountId: "acc-iva-cf",
    });

    await FixedAssetService.dispose(input, USER_ID, mockTx as never);

    const createCall = mockTx.transaction.create.mock.calls[0]![0];
    const entries: { accountId: string; amount: Decimal; description: string }[] =
      createCall.data.entries.create;

    const art66DebeEntry = entries.find(
      (e) => e.accountId === "acc-art66-expense" && e.description.includes("Art. 66")
    );

    expect(art66DebeEntry).toBeDefined();
    // 1000 × 0.16 × (36-12)/36 = 1000 × 0.16 × (24/36) = 106.67
    const expected = new Decimal("1000")
      .times(new Decimal("0.16"))
      .times(new Decimal(24).dividedBy(new Decimal(36)))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    expect(new Decimal(art66DebeEntry!.amount.toString()).equals(expected)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Suite 2 — Art. 66 HABER uses ivaCFAccountId (N1 — account correction)
// ────────────────────────────────────────────────────────────────────────────
describe("FixedAssetService.dispose — Art. 66 HABER must use ivaCFAccountId", () => {
  let mockTx: ReturnType<typeof makeMockTx>;

  beforeEach(() => {
    mockTx = makeMockTx();
    mockTx.fixedAsset.findFirstOrThrow.mockResolvedValue(
      makeAsset({ acquisitionDate: new Date("2024-01-01") })
    );
    mockTx.depreciationEntry.aggregate.mockResolvedValue({ _sum: { amount: null } });
  });

  it("Art.66 credit entry uses ivaCFAccountId (Crédito Fiscal ASSET), not ivaDFAccountId", async () => {
    const input = makeInput({
      disposalDate: new Date("2025-01-01"), // 12 months used
      applyArt66: true,
      art66ExpenseAccountId: "acc-art66-expense",
      ivaCFAccountId: "acc-iva-credito-fiscal-1234",
      ivaDFAccountId: "acc-iva-debito-fiscal-5678", // D-3 violation field — should NOT appear in Art.66 HABER
    });

    await FixedAssetService.dispose(input, USER_ID, mockTx as never);

    const createCall = mockTx.transaction.create.mock.calls[0]![0];
    const entries: { accountId: string; amount: Decimal; description: string }[] =
      createCall.data.entries.create;

    const art66Entries = entries.filter((e) => e.description.includes("Art. 66"));
    expect(art66Entries).toHaveLength(2);

    const haberEntry = art66Entries.find((e) => new Decimal(e.amount.toString()).lessThan(0));
    expect(haberEntry).toBeDefined();
    // HABER must use ivaCFAccountId (ASSET account), NOT ivaDFAccountId (LIABILITY)
    expect(haberEntry!.accountId).toBe("acc-iva-credito-fiscal-1234");
    expect(haberEntry!.accountId).not.toBe("acc-iva-debito-fiscal-5678");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Suite 3 — Art. 66 = 0 when months used >= 36
// ────────────────────────────────────────────────────────────────────────────
describe("FixedAssetService.dispose — Art. 66 zero when meses >= 36", () => {
  let mockTx: ReturnType<typeof makeMockTx>;

  beforeEach(() => {
    mockTx = makeMockTx();
    // Asset acquired exactly 36 months before disposal
    mockTx.fixedAsset.findFirstOrThrow.mockResolvedValue(
      makeAsset({ acquisitionDate: new Date("2022-06-01") })
    );
    mockTx.depreciationEntry.aggregate.mockResolvedValue({ _sum: { amount: null } });
  });

  it("does NOT generate Art. 66 GL entries when meses used >= 36", async () => {
    const input = makeInput({
      disposalDate: new Date("2025-06-01"), // exactly 36 months after 2022-06-01
      applyArt66: true,
      art66ExpenseAccountId: "acc-art66-expense",
      ivaCFAccountId: "acc-iva-cf",
    });

    await FixedAssetService.dispose(input, USER_ID, mockTx as never);

    const createCall = mockTx.transaction.create.mock.calls[0]![0];
    const entries: { accountId: string; amount: Decimal; description: string }[] =
      createCall.data.entries.create;

    const art66Entries = entries.filter((e) => e.description.includes("Art. 66"));
    expect(art66Entries).toHaveLength(0);
  });

  it("does NOT generate Art. 66 GL entries when meses used > 36 (e.g. 48 months)", async () => {
    mockTx.fixedAsset.findFirstOrThrow.mockResolvedValue(
      makeAsset({ acquisitionDate: new Date("2021-06-01") })
    );

    const input = makeInput({
      disposalDate: new Date("2025-06-01"), // 48 months after 2021-06-01
      applyArt66: true,
      art66ExpenseAccountId: "acc-art66-expense",
      ivaCFAccountId: "acc-iva-cf",
    });

    await FixedAssetService.dispose(input, USER_ID, mockTx as never);

    const createCall = mockTx.transaction.create.mock.calls[0]![0];
    const entries: { accountId: string; amount: Decimal; description: string }[] =
      createCall.data.entries.create;

    const art66Entries = entries.filter((e) => e.description.includes("Art. 66"));
    expect(art66Entries).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Suite 4 — ivaAmount uses IVA_GENERAL_RATE = 16% (not from client)
// ────────────────────────────────────────────────────────────────────────────
describe("FixedAssetService.dispose — IVA on sale uses hardcoded 16% (R-5 / D-3)", () => {
  let mockTx: ReturnType<typeof makeMockTx>;

  beforeEach(() => {
    mockTx = makeMockTx();
    mockTx.fixedAsset.findFirstOrThrow.mockResolvedValue(makeAsset());
    mockTx.depreciationEntry.aggregate.mockResolvedValue({ _sum: { amount: null } });
  });

  it("IVA = 160.00 for saleProceeds=1000, hardcoded 16% regardless of any ivaRate field", async () => {
    const input = makeInput({
      reason: "SALE" as const,
      saleProceeds: "1000",
      proceedsAccountId: "acc-bank",
      applyIva: true,
      ivaDFAccountId: "acc-iva-df",
    });

    await FixedAssetService.dispose(input, USER_ID, mockTx as never);

    const createCall = mockTx.transaction.create.mock.calls[0]![0];
    const entries: { accountId: string; amount: Decimal; description: string }[] =
      createCall.data.entries.create;

    // IVA DF entry: accountId=acc-iva-df, amount=-160.00 (HABER)
    const ivaEntry = entries.find(
      (e) => e.accountId === "acc-iva-df" && e.description.includes("IVA")
    );
    expect(ivaEntry).toBeDefined();
    expect(new Decimal(ivaEntry!.amount.toString()).equals(new Decimal("-160.00"))).toBe(true);
  });

  it("proceeds account receives total = saleProceeds + IVA = 1000 + 160 = 1160", async () => {
    const input = makeInput({
      reason: "SALE" as const,
      saleProceeds: "1000",
      proceedsAccountId: "acc-bank",
      applyIva: true,
      ivaDFAccountId: "acc-iva-df",
    });

    await FixedAssetService.dispose(input, USER_ID, mockTx as never);

    const createCall = mockTx.transaction.create.mock.calls[0]![0];
    const entries: { accountId: string; amount: Decimal; description: string }[] =
      createCall.data.entries.create;

    const bankEntry = entries.find((e) => e.accountId === "acc-bank");
    expect(bankEntry).toBeDefined();
    // Bank receives price + IVA
    expect(new Decimal(bankEntry!.amount.toString()).equals(new Decimal("1160.00"))).toBe(true);
  });

  it("IVA is not applied when reason is not SALE (applyIva=true but reason=OBSOLETE)", async () => {
    const input = makeInput({
      reason: "OBSOLETE" as const,
      saleProceeds: "1000",
      proceedsAccountId: "acc-bank",
      applyIva: true, // guarded by reason === 'SALE' in service
      ivaDFAccountId: "acc-iva-df",
    });

    await FixedAssetService.dispose(input, USER_ID, mockTx as never);

    const createCall = mockTx.transaction.create.mock.calls[0]![0];
    const entries: { accountId: string; amount: Decimal; description: string }[] =
      createCall.data.entries.create;

    const ivaEntry = entries.find(
      (e) => e.accountId === "acc-iva-df" && e.description.includes("IVA")
    );
    expect(ivaEntry).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Suite 5 — Baseline / guard behaviors
// ────────────────────────────────────────────────────────────────────────────
describe("FixedAssetService.dispose — baseline guards", () => {
  let mockTx: ReturnType<typeof makeMockTx>;

  beforeEach(() => {
    mockTx = makeMockTx();
  });

  it("throws when asset is already DISPOSED", async () => {
    mockTx.fixedAsset.findFirstOrThrow.mockResolvedValue(makeAsset({ status: "DISPOSED" }));
    mockTx.depreciationEntry.aggregate.mockResolvedValue({ _sum: { amount: null } });

    await expect(
      FixedAssetService.dispose(makeInput(), USER_ID, mockTx as never)
    ).rejects.toThrow("El activo ya fue dado de baja");
  });

  it("marks asset status as DISPOSED after successful baja", async () => {
    mockTx.fixedAsset.findFirstOrThrow.mockResolvedValue(makeAsset());
    mockTx.depreciationEntry.aggregate.mockResolvedValue({ _sum: { amount: null } });

    await FixedAssetService.dispose(makeInput(), USER_ID, mockTx as never);

    expect(mockTx.fixedAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "asset-1" },
        data: expect.objectContaining({ status: "DISPOSED" }),
      })
    );
  });

  it("creates AuditLog with status=DISPOSED and gainLoss in the same call", async () => {
    mockTx.fixedAsset.findFirstOrThrow.mockResolvedValue(makeAsset());
    mockTx.depreciationEntry.aggregate.mockResolvedValue({ _sum: { amount: null } });

    await FixedAssetService.dispose(makeInput(), USER_ID, mockTx as never);

    expect(mockTx.auditLog.create).toHaveBeenCalledOnce();
    const auditCall = mockTx.auditLog.create.mock.calls[0]![0];
    expect(auditCall.data.newValue.status).toBe("DISPOSED");
  });

  it("GL asset cost entry is always the cost negated (HABER)", async () => {
    mockTx.fixedAsset.findFirstOrThrow.mockResolvedValue(
      makeAsset({ acquisitionCost: new Decimal("5000") })
    );
    mockTx.depreciationEntry.aggregate.mockResolvedValue({ _sum: { amount: null } });

    await FixedAssetService.dispose(makeInput(), USER_ID, mockTx as never);

    const createCall = mockTx.transaction.create.mock.calls[0]![0];
    const entries: { accountId: string; amount: Decimal; description: string }[] =
      createCall.data.entries.create;

    const costEntry = entries.find(
      (e) =>
        e.accountId === "acc-asset" && e.description.includes("costo histórico")
    );
    expect(costEntry).toBeDefined();
    expect(new Decimal(costEntry!.amount.toString()).equals(new Decimal("-5000"))).toBe(true);
  });

  it("accumulated depreciation entry is positive (DEBE) to reverse prior credits", async () => {
    mockTx.fixedAsset.findFirstOrThrow.mockResolvedValue(makeAsset());
    mockTx.depreciationEntry.aggregate.mockResolvedValue({
      _sum: { amount: new Decimal("300") },
    });

    await FixedAssetService.dispose(makeInput(), USER_ID, mockTx as never);

    const createCall = mockTx.transaction.create.mock.calls[0]![0];
    const entries: { accountId: string; amount: Decimal; description: string }[] =
      createCall.data.entries.create;

    const depAccEntry = entries.find(
      (e) =>
        e.accountId === "acc-dep-accumulated" && e.description.includes("dep. acum.")
    );
    expect(depAccEntry).toBeDefined();
    expect(new Decimal(depAccEntry!.amount.toString()).equals(new Decimal("300"))).toBe(true);
  });
});
