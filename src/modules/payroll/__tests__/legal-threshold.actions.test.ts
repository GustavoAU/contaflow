// src/modules/payroll/__tests__/legal-threshold.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { fiscal: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
  },
}));
vi.mock("../services/LegalThresholdService", () => ({
  LegalThresholdService: {
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { LegalThresholdService } from "../services/LegalThresholdService";
import {
  getLegalThresholdsAction,
  createLegalThresholdAction,
  deleteLegalThresholdAction,
} from "../actions/legal-threshold.actions";

const COMPANY_ID = "company-test";
const USER_ID = "user-test";

const SAMPLE = {
  id: "th-1",
  type: "SALARY_MIN_VES" as const,
  effectiveFrom: "2026-01-01",
  value: "130.00",
  notes: null,
  createdAt: new Date().toISOString(),
};

function setupOk(role = "ADMIN") {
  mockAuth.mockResolvedValue({ userId: USER_ID });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role } as never);
}

describe("getLegalThresholdsAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna thresholds para cualquier miembro", async () => {
    setupOk("VIEWER");
    vi.mocked(LegalThresholdService.list).mockResolvedValue([SAMPLE]);

    const res = await getLegalThresholdsAction(COMPANY_ID);

    expect(res.success).toBe(true);
    if (res.success) expect(res.data).toHaveLength(1);
  });

  it("retorna error si no autenticado", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await getLegalThresholdsAction(COMPANY_ID);

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("No autorizado");
  });

  it("retorna error si IDOR (no miembro)", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);

    const res = await getLegalThresholdsAction(COMPANY_ID);

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Acceso denegado");
  });
});

describe("createLegalThresholdAction", () => {
  beforeEach(() => vi.clearAllMocks());

  const VALID_INPUT = {
    type: "SALARY_MIN_VES",
    effectiveFrom: "2026-01-01",
    value: "130.00",
    notes: "Decreto 5.163",
  };

  it("crea threshold cuando ADMIN", async () => {
    setupOk("ADMIN");
    vi.mocked(LegalThresholdService.create).mockResolvedValue(SAMPLE);

    const res = await createLegalThresholdAction(COMPANY_ID, VALID_INPUT);

    expect(res.success).toBe(true);
    expect(LegalThresholdService.create).toHaveBeenCalledTimes(1);
  });

  it("bloquea si rate limit agotado", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: false, error: "Demasiadas solicitudes. Intente más tarde." });

    const res = await createLegalThresholdAction(COMPANY_ID, VALID_INPUT);

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("Demasiadas solicitudes");
    expect(LegalThresholdService.create).not.toHaveBeenCalled();
  });

  it("bloquea si rol es ACCOUNTANT (no ADMIN)", async () => {
    setupOk("ACCOUNTANT");

    const res = await createLegalThresholdAction(COMPANY_ID, VALID_INPUT);

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("Administrador");
  });

  it("retorna error si value es negativo", async () => {
    setupOk("ADMIN");

    const res = await createLegalThresholdAction(COMPANY_ID, { ...VALID_INPUT, value: "-50" });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("positivo");
  });

  it("retorna error si fecha inválida", async () => {
    setupOk("ADMIN");

    const res = await createLegalThresholdAction(COMPANY_ID, { ...VALID_INPUT, effectiveFrom: "2026/01/01" });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("YYYY-MM-DD");
  });
});

describe("deleteLegalThresholdAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("elimina cuando ADMIN", async () => {
    setupOk("ADMIN");
    vi.mocked(LegalThresholdService.delete).mockResolvedValue(undefined);

    const res = await deleteLegalThresholdAction(COMPANY_ID, "th-1");

    expect(res.success).toBe(true);
    expect(LegalThresholdService.delete).toHaveBeenCalledWith(COMPANY_ID, "th-1");
  });

  it("bloquea si ACCOUNTANT intenta eliminar", async () => {
    setupOk("ACCOUNTANT");

    const res = await deleteLegalThresholdAction(COMPANY_ID, "th-1");

    expect(res.success).toBe(false);
    expect(LegalThresholdService.delete).not.toHaveBeenCalled();
  });
});
