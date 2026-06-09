// src/modules/exchange-rates/__tests__/fx-differential.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

const mockAuth = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    companySettings: { findUnique: vi.fn() },
    transaction: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../services/ExchangeDifferentialService", () => ({
  ExchangeDifferentialService: {
    calculate: vi.fn(),
    post: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { ExchangeDifferentialService } from "../services/ExchangeDifferentialService";
import {
  calculateFxDifferentialAction,
  postFxDifferentialAction,
} from "../actions/fx-differential.actions";

const COMPANY_ID = "co-1";
const USER_ID = "usr-1";
const MEMBER_ACCOUNTING = { role: "ACCOUNTANT" };
const MEMBER_VIEWER = { role: "VIEWER" };

const EMPTY_SUMMARY = {
  lines: [],
  netCxCMovement: new Decimal(0),
  netCxPMovement: new Decimal(0),
  totalFxGain: new Decimal(0),
  totalFxLoss: new Decimal(0),
};

const VALID_CALCULATE_INPUT = {
  companyId: COMPANY_ID,
  currency: "USD",
  revalRate: "50.00",
  revaluationDate: "2026-06-01",
};

const VALID_POST_INPUT = {
  companyId: COMPANY_ID,
  currency: "USD",
  revalRate: "50.00",
  revaluationDate: "2026-06-01",
};

const FULL_SETTINGS = {
  arAccountId: "ar-1",
  apAccountId: "ap-1",
  fxGainAccountId: "gain-1",
  fxLossAccountId: "loss-1",
};

function setAuth(userId: string | null) {
  mockAuth.mockResolvedValue({ userId });
}

// ─── calculateFxDifferentialAction ───────────────────────────────────────────

describe("calculateFxDifferentialAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAuth(USER_ID);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTING as never);
    vi.mocked(ExchangeDifferentialService.calculate).mockResolvedValue(EMPTY_SUMMARY as never);
  });

  it("retorna error de schema con input inválido", async () => {
    const r = await calculateFxDifferentialAction({ companyId: "", currency: "XXX" });
    expect(r.success).toBe(false);
  });

  it("rechaza si no hay sesión", async () => {
    setAuth(null);
    const r = await calculateFxDifferentialAction(VALID_CALCULATE_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("rechaza VIEWER (requiere ACCOUNTING)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_VIEWER as never);
    const r = await calculateFxDifferentialAction(VALID_CALCULATE_INPUT);
    expect(r.success).toBe(false);
  });

  it("rechaza tasa <= 0", async () => {
    const r = await calculateFxDifferentialAction({ ...VALID_CALCULATE_INPUT, revalRate: "0" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("mayor que cero");
  });

  it("retorna preview serializado en camino feliz", async () => {
    const r = await calculateFxDifferentialAction(VALID_CALCULATE_INPUT);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.hasData).toBe(false);
      expect(r.data.totalFxGain).toBe("0.00");
    }
  });

  it("devuelve error estructurado si ExchangeDifferentialService.calculate lanza", async () => {
    vi.mocked(ExchangeDifferentialService.calculate).mockRejectedValueOnce(
      new Error("DB no disponible"),
    );
    const r = await calculateFxDifferentialAction(VALID_CALCULATE_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBeTruthy();
  });
});

// ─── postFxDifferentialAction ─────────────────────────────────────────────────

describe("postFxDifferentialAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAuth(USER_ID);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTING as never);
    vi.mocked(prisma.companySettings.findUnique).mockResolvedValue(FULL_SETTINGS as never);
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null as never);
    vi.mocked(ExchangeDifferentialService.calculate).mockResolvedValue(EMPTY_SUMMARY as never);
    vi.mocked(ExchangeDifferentialService.post).mockResolvedValue("tx-1" as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (db: typeof prisma) => unknown) => fn(prisma)) as never,
    );
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("rechaza si no hay sesión", async () => {
    setAuth(null);
    const r = await postFxDifferentialAction(VALID_POST_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("rechaza si faltan cuentas fxGain/fxLoss", async () => {
    vi.mocked(prisma.companySettings.findUnique).mockResolvedValue({
      ...FULL_SETTINGS,
      fxGainAccountId: null,
    } as never);
    const r = await postFxDifferentialAction(VALID_POST_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("Ganancia y Pérdida");
  });

  it("rechaza si faltan cuentas CxC/CxP", async () => {
    vi.mocked(prisma.companySettings.findUnique).mockResolvedValue({
      ...FULL_SETTINGS,
      arAccountId: null,
    } as never);
    const r = await postFxDifferentialAction(VALID_POST_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("CxC y CxP");
  });

  it("rechaza doble-registro del mismo período", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({ id: "existing-tx" } as never);
    const r = await postFxDifferentialAction(VALID_POST_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("FX-REVAL");
  });

  it("registra asiento y crea AuditLog en camino feliz", async () => {
    const r = await postFxDifferentialAction(VALID_POST_INPUT);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.transactionNumber).toMatch(/^FX-REVAL-/);
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
  });
});
