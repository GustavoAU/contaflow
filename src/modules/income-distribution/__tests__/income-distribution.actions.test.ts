// src/modules/income-distribution/__tests__/income-distribution.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockHeaders = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/headers", () => ({ headers: mockHeaders }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { fiscal: {}, ocr: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
  },
}));
vi.mock("../services/IncomeDistributionService", () => ({
  createDistribution: vi.fn(),
  applyDistribution: vi.fn(),
  voidDistribution: vi.fn(),
  listDistributions: vi.fn(),
  getDistributionById: vi.fn(),
  buildIdempotencyKey: vi.fn().mockReturnValue("mock-key"),
  computeTotalVes: vi.fn().mockReturnValue({ toFixed: () => "1000.00" }),
}));

import prisma from "@/lib/prisma";
import {
  createDistributionAction,
  applyDistributionAction,
  voidDistributionAction,
  listDistributionsAction,
} from "../actions/income-distribution.actions";
import * as Service from "../services/IncomeDistributionService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const COMPANY_ID = "clh1234567890abcdefghijk";
const USER_ID = "user-1";
const DIST_ID = "clhdist567890abcdefghijk";

const MOCK_DIST = {
  id: DIST_ID,
  companyId: COMPANY_ID,
  status: "DRAFT",
  referenceNumber: null,
  description: null,
  date: new Date("2026-05-12"),
  currencyCode: "VES",
  totalAmountOriginal: "1000.00",
  totalAmountVes: "1000.00",
  exchangeRate: "1.000000",
  originAccountId: "clhoriginaccount1234567",
  originAccountCode: "1100",
  originAccountName: "Caja",
  transactionId: null,
  idempotencyKey: "mock-key",
  voidReason: null,
  voidedAt: null,
  voidedBy: null,
  createdAt: new Date(),
  createdBy: USER_ID,
  lines: [],
};

const VALID_CREATE_INPUT = {
  companyId: COMPANY_ID,
  date: "2026-05-12",
  currencyCode: "VES",
  totalAmountOriginal: "1000",
  exchangeRate: "1",
  originAccountId: "clhoriginaccount1234567",
  lines: [
    { recipientCompanyId: "clhrecipient1234567890a", accountId: "clhaccount1234567890ab", percentageShare: "60" },
    { recipientCompanyId: "clhrecipient1234567890b", accountId: "clhaccount1234567890cd", percentageShare: "40" },
  ],
};

function setupHappyPath() {
  mockAuth.mockResolvedValue({ userId: USER_ID });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockHeaders.mockResolvedValue(new Map([["user-agent", "test"]]));
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
}

// ─── createDistributionAction ─────────────────────────────────────────────────

describe("createDistributionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
    vi.mocked(Service.createDistribution).mockResolvedValue(MOCK_DIST as never);
  });

  it("retorna distribución creada con datos válidos", async () => {
    const result = await createDistributionAction(VALID_CREATE_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe(DIST_ID);
  });

  it("rechaza input inválido (porcentajes no suman 100)", async () => {
    const bad = { ...VALID_CREATE_INPUT, lines: [
      { ...VALID_CREATE_INPUT.lines[0], percentageShare: "50" },
      { ...VALID_CREATE_INPUT.lines[1], percentageShare: "30" },
    ]};
    const result = await createDistributionAction(bad);
    expect(result.success).toBe(false);
  });

  it("retorna error si no hay sesión", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await createDistributionAction(VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna error si rate limit excedido", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, error: "Demasiadas solicitudes. Intente más tarde." });
    const result = await createDistributionAction(VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas");
  });

  it("retorna error si no es miembro", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await createDistributionAction(VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
  });

  it("propaga errores del service", async () => {
    vi.mocked(Service.createDistribution).mockRejectedValue(new Error("Error DB"));
    const result = await createDistributionAction(VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Error DB");
  });
});

// ─── applyDistributionAction ──────────────────────────────────────────────────

describe("applyDistributionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
    vi.mocked(Service.applyDistribution).mockResolvedValue({ ...MOCK_DIST, status: "APPLIED" } as never);
  });

  it("aplica distribución con datos válidos", async () => {
    const result = await applyDistributionAction({ distributionId: DIST_ID, companyId: COMPANY_ID });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("APPLIED");
  });

  it("rechaza input inválido", async () => {
    const result = await applyDistributionAction({ distributionId: "not-cuid", companyId: COMPANY_ID });
    expect(result.success).toBe(false);
  });

  it("propaga error del service", async () => {
    vi.mocked(Service.applyDistribution).mockRejectedValue(new Error("Estado incorrecto"));
    const result = await applyDistributionAction({ distributionId: DIST_ID, companyId: COMPANY_ID });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Estado incorrecto");
  });
});

// ─── voidDistributionAction ───────────────────────────────────────────────────

describe("voidDistributionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
    vi.mocked(Service.voidDistribution).mockResolvedValue({ ...MOCK_DIST, status: "VOID" } as never);
  });

  it("anula distribución con motivo válido", async () => {
    const result = await voidDistributionAction({
      distributionId: DIST_ID,
      companyId: COMPANY_ID,
      voidReason: "Error de entrada de datos",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("VOID");
  });

  it("rechaza motivo de anulación vacío", async () => {
    const result = await voidDistributionAction({
      distributionId: DIST_ID,
      companyId: COMPANY_ID,
      voidReason: "ab",
    });
    expect(result.success).toBe(false);
  });
});

// ─── listDistributionsAction ──────────────────────────────────────────────────

describe("listDistributionsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
    vi.mocked(Service.listDistributions).mockResolvedValue({ distributions: [MOCK_DIST as never], nextCursor: null });
  });

  it("retorna lista con nextCursor", async () => {
    const result = await listDistributionsAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.distributions).toHaveLength(1);
      expect(result.data.nextCursor).toBeNull();
    }
  });
});
