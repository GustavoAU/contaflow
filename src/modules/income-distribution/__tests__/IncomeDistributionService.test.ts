// src/modules/income-distribution/__tests__/IncomeDistributionService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    incomeDistribution: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    incomeDistributionAudit: { create: vi.fn() },
    transaction: { create: vi.fn() },
  },
}));

import prisma from "@/lib/prisma";
import {
  buildIdempotencyKey,
  computeTotalVes,
  distributeAmounts,
} from "../services/IncomeDistributionService";
import { CreateIncomeDistributionSchema } from "../schemas/income-distribution.schema";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_ID = "comp-1";
const USER_ID = "user-1";

const BASE_LINES = [
  { recipientCompanyId: "rc-1", accountId: "acc-1", percentageShare: new Decimal("60") },
  { recipientCompanyId: "rc-2", accountId: "acc-2", percentageShare: new Decimal("40") },
];

// ─── Utilidades puras ─────────────────────────────────────────────────────────

describe("computeTotalVes", () => {
  it("multiplica amount × rate con 2 decimales", () => {
    expect(computeTotalVes(new Decimal("1000"), new Decimal("36.50")).toFixed(2)).toBe("36500.00");
  });

  it("redondea HALF_UP en el segundo decimal", () => {
    const result = computeTotalVes(new Decimal("100"), new Decimal("1.005"));
    expect(result.toFixed(2)).toBe("100.50");
  });
});

describe("distributeAmounts", () => {
  it("distribuye correctamente 60/40 de 1000", () => {
    const amounts = distributeAmounts(new Decimal("1000"), BASE_LINES);
    expect(amounts[0].toFixed(2)).toBe("600.00");
    expect(amounts[1].toFixed(2)).toBe("400.00");
  });

  it("la suma siempre iguala el total (la última línea absorbe el residuo)", () => {
    const total = new Decimal("1000.01");
    const lines = [
      { percentageShare: new Decimal("33.33") },
      { percentageShare: new Decimal("33.33") },
      { percentageShare: new Decimal("33.34") },
    ];
    const amounts = distributeAmounts(total, lines);
    const sum = amounts.reduce((acc, a) => acc.plus(a), new Decimal(0));
    expect(sum.toFixed(2)).toBe("1000.01");
  });

  it("funciona con 2 líneas 50/50", () => {
    const amounts = distributeAmounts(new Decimal("100"), [
      { percentageShare: new Decimal("50") },
      { percentageShare: new Decimal("50") },
    ]);
    expect(amounts[0].toFixed(2)).toBe("50.00");
    expect(amounts[1].toFixed(2)).toBe("50.00");
  });
});

describe("buildIdempotencyKey", () => {
  it("produce hash SHA256 de 64 caracteres", () => {
    const key = buildIdempotencyKey(COMPANY_ID, new Date("2026-05-12"), new Decimal("1000"), BASE_LINES);
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[a-f0-9]+$/);
  });

  it("produce el mismo hash para el mismo input (determinista)", () => {
    const date = new Date("2026-05-12T00:00:00.000Z");
    const k1 = buildIdempotencyKey(COMPANY_ID, date, new Decimal("1000"), BASE_LINES);
    const k2 = buildIdempotencyKey(COMPANY_ID, date, new Decimal("1000"), BASE_LINES);
    expect(k1).toBe(k2);
  });

  it("produce hashes distintos para inputs distintos", () => {
    const date = new Date("2026-05-12T00:00:00.000Z");
    const k1 = buildIdempotencyKey(COMPANY_ID, date, new Decimal("1000"), BASE_LINES);
    const k2 = buildIdempotencyKey(COMPANY_ID, date, new Decimal("2000"), BASE_LINES);
    expect(k1).not.toBe(k2);
  });

  it("normaliza el orden de líneas (sort por recipientCompanyId)", () => {
    const date = new Date("2026-05-12T00:00:00.000Z");
    const reversed = [...BASE_LINES].reverse();
    const k1 = buildIdempotencyKey(COMPANY_ID, date, new Decimal("1000"), BASE_LINES);
    const k2 = buildIdempotencyKey(COMPANY_ID, date, new Decimal("1000"), reversed);
    expect(k1).toBe(k2);
  });
});

// ─── createDistribution ───────────────────────────────────────────────────────

