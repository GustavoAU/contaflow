// src/modules/settings/actions/settings.actions.test.ts
// Tests for gl-config.actions.ts and stock-config.actions.ts

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
    invoice: { findMany: vi.fn(), count: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/modules/invoices/services/InvoiceGLPostingService", () => ({
  InvoiceGLPostingService: {
    canPost: vi.fn().mockReturnValue(true),
    postInvoice: vi.fn().mockResolvedValue(undefined),
  },
}));

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import {
  getGLConfigAction,
  saveGLConfigAction,
  postUnbookedInvoicesAction,
} from "./gl-config.actions";
import {
  getStockControlLevelAction,
  updateStockControlLevelAction,
} from "./stock-config.actions";

const COMPANY_ID = "co-1";
const ADMIN_MEMBER = { role: "ADMIN" };
const ACCOUNTANT_MEMBER = { role: "ACCOUNTANT" };

const GL_SETTINGS = {
  arAccountId: "acc-1",
  apAccountId: "acc-2",
  salesAccountId: "acc-3",
  purchaseExpenseAccountId: "acc-4",
  inventoryAccountId: null,
  ivaDFAccountId: "acc-5",
  ivaCFAccountId: "acc-6",
  ivaRetentionPayableAccountId: null,
  ivaRetentionReceivableAccountId: null,
  fxGainAccountId: null,
  fxLossAccountId: null,
  igtfPayableAccountId: null,
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
  vi.mocked(prisma.companySettings.findUnique).mockResolvedValue({ ...GL_SETTINGS, stockControlLevel: "WARN" } as never);
  vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.invoice.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: unknown) => unknown) =>
      fn({ companySettings: prisma.companySettings, auditLog: prisma.auditLog })) as never
  );
});

// ─── getGLConfigAction ────────────────────────────────────────────────────────

describe("getGLConfigAction", () => {
  it("sin sesión → error", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const res = await getGLConfigAction(COMPANY_ID);
    expect(res.success).toBe(false);
  });

  it("no member → error", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);
    const res = await getGLConfigAction(COMPANY_ID);
    expect(res.success).toBe(false);
  });

  it("ADMIN → success con config", async () => {
    vi.mocked(prisma.invoice.count).mockResolvedValue(2 as never);
    const res = await getGLConfigAction(COMPANY_ID);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.arAccountId).toBe("acc-1");
      expect(res.data.unbookedCount).toBe(2);
    }
  });

  it("service falla → error con mapPrismaError", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockRejectedValue(new Error("db error") as never);
    const res = await getGLConfigAction(COMPANY_ID);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("db error");
  });
});

// ─── saveGLConfigAction ───────────────────────────────────────────────────────

describe("saveGLConfigAction", () => {
  const VALID_INPUT = { companyId: COMPANY_ID, ...GL_SETTINGS };

  it("sin sesión → error", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const res = await saveGLConfigAction(VALID_INPUT);
    expect(res.success).toBe(false);
  });

  it("ACCOUNTANT (no ADMIN) → error", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);
    const res = await saveGLConfigAction(VALID_INPUT);
    expect(res.success).toBe(false);
  });

  it("datos inválidos → error", async () => {
    const res = await saveGLConfigAction({});
    expect(res.success).toBe(false);
  });

  it("ADMIN → success", async () => {
    const res = await saveGLConfigAction(VALID_INPUT);
    expect(res.success).toBe(true);
  });

  it("transaction falla → error con mapPrismaError", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error("tx failed") as never);
    const res = await saveGLConfigAction(VALID_INPUT);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("tx failed");
  });
});

// ─── postUnbookedInvoicesAction ───────────────────────────────────────────────

describe("postUnbookedInvoicesAction", () => {
  it("sin sesión → error", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const res = await postUnbookedInvoicesAction(COMPANY_ID);
    expect(res.success).toBe(false);
  });

  it("ACCOUNTANT (no ADMIN) → error", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);
    const res = await postUnbookedInvoicesAction(COMPANY_ID);
    expect(res.success).toBe(false);
  });

  it("sin config GL → error", async () => {
    vi.mocked(prisma.companySettings.findUnique).mockResolvedValue(null as never);
    const res = await postUnbookedInvoicesAction(COMPANY_ID);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("Configure primero");
  });

  it("sin facturas no causadas → success posted=0", async () => {
    const res = await postUnbookedInvoicesAction(COMPANY_ID);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.posted).toBe(0);
  });

  it("service falla → error con mapPrismaError", async () => {
    vi.mocked(prisma.invoice.findMany).mockRejectedValue(new Error("query failed") as never);
    const res = await postUnbookedInvoicesAction(COMPANY_ID);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("query failed");
  });
});

// ─── getStockControlLevelAction ───────────────────────────────────────────────

describe("getStockControlLevelAction", () => {
  it("sin sesión → error", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const res = await getStockControlLevelAction(COMPANY_ID);
    expect(res.success).toBe(false);
  });

  it("ACCOUNTANT → success, retorna nivel", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);
    const res = await getStockControlLevelAction(COMPANY_ID);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.level).toBe("WARN");
  });

  it("sin config → default WARN", async () => {
    vi.mocked(prisma.companySettings.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);
    const res = await getStockControlLevelAction(COMPANY_ID);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.level).toBe("WARN");
  });

  it("service falla → error con mapPrismaError", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockRejectedValue(new Error("db error") as never);
    const res = await getStockControlLevelAction(COMPANY_ID);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("db error");
  });
});

// ─── updateStockControlLevelAction ───────────────────────────────────────────

describe("updateStockControlLevelAction", () => {
  const VALID_INPUT = { companyId: COMPANY_ID, level: "BLOCK" };

  it("sin sesión → error", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const res = await updateStockControlLevelAction(VALID_INPUT);
    expect(res.success).toBe(false);
  });

  it("ACCOUNTANT (no ADMIN) → error", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);
    const res = await updateStockControlLevelAction(VALID_INPUT);
    expect(res.success).toBe(false);
  });

  it("datos inválidos → error", async () => {
    const res = await updateStockControlLevelAction({ companyId: COMPANY_ID, level: "INVALID" });
    expect(res.success).toBe(false);
  });

  it("ADMIN → success", async () => {
    const res = await updateStockControlLevelAction(VALID_INPUT);
    expect(res.success).toBe(true);
  });

  it("transaction falla → error con mapPrismaError", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error("tx failed") as never);
    const res = await updateStockControlLevelAction(VALID_INPUT);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("tx failed");
  });
});
