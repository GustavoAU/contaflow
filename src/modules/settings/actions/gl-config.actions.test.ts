// src/modules/settings/actions/gl-config.actions.test.ts
//
// saveGLConfigAction no tenía tests. Se agrega uno enfocado: el guard nuevo
// que verifica que las 11 cuentas GL pertenezcan a la empresa (hallazgo
// MEDIUM del security-agent, 2026-09-05) — no cobertura exhaustiva de la
// action completa, que ya existía sin tests antes de este cambio.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  fiscalKey: (c: string, u: string) => `${c}:${u}`,
  limiters: { fiscal: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    companySettings: { upsert: vi.fn() },
    account: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { saveGLConfigAction } from "./gl-config.actions";

const COMPANY_ID = "co-1";
const USER_ID = "user-1";

const BASE_INPUT = {
  companyId: COMPANY_ID,
  arAccountId: "acc-ar",
  apAccountId: null,
  salesAccountId: null,
  purchaseExpenseAccountId: null,
  inventoryAccountId: null,
  ivaDFAccountId: null,
  ivaCFAccountId: null,
  ivaRetentionPayableAccountId: null,
  ivaRetentionReceivableAccountId: null,
  fxGainAccountId: null,
  fxLossAccountId: null,
  igtfPayableAccountId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ADMIN" } as never);
  vi.mocked(prisma.companySettings.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  // Por defecto, la única cuenta que este input pide (acc-ar) existe y es de COMPANY_ID.
  vi.mocked(prisma.account.findMany).mockResolvedValue([{ id: "acc-ar" }] as never);
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: unknown) => unknown) =>
      fn({ companySettings: prisma.companySettings, account: prisma.account, auditLog: prisma.auditLog })) as never
  );
});

describe("saveGLConfigAction — guard de cuentas ajenas", () => {
  it("RECHAZA si una cuenta no pertenece a esta empresa", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([] as never); // acc-ar no es de COMPANY_ID
    const res = await saveGLConfigAction(BASE_INPUT);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/no existe o no pertenece/);
    expect(prisma.companySettings.upsert).not.toHaveBeenCalled();
  });

  it("permite guardar cuando todas las cuentas son de esta empresa", async () => {
    const res = await saveGLConfigAction(BASE_INPUT);
    expect(res.success).toBe(true);
    expect(prisma.companySettings.upsert).toHaveBeenCalled();
  });

  it("no consulta nada si ninguna cuenta viene asignada", async () => {
    await saveGLConfigAction({ ...BASE_INPUT, arAccountId: null });
    expect(prisma.account.findMany).not.toHaveBeenCalled();
    expect(prisma.companySettings.upsert).toHaveBeenCalled();
  });
});