describe("createDistribution (mocked)", () => {
  const mockDist = {
    id: "dist-1",
    companyId: COMPANY_ID,
    referenceNumber: null,
    description: null,
    date: new Date("2026-05-12"),
    status: "DRAFT" as const,
    currencyCode: "VES",
    totalAmountOriginal: new Decimal("1000"),
    totalAmountVes: new Decimal("1000"),
    exchangeRate: new Decimal("1"),
    originAccountId: "acc-origin",
    originAccount: { code: "1100", name: "Caja" },
    transactionId: null,
    idempotencyKey: "key-1",
    voidReason: null,
    voidedAt: null,
    voidedBy: null,
    createdAt: new Date(),
    createdBy: USER_ID,
    lines: [
      {
        id: "line-1",
        distributionId: "dist-1",
        recipientCompanyId: "rc-1",
        recipientCompany: { name: "Sucursal A" },
        accountId: "acc-1",
        account: { code: "2100", name: "CxP Sucursal A" },
        percentageShare: new Decimal("60"),
        amountVes: new Decimal("600"),
        lineDescription: null,
        lineNumber: 1,
      },
      {
        id: "line-2",
        distributionId: "dist-1",
        recipientCompanyId: "rc-2",
        recipientCompany: { name: "Sucursal B" },
        accountId: "acc-2",
        account: { code: "2101", name: "CxP Sucursal B" },
        percentageShare: new Decimal("40"),
        amountVes: new Decimal("400"),
        lineDescription: null,
        lineNumber: 2,
      },
    ],
    deletedAt: null,
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never
    );
    vi.mocked(prisma.incomeDistribution.create).mockResolvedValue(mockDist as never);
    vi.mocked(prisma.incomeDistributionAudit.create).mockResolvedValue({} as never);
  });

  it("retorna IncomeDistributionSummary serializado", async () => {
    const { createDistribution } = await import("../services/IncomeDistributionService");
    const result = await createDistribution({
      companyId: COMPANY_ID,
      date: new Date("2026-05-12"),
      currencyCode: "VES",
      totalAmountOriginal: new Decimal("1000"),
      exchangeRate: new Decimal("1"),
      originAccountId: "acc-origin",
      lines: BASE_LINES,
      createdBy: USER_ID,
      idempotencyKey: "key-1",
    });

    expect(result.id).toBe("dist-1");
    expect(result.status).toBe("DRAFT");
    expect(result.totalAmountVes).toBe("1000");
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].recipientCompanyName).toBe("Sucursal A");
  });

  it("lanza error de negocio cuando P2002 en idempotencyKey", async () => {
    const p2002 = Object.assign(new Error("Unique"), { code: "P2002", meta: { target: ["idempotencyKey"] } });
    vi.mocked(prisma.incomeDistribution.create).mockRejectedValue(p2002);

    const { createDistribution } = await import("../services/IncomeDistributionService");
    await expect(
      createDistribution({
        companyId: COMPANY_ID,
        date: new Date("2026-05-12"),
        currencyCode: "VES",
        totalAmountOriginal: new Decimal("1000"),
        exchangeRate: new Decimal("1"),
        originAccountId: "acc-origin",
        lines: BASE_LINES,
        createdBy: USER_ID,
        idempotencyKey: "key-1",
      })
    ).rejects.toThrow("ya fue creada");
  });
});

// ─── applyDistribution ────────────────────────────────────────────────────────

describe("applyDistribution (mocked)", () => {
  const draftDist = {
    id: "dist-1",
    companyId: COMPANY_ID,
    status: "DRAFT" as const,
    referenceNumber: null,
    description: "Test",
    date: new Date("2026-05-12"),
    currencyCode: "VES",
    totalAmountOriginal: new Decimal("1000"),
    totalAmountVes: new Decimal("1000"),
    exchangeRate: new Decimal("1"),
    originAccountId: "acc-origin",
    originAccount: { code: "1100", name: "Caja" },
    transactionId: null,
    idempotencyKey: "key-1",
    voidReason: null,
    voidedAt: null,
    voidedBy: null,
    createdAt: new Date(),
    createdBy: USER_ID,
    deletedAt: null,
    updatedAt: new Date(),
    lines: [
      { id: "l1", distributionId: "dist-1", recipientCompanyId: "rc-1", recipientCompany: { name: "A" }, accountId: "acc-1", account: { code: "2100", name: "CxP A" }, percentageShare: new Decimal("60"), amountVes: new Decimal("600"), lineDescription: null, lineNumber: 1 },
      { id: "l2", distributionId: "dist-1", recipientCompanyId: "rc-2", recipientCompany: { name: "B" }, accountId: "acc-2", account: { code: "2101", name: "CxP B" }, percentageShare: new Decimal("40"), amountVes: new Decimal("400"), lineDescription: null, lineNumber: 2 },
    ],
  };

  const appliedDist = { ...draftDist, status: "APPLIED" as const, referenceNumber: "DIST-000001", transactionId: "tx-1" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never
    );
    vi.mocked(prisma.incomeDistribution.findFirst).mockResolvedValue(draftDist as never);
    vi.mocked(prisma.incomeDistribution.count).mockResolvedValue(1);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-1" } as never);
    vi.mocked(prisma.incomeDistribution.update).mockResolvedValue(appliedDist as never);
    vi.mocked(prisma.incomeDistributionAudit.create).mockResolvedValue({} as never);
  });

  it("cambia estado a APPLIED y asigna referenceNumber", async () => {
    const { applyDistribution } = await import("../services/IncomeDistributionService");
    const result = await applyDistribution("dist-1", COMPANY_ID, USER_ID);
    expect(result.status).toBe("APPLIED");
    expect(result.referenceNumber).toBe("DIST-000001");
  });

  it("lanza error si la distribución no existe", async () => {
    vi.mocked(prisma.incomeDistribution.findFirst).mockResolvedValue(null);
    const { applyDistribution } = await import("../services/IncomeDistributionService");
    await expect(applyDistribution("dist-x", COMPANY_ID, USER_ID)).rejects.toThrow("no encontrada");
  });

  it("lanza error si el estado no es DRAFT", async () => {
    vi.mocked(prisma.incomeDistribution.findFirst).mockResolvedValue({ ...draftDist, status: "APPLIED" } as never);
    const { applyDistribution } = await import("../services/IncomeDistributionService");
    await expect(applyDistribution("dist-1", COMPANY_ID, USER_ID)).rejects.toThrow("no puede aplicarse");
  });
});

