// src/modules/billing/actions/plan-change.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import {
  requestPlanChangeAction,
  cancelPlanChangeAction,
} from "./plan-change.actions";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user-owner" }),
}));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findUnique: vi.fn() },
    planChangeRequest: { findUnique: vi.fn() },
  },
}));
vi.mock("../services/PlanChangeService", () => ({
  requestPlanChange: vi.fn(),
  cancelPlanChange: vi.fn(),
}));

import * as PlanChangeService from "../services/PlanChangeService";
import { auth } from "@clerk/nextjs/server";

const COMPANY_ID = "company-1";
const OWNER = { id: "m1", userId: "user-owner", companyId: COMPANY_ID, role: "OWNER" as const };
const NON_OWNER = { ...OWNER, role: "ACCOUNTANT" as const };

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── requestPlanChangeAction ──────────────────────────────────────────────────

describe("requestPlanChangeAction", () => {
  it("rechaza sin auth", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as never);
    const res = await requestPlanChangeAction({ companyId: COMPANY_ID, toPlan: "ANNUAL" });
    expect(res).toEqual({ success: false, error: "No autorizado" });
  });

  it("rechaza si el usuario no es OWNER", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(NON_OWNER as never);
    const res = await requestPlanChangeAction({ companyId: COMPANY_ID, toPlan: "ANNUAL" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/Propietario/i);
    expect(PlanChangeService.requestPlanChange).not.toHaveBeenCalled();
  });

  it("rechaza si no es miembro de la empresa", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(null);
    const res = await requestPlanChangeAction({ companyId: COMPANY_ID, toPlan: "ANNUAL" });
    expect(res).toEqual({ success: false, error: "Empresa no encontrada" });
  });

  it("happy path OWNER: llama al service y serializa la fecha", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(OWNER as never);
    vi.mocked(PlanChangeService.requestPlanChange).mockResolvedValue({
      planChangeRequestId: "req-1",
      effectiveDate: new Date("2026-08-01T00:00:00Z"),
      newPriceUsdCents: 78000,
    });
    const res = await requestPlanChangeAction({ companyId: COMPANY_ID, toPlan: "ANNUAL" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.planChangeRequestId).toBe("req-1");
      expect(res.data.effectiveDate).toBe("2026-08-01T00:00:00.000Z");
      expect(res.data.newPriceUsdCents).toBe(78000);
    }
  });

  it("rechaza toPlan inválido vía Zod", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(OWNER as never);
    const res = await requestPlanChangeAction({ companyId: COMPANY_ID, toPlan: "TRIAL" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Datos inválidos");
  });
});

// ─── cancelPlanChangeAction ───────────────────────────────────────────────────

describe("cancelPlanChangeAction", () => {
  it("rechaza sin auth", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as never);
    const res = await cancelPlanChangeAction({ planChangeRequestId: "req-1" });
    expect(res).toEqual({ success: false, error: "No autorizado" });
  });

  it("rechaza si no es OWNER de la empresa dueña de la solicitud", async () => {
    vi.mocked(prisma.planChangeRequest.findUnique).mockResolvedValue({
      id: "req-1",
      subscription: { companyId: COMPANY_ID },
    } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(NON_OWNER as never);
    const res = await cancelPlanChangeAction({ planChangeRequestId: "req-1" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/permiso/i);
    expect(PlanChangeService.cancelPlanChange).not.toHaveBeenCalled();
  });

  it("happy path OWNER cancela", async () => {
    vi.mocked(prisma.planChangeRequest.findUnique).mockResolvedValue({
      id: "req-1",
      subscription: { companyId: COMPANY_ID },
    } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(OWNER as never);
    vi.mocked(PlanChangeService.cancelPlanChange).mockResolvedValue(undefined);
    const res = await cancelPlanChangeAction({ planChangeRequestId: "req-1" });
    expect(res.success).toBe(true);
    const call = vi.mocked(PlanChangeService.cancelPlanChange).mock.calls[0];
    expect(call[0]).toBe("req-1");
    expect(call[1]).toBe("user-owner");
    expect(call[2]).toBe("Cancelado por el usuario");
    // args 4/5 = ipAddress/userAgent (LOW-1)
  });
});
