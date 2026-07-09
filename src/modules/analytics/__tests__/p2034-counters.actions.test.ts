// src/modules/analytics/__tests__/p2034-counters.actions.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";

const { mockMget } = vi.hoisted(() => ({ mockMget: vi.fn() }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/ratelimit", () => ({
  redis: { mget: mockMget },
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {}, ocr: {} },
}));

import { getP2034CountersAction } from "../actions/p2034-counters.actions";

const COMPANY_ID = "company-xyz";

describe("getP2034CountersAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "OWNER" } as never);
    mockMget.mockResolvedValue(Array(7).fill(null));
  });

  it("OWNER recibe contadores de 7 días con nulls convertidos a 0", async () => {
    mockMget.mockResolvedValue([5, 10, null, 3, 0, 8, null]);

    const r = await getP2034CountersAction(COMPANY_ID);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toHaveLength(7);
      expect(r.data[0]!.count).toBe(5);
      expect(r.data[1]!.count).toBe(10);
      expect(r.data[2]!.count).toBe(0);
    }
  });

  it("ADMIN recibe contadores correctamente", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ADMIN" } as never);

    const r = await getP2034CountersAction(COMPANY_ID);
    expect(r.success).toBe(true);
  });

  it("sin userId retorna error no autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const r = await getP2034CountersAction(COMPANY_ID);
    expect(r).toEqual({ success: false, error: "No autorizado" });
  });

  it("sin membresía retorna empresa no encontrada", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);

    const r = await getP2034CountersAction(COMPANY_ID);
    expect(r.success).toBe(false);
  });

  it("ACCOUNTANT es rechazado (requiere ADMIN_ONLY)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);

    const r = await getP2034CountersAction(COMPANY_ID);
    expect(r.success).toBe(false);
  });

  it("error de redis retorna array vacío (graceful)", async () => {
    mockMget.mockRejectedValueOnce(new Error("Redis down"));

    const r = await getP2034CountersAction(COMPANY_ID);
    expect(r).toEqual({ success: true, data: [] });
  });

  it("error de DB en guard retorna error vía toActionError", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockRejectedValueOnce(new Error("unexpected DB failure"));

    const r = await getP2034CountersAction(COMPANY_ID);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("unexpected DB failure");
  });
});
