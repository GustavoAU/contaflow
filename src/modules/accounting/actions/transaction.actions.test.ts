// src/modules/accounting/actions/transaction.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    transaction: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    companyMember: {
      findUnique: vi.fn(),
    },
    accountingPeriod: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {}, read: {} },
}));

vi.mock("@/lib/report-cache", () => ({
  withPeriodCache: vi.fn().mockImplementation((_key: unknown, fn: () => unknown) => fn()),
  invalidatePeriod: vi.fn(),
}));

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import {
  getTransactionsByCompanyAction,
  getTransactionsPaginatedAction,
} from "./transaction.actions";

// ─── getTransactionsByCompanyAction ──────────────────────────────────────────

describe("getTransactionsByCompanyAction — auth guards (HIGH finding)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rechaza llamada sin autenticar", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await getTransactionsByCompanyAction("company-1");

    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe("No autorizado");
  });

  it("rechaza usuario autenticado que no es miembro de la empresa", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-outsider" } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(null);

    const result = await getTransactionsByCompanyAction("company-1");

    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe("No autorizado");
  });

  it("permite acceso a miembro válido de la empresa", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({
      userId: "user-1",
      companyId: "company-1",
      role: "ACCOUNTANT",
    } as never);
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

    const result = await getTransactionsByCompanyAction("company-1");

    expect(result.success).toBe(true);
  });
});

// ─── getTransactionsPaginatedAction ──────────────────────────────────────────

describe("getTransactionsPaginatedAction — membership guard (HIGH finding)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rechaza llamada sin autenticar", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await getTransactionsPaginatedAction("company-1");

    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe("No autorizado");
  });

  it("rechaza usuario autenticado que no pertenece a la empresa (IDOR)", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-attacker" } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(null);

    const result = await getTransactionsPaginatedAction("company-victim");

    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe("No autorizado");
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });

  it("permite acceso a miembro válido con rol VIEWER", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({
      userId: "user-1",
      companyId: "company-1",
      role: "VIEWER",
    } as never);
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

    const result = await getTransactionsPaginatedAction("company-1");

    expect(result.success).toBe(true);
  });
});
