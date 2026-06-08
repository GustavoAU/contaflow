// src/modules/bank-reconciliation/__tests__/bank-action-guard.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    companyMember: { findUnique: vi.fn() },
  },
}));

import { getAuthUserId, getMemberRole } from "../utils/bank-action-guard";

describe("getAuthUserId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna userId cuando hay sesión activa", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    expect(await getAuthUserId()).toBe("user-1");
  });

  it("retorna null cuando no hay sesión", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    expect(await getAuthUserId()).toBeNull();
  });
});

describe("getMemberRole", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna el rol cuando el usuario es miembro", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    const role = await getMemberRole("user-1", "co-1");
    expect(role).toBe("ACCOUNTANT");
  });

  it("retorna null cuando el usuario no es miembro", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(null);
    const role = await getMemberRole("user-1", "co-1");
    expect(role).toBeNull();
  });

  it("consulta por userId y companyId correctamente", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "OWNER" } as never);
    await getMemberRole("user-abc", "co-xyz");
    expect(prisma.companyMember.findUnique).toHaveBeenCalledWith({
      where: { userId_companyId: { userId: "user-abc", companyId: "co-xyz" } },
      select: { role: true },
    });
  });
});
