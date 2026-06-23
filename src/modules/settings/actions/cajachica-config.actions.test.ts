// src/modules/settings/actions/cajachica-config.actions.test.ts
// ADR-039 (nota #3): umbral de step-up de caja chica configurable por empresa.
// getCajaChicaStepUpThresholdAction (ACCOUNTING read) +
// updateCajaChicaStepUpThresholdAction (ADMIN_ONLY write).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    companySettings: { findUnique: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { auth } from "@clerk/nextjs/server";
import { checkRateLimit } from "@/lib/ratelimit";
import prisma from "@/lib/prisma";
import {
  getCajaChicaStepUpThresholdAction,
  updateCajaChicaStepUpThresholdAction,
} from "./cajachica-config.actions";

const COMPANY_ID = "co-1";
const USER_ID = "user-1";
const ADMIN_MEMBER = { role: "ADMIN" };
const ACCOUNTANT_MEMBER = { role: "ACCOUNTANT" };
const VIEWER_MEMBER = { role: "VIEWER" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
  vi.mocked(prisma.companySettings.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.companySettings.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  // $transaction interactivo: corre el callback con un tx que expone companySettings + auditLog.
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: unknown) => unknown) =>
      fn({ companySettings: prisma.companySettings, auditLog: prisma.auditLog })) as never
  );
});

// ─── getCajaChicaStepUpThresholdAction ──────────────────────────────────────────

describe("getCajaChicaStepUpThresholdAction", () => {
  it("sin sesión → error No autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const res = await getCajaChicaStepUpThresholdAction(COMPANY_ID);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/no autorizado/i);
  });

  it("rol insuficiente (no ACCOUNTING) → error No autorizado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(VIEWER_MEMBER as never);
    const res = await getCajaChicaStepUpThresholdAction(COMPANY_ID);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/no autorizado/i);
  });

  it("no member → error No autorizado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);
    const res = await getCajaChicaStepUpThresholdAction(COMPANY_ID);
    expect(res.success).toBe(false);
  });

  it("ACCOUNTANT con valor configurado → threshold (string) + defaultThreshold", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);
    vi.mocked(prisma.companySettings.findUnique).mockResolvedValue({
      cajaChicaStepUpThresholdVes: "50000",
    } as never);

    const res = await getCajaChicaStepUpThresholdAction(COMPANY_ID);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.threshold).toBe("50000.00");
      expect(res.data.defaultThreshold).toBe("20000.00");
    }
  });

  it("sin valor configurado (null) → threshold null + defaultThreshold del global", async () => {
    vi.mocked(prisma.companySettings.findUnique).mockResolvedValue({
      cajaChicaStepUpThresholdVes: null,
    } as never);

    const res = await getCajaChicaStepUpThresholdAction(COMPANY_ID);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.threshold).toBeNull();
      expect(res.data.defaultThreshold).toBe("20000.00");
    }
  });

  it("settings inexistente (findUnique null) → threshold null", async () => {
    vi.mocked(prisma.companySettings.findUnique).mockResolvedValue(null as never);
    const res = await getCajaChicaStepUpThresholdAction(COMPANY_ID);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.threshold).toBeNull();
  });
});

// ─── updateCajaChicaStepUpThresholdAction ───────────────────────────────────────

describe("updateCajaChicaStepUpThresholdAction", () => {
  it("ADMIN con monto válido → success + upsert con el valor + AuditLog", async () => {
    const res = await updateCajaChicaStepUpThresholdAction({
      companyId: COMPANY_ID,
      threshold: "35000",
    });
    expect(res.success).toBe(true);

    expect(prisma.companySettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: COMPANY_ID },
        create: expect.objectContaining({ cajaChicaStepUpThresholdVes: "35000.00" }),
        update: { cajaChicaStepUpThresholdVes: "35000.00" },
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "UPDATE_CAJACHICA_STEPUP_THRESHOLD",
          entityName: "CompanySettings",
          newValue: { cajaChicaStepUpThresholdVes: "35000.00" },
        }),
      })
    );
  });

  it("threshold vacío \"\" → upsert con null (default global)", async () => {
    const res = await updateCajaChicaStepUpThresholdAction({
      companyId: COMPANY_ID,
      threshold: "",
    });
    expect(res.success).toBe(true);
    expect(prisma.companySettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { cajaChicaStepUpThresholdVes: null },
      })
    );
  });

  it("threshold omitido (undefined) → upsert con null (default global)", async () => {
    const res = await updateCajaChicaStepUpThresholdAction({ companyId: COMPANY_ID });
    expect(res.success).toBe(true);
    expect(prisma.companySettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { cajaChicaStepUpThresholdVes: null } })
    );
  });

  it("sin sesión → error, no upsert", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const res = await updateCajaChicaStepUpThresholdAction({
      companyId: COMPANY_ID,
      threshold: "35000",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/no autorizado/i);
    expect(prisma.companySettings.upsert).not.toHaveBeenCalled();
  });

  it("rate limit excedido → error, no upsert", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);
    const res = await updateCajaChicaStepUpThresholdAction({
      companyId: COMPANY_ID,
      threshold: "35000",
    });
    expect(res.success).toBe(false);
    expect(prisma.companySettings.upsert).not.toHaveBeenCalled();
  });

  it("rol no-ADMIN (ACCOUNTANT) → rechazado, no upsert", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);
    const res = await updateCajaChicaStepUpThresholdAction({
      companyId: COMPANY_ID,
      threshold: "35000",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/propietarios|administradores/i);
    expect(prisma.companySettings.upsert).not.toHaveBeenCalled();
  });

  it("no member → rechazado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);
    const res = await updateCajaChicaStepUpThresholdAction({
      companyId: COMPANY_ID,
      threshold: "35000",
    });
    expect(res.success).toBe(false);
    expect(prisma.companySettings.upsert).not.toHaveBeenCalled();
  });

  it("monto = 0 → error /positivo/i, no upsert", async () => {
    const res = await updateCajaChicaStepUpThresholdAction({
      companyId: COMPANY_ID,
      threshold: "0",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/positivo/i);
    expect(prisma.companySettings.upsert).not.toHaveBeenCalled();
  });

  it("monto negativo (-5) → error /positivo/i, no upsert", async () => {
    const res = await updateCajaChicaStepUpThresholdAction({
      companyId: COMPANY_ID,
      threshold: "-5",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/positivo/i);
    expect(prisma.companySettings.upsert).not.toHaveBeenCalled();
  });

  it("monto no numérico → error, no upsert", async () => {
    const res = await updateCajaChicaStepUpThresholdAction({
      companyId: COMPANY_ID,
      threshold: "abc",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/inválido/i);
    expect(prisma.companySettings.upsert).not.toHaveBeenCalled();
  });

  it("monto demasiado grande (> 999999999999999) → error, no upsert", async () => {
    const res = await updateCajaChicaStepUpThresholdAction({
      companyId: COMPANY_ID,
      threshold: "1000000000000000",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/grande/i);
    expect(prisma.companySettings.upsert).not.toHaveBeenCalled();
  });

  it("input inválido (companyId vacío) → error Zod, no upsert", async () => {
    const res = await updateCajaChicaStepUpThresholdAction({ companyId: "", threshold: "35000" });
    expect(res.success).toBe(false);
    expect(prisma.companySettings.upsert).not.toHaveBeenCalled();
  });

  it("transaction falla → error (mapPrismaError), no rompe", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error("tx failed") as never);
    const res = await updateCajaChicaStepUpThresholdAction({
      companyId: COMPANY_ID,
      threshold: "35000",
    });
    expect(res.success).toBe(false);
  });
});
