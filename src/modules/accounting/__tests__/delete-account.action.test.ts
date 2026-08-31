// src/modules/accounting/__tests__/delete-account.action.test.ts
//
// Antes NO habia forma de quitar una cuenta del plan: solo crear y editar. Una
// cuenta creada por error se quedaba para siempre en todos los desplegables.

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  fiscalKey: (c: string, u: string) => c + ":" + u,
  limiters: { fiscal: {}, read: {} },
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user-1", has: () => true }),
}));
vi.mock("@/lib/action-guard", () => ({
  requireCompanyAction: vi.fn().mockResolvedValue({
    ok: true, userId: "user-1", role: "ADMIN",
    ipAddress: "1.2.3.4", userAgent: "ua",
  }),
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    account: { findUnique: vi.fn(), updateMany: vi.fn() },
    journalEntry: { count: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const CUENTA = {
  id: "acc-1", code: "1000", name: "Carlos Eduardo Rivas",
  type: "ASSET", companyId: "co-1", deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.account.findUnique).mockResolvedValue(CUENTA as never);
  vi.mocked(prisma.journalEntry.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.account.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
    fn({ account: prisma.account, auditLog: prisma.auditLog })) as never);
});

describe("deleteAccountAction", () => {
  it("borra en LOGICO una cuenta sin movimiento, con AuditLog (R-6)", async () => {
    const { deleteAccountAction } = await import("../actions/account.actions");
    const r = await deleteAccountAction("acc-1");

    expect(r.success).toBe(true);
    // Logico, no fisico: un asiento futuro nunca debe quedar apuntando a nada.
    const data = vi.mocked(prisma.account.updateMany).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.deletedAt).toBeInstanceOf(Date);

    const audit = vi.mocked(prisma.auditLog.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(audit.action).toBe("DELETE");
    expect(audit.ipAddress).toBe("1.2.3.4");
    expect((audit.oldValue as Record<string, unknown>).code).toBe("1000");
  });

  it("RECHAZA una cuenta CON asientos: borrarla romperia el Libro Mayor", async () => {
    vi.mocked(prisma.journalEntry.count).mockResolvedValue(7 as never);
    const { deleteAccountAction } = await import("../actions/account.actions");

    const r = await deleteAccountAction("acc-1");

    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("7 asientos");
    expect(vi.mocked(prisma.account.updateMany)).not.toHaveBeenCalled();
  });

  it("el where del borrado lleva companyId y deletedAt: null", async () => {
    // companyId: aislamiento aplicativo, la RLS no cubre esto (ADR-044).
    // deletedAt: cierra la ventana entre el conteo y la escritura.
    const { deleteAccountAction } = await import("../actions/account.actions");
    await deleteAccountAction("acc-1");

    const where = vi.mocked(prisma.account.updateMany).mock.calls[0][0].where as Record<string, unknown>;
    expect(where.companyId).toBe("co-1");
    expect(where.deletedAt).toBeNull();
  });

  it("una cuenta ya borrada no se borra dos veces", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue({
      ...CUENTA, deletedAt: new Date(),
    } as never);
    const { deleteAccountAction } = await import("../actions/account.actions");

    const r = await deleteAccountAction("acc-1");
    expect(r.success).toBe(false);
    expect(vi.mocked(prisma.account.updateMany)).not.toHaveBeenCalled();
  });

  it("cuenta inexistente devuelve error, no revienta", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null as never);
    const { deleteAccountAction } = await import("../actions/account.actions");

    const r = await deleteAccountAction("no-existe");
    expect(r.success).toBe(false);
  });
});