// ─── voidDistribution ─────────────────────────────────────────────────────────

describe("voidDistribution (mocked)", () => {
  const draftDist = {
    id: "dist-1",
    companyId: COMPANY_ID,
    status: "DRAFT" as const,
    referenceNumber: null,
    description: null,
    date: new Date("2026-05-12"),
    currencyCode: "VES",
    totalAmountOriginal: new Decimal("1000"),
    totalAmountVes: new Decimal("1000"),
    exchangeRate: new Decimal("1"),
    originAccountId: "acc-origin",
    originAccount: { code: "1100", name: "Caja" },
    transactionId: null,
    idempotencyKey: "key-1",
    voidReason: null,
    voidedAt: null,
    voidedBy: null,
    createdAt: new Date(),
    createdBy: USER_ID,
    deletedAt: null,
    updatedAt: new Date(),
    lines: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never
    );
    vi.mocked(prisma.incomeDistribution.findFirst).mockResolvedValue(draftDist as never);
    vi.mocked(prisma.incomeDistribution.update).mockResolvedValue({ ...draftDist, status: "VOID" } as never);
    vi.mocked(prisma.incomeDistributionAudit.create).mockResolvedValue({} as never);
  });

  it("anula una distribución DRAFT", async () => {
    const { voidDistribution } = await import("../services/IncomeDistributionService");
    const result = await voidDistribution("dist-1", COMPANY_ID, "Error de entrada", USER_ID);
    expect(result.status).toBe("VOID");
  });

  it("bloquea anular una distribución APPLIED", async () => {
    vi.mocked(prisma.incomeDistribution.findFirst).mockResolvedValue({ ...draftDist, status: "APPLIED" } as never);
    const { voidDistribution } = await import("../services/IncomeDistributionService");
    await expect(
      voidDistribution("dist-1", COMPANY_ID, "Error", USER_ID)
    ).rejects.toThrow("Solo se pueden anular distribuciones en DRAFT");
  });
});

// ─── Zod schema validations ───────────────────────────────────────────────────

describe("CreateIncomeDistributionSchema validations", () => {
  const valid = {
    companyId: "clh1234567890abcdefghijk",
    date: "2026-05-12",
    currencyCode: "VES",
    totalAmountOriginal: "1000",
    exchangeRate: "1",
    originAccountId: "clh1234567890abcdefghijk",
    lines: [
      { recipientCompanyId: "clh1234567890abcdefghijk", accountId: "clh1234567890abcdefghijk", percentageShare: "60" },
      { recipientCompanyId: "clhabcdefghijk1234567890", accountId: "clhabcdefghijk1234567890", percentageShare: "40" },
    ],
  };

  it("acepta input válido", () => {
    expect(CreateIncomeDistributionSchema.safeParse(valid).success).toBe(true);
  });

  it("rechaza suma de porcentajes ≠ 100", () => {
    const bad = { ...valid, lines: [
      { ...valid.lines[0], percentageShare: "50" },
      { ...valid.lines[1], percentageShare: "40" },
    ]};
    expect(CreateIncomeDistributionSchema.safeParse(bad).success).toBe(false);
  });

  it("rechaza destinatarios duplicados", () => {
    const bad = { ...valid, lines: [
      { ...valid.lines[0], percentageShare: "50" },
      { ...valid.lines[0], percentageShare: "50" },
    ]};
    expect(CreateIncomeDistributionSchema.safeParse(bad).success).toBe(false);
  });

  it("rechaza menos de 2 líneas", () => {
    const bad = { ...valid, lines: [valid.lines[0]] };
    expect(CreateIncomeDistributionSchema.safeParse(bad).success).toBe(false);
  });

  it("rechaza totalAmountOriginal <= 0", () => {
    expect(CreateIncomeDistributionSchema.safeParse({ ...valid, totalAmountOriginal: "0" }).success).toBe(false);
    expect(CreateIncomeDistributionSchema.safeParse({ ...valid, totalAmountOriginal: "-100" }).success).toBe(false);
  });
});
