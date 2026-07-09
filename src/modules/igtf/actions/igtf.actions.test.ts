// src/modules/igtf/actions/igtf.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    iGTFTransaction: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    companyMember: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  fiscalKey: vi.fn((companyId: string, userId: string) => `${companyId}:${userId}`),
  limiters: { fiscal: {}, ocr: {} },
}));

vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi.fn().mockImplementation(
    (_companyId: string, _tx: unknown, fn: (_tx: unknown) => unknown) => fn(_tx)
  ),
}));

import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { checkRateLimit } from "@/lib/ratelimit";
import { createIGTFAction, getIGTFAction } from "./igtf.actions";

const mockIGTF = {
  id: "igtf-1",
  companyId: "company-1",
  amount: { toString: () => "1000.00" },
  igtfRate: { toString: () => "3" },
  igtfAmount: { toString: () => "30.00" },
  currency: "USD",
  concept: "Pago a proveedor en USD",
  createdAt: new Date("2026-03-14"),
  createdBy: "user-1",
};

const VALID_INPUT = {
  companyId: "company-1",
  amount: "1000.00",
  currency: "USD" as const,
  concept: "Pago a proveedor en USD",
};

describe("createIGTFAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) => fn({ iGTFTransaction: prisma.iGTFTransaction, auditLog: prisma.auditLog })) as never
    );
  });

  it("retorna error si no autenticado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await createIGTFAction(VALID_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("retorna error si rate limit agotado", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, error: "Demasiadas solicitudes." });
    const r = await createIGTFAction(VALID_INPUT);
    expect(r.success).toBe(false);
  });

  it("retorna error si no es miembro de la empresa", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const r = await createIGTFAction(VALID_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("Empresa no encontrada");
  });

  it("retorna error si rol VIEWER no tiene acceso contable", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const r = await createIGTFAction(VALID_INPUT);
    expect(r.success).toBe(false);
  });

  it("crea registro IGTF correctamente", async () => {
    vi.mocked(prisma.iGTFTransaction.create).mockResolvedValue(mockIGTF as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await createIGTFAction({
      companyId: "company-1",
      amount: "1000.00",
      currency: "USD",
      concept: "Pago a proveedor en USD",
      createdBy: "user-1",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.igtfAmount).toBe("30.00");
    expect(result.data.currency).toBe("USD");
  });

  it("crea registro IGTF en EUR", async () => {
    const mockEUR = { ...mockIGTF, currency: "EUR" };
    vi.mocked(prisma.iGTFTransaction.create).mockResolvedValue(mockEUR as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await createIGTFAction({
      companyId: "company-1",
      amount: "1000.00",
      currency: "EUR",
      concept: "Pago en euros",
      createdBy: "user-1",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.currency).toBe("EUR");
  });

  it("falla con monto inv├ílido", async () => {
    const result = await createIGTFAction({
      companyId: "company-1",
      amount: "-100",
      currency: "USD",
      concept: "Pago",
      createdBy: "user-1",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("Monto");
  });

  it("falla con concepto vac├¡o", async () => {
    const result = await createIGTFAction({
      companyId: "company-1",
      amount: "1000.00",
      currency: "USD",
      concept: "",
      createdBy: "user-1",
    });

    expect(result.success).toBe(false);
  });
});

describe("getIGTFAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
  });

  it("retorna error si no autenticado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await getIGTFAction("company-1");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("No autorizado");
  });

  it("retorna error si no es miembro de la empresa", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const r = await getIGTFAction("company-1");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("acceso denegado");
  });

  it("retorna error si rol VIEWER no tiene acceso contable", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const r = await getIGTFAction("company-1");
    expect(r.success).toBe(false);
  });

  it("retorna lista de registros IGTF", async () => {
    vi.mocked(prisma.iGTFTransaction.findMany).mockResolvedValue([mockIGTF] as never);

    const result = await getIGTFAction("company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].igtfAmount).toBe("30.00");
  });

  it("retorna lista vac├¡a si no hay registros", async () => {
    vi.mocked(prisma.iGTFTransaction.findMany).mockResolvedValue([] as never);

    const result = await getIGTFAction("company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(0);
  });
});