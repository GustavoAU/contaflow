// src/modules/payroll/__tests__/payroll-config.actions.test.ts
// Tests: NOM-A-01 (IDOR), NOM-A-04 (rate limit), NOM-A-05 (ADMIN_ONLY), auth guard, Zod

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    payrollConfig: { findUnique: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Map()) }));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  fiscalKey: (c: string, u: string) => `${c}:${u}`,
  limiters: { fiscal: {} },
}));

vi.mock("../services/PayrollConfigService", () => ({
  PayrollConfigService: {
    saveConfig: vi.fn().mockResolvedValue({ id: "cfg-1", sizeRange: "SMALL" }),
    getConfig: vi.fn().mockResolvedValue(null),
    isConfigured: vi.fn().mockResolvedValue(false),
  },
}));

import { auth } from "@clerk/nextjs/server";
import { checkRateLimit } from "@/lib/ratelimit";
import {
  savePayrollConfigAction,
  getPayrollConfigAction,
  getPayrollConfigStatusAction,
} from "../actions/payroll-config.actions";

const COMPANY_ID = "company-test";

const VALID_INPUT = {
  sizeRange: "SMALL",
  lottRegime: "POST_2012",
  ivssEnabled: true,
  incesEnabled: true,
  banavihEnabled: true,
  rpeEnabled: true,
  cestaTicketType: "CARD",
  paymentCurrency: "VES",
  frequency: "BIWEEKLY",
  fideicomiso: "INTERNAL",
  salaryMinimumVes: null,
};

// ── savePayrollConfigAction ────────────────────────────────────────────────────

describe("savePayrollConfigAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
    // ADMIN_ONLY por defecto
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ADMIN" } as never);
  });

  it("ADMIN puede guardar la configuración", async () => {
    const r = await savePayrollConfigAction(COMPANY_ID, VALID_INPUT);
    expect(r.success).toBe(true);
  });

  it("OWNER puede guardar la configuración", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "OWNER" } as never);
    const r = await savePayrollConfigAction(COMPANY_ID, VALID_INPUT);
    expect(r.success).toBe(true);
  });

  it("NOM-A-05: ACCOUNTANT es rechazado (no es ADMIN_ONLY)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    const r = await savePayrollConfigAction(COMPANY_ID, VALID_INPUT);
    expect(r.success).toBe(false);
  });

  it("NOM-A-05: ADMINISTRATIVE es rechazado (no es ADMIN_ONLY)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ADMINISTRATIVE" } as never);
    const r = await savePayrollConfigAction(COMPANY_ID, VALID_INPUT);
    expect(r.success).toBe(false);
  });

  it("NOM-A-05: VIEWER es rechazado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const r = await savePayrollConfigAction(COMPANY_ID, VALID_INPUT);
    expect(r.success).toBe(false);
  });

  it("auth: sin userId retorna No autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await savePayrollConfigAction(COMPANY_ID, VALID_INPUT);
    expect(r).toEqual({ success: false, error: "No autorizado" });
  });

  it("NOM-A-01: sin membresía retorna No autorizado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const r = await savePayrollConfigAction(COMPANY_ID, VALID_INPUT);
    expect(r.success).toBe(false);
  });

  it("NOM-A-04: rate limit bloqueado retorna error", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);
    const r = await savePayrollConfigAction(COMPANY_ID, VALID_INPUT);
    expect(r.success).toBe(false);
    expect((r as { success: false; error: string }).error).toContain("Demasiadas solicitudes");
  });

  it("Zod: sizeRange inválido retorna error de validación", async () => {
    const r = await savePayrollConfigAction(COMPANY_ID, {
      ...VALID_INPUT,
      sizeRange: "GIGANTIC",
    });
    expect(r.success).toBe(false);
  });

  it("Zod: lottRegime inválido retorna error de validación", async () => {
    const r = await savePayrollConfigAction(COMPANY_ID, {
      ...VALID_INPUT,
      lottRegime: "OLD_SCHOOL",
    });
    expect(r.success).toBe(false);
  });

  it("Zod: ivssEnabled no booleano retorna error de validación", async () => {
    const r = await savePayrollConfigAction(COMPANY_ID, {
      ...VALID_INPUT,
      ivssEnabled: "yes" as unknown as boolean,
    });
    expect(r.success).toBe(false);
  });

  it("Zod: frequency inválida retorna error de validación", async () => {
    const r = await savePayrollConfigAction(COMPANY_ID, {
      ...VALID_INPUT,
      frequency: "WEEKLY",
    });
    expect(r.success).toBe(false);
  });
});

// ── getPayrollConfigAction ────────────────────────────────────────────────────

describe("getPayrollConfigAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
  });

  it("ACCOUNTANT puede leer la configuración", async () => {
    const r = await getPayrollConfigAction(COMPANY_ID);
    expect(r.success).toBe(true);
  });

  it("ADMIN puede leer la configuración", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ADMIN" } as never);
    const r = await getPayrollConfigAction(COMPANY_ID);
    expect(r.success).toBe(true);
  });

  it("VIEWER es rechazado (no es ACCOUNTING)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const r = await getPayrollConfigAction(COMPANY_ID);
    expect(r.success).toBe(false);
  });

  it("NOM-A-01: sin userId retorna No autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await getPayrollConfigAction(COMPANY_ID);
    expect(r).toEqual({ success: false, error: "No autorizado" });
  });

  it("NOM-A-01: sin membresía retorna No autorizado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const r = await getPayrollConfigAction(COMPANY_ID);
    expect(r.success).toBe(false);
  });
});

// ── getPayrollConfigStatusAction ─────────────────────────────────────────────

describe("getPayrollConfigStatusAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
  });

  it("VIEWER puede consultar el estado del wizard", async () => {
    const r = await getPayrollConfigStatusAction(COMPANY_ID);
    expect(r.success).toBe(true);
    if (r.success) expect(typeof r.data.configured).toBe("boolean");
  });

  it("NOM-A-06: sin userId retorna No autorizado (evita info disclosure)", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await getPayrollConfigStatusAction(COMPANY_ID);
    expect(r).toEqual({ success: false, error: "No autorizado" });
  });

  it("NOM-A-06: sin membresía retorna No autorizado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const r = await getPayrollConfigStatusAction(COMPANY_ID);
    expect(r.success).toBe(false);
  });
});
