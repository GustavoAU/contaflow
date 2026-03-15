// src/modules/igtf/actions/igtf.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    iGTFTransaction: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import prisma from "@/lib/prisma";
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

describe("createIGTFAction", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("falla con monto inválido", async () => {
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

  it("falla con concepto vacío", async () => {
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
  beforeEach(() => vi.clearAllMocks());

  it("retorna lista de registros IGTF", async () => {
    vi.mocked(prisma.iGTFTransaction.findMany).mockResolvedValue([mockIGTF] as never);

    const result = await getIGTFAction("company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].igtfAmount).toBe("30.00");
  });

  it("retorna lista vacía si no hay registros", async () => {
    vi.mocked(prisma.iGTFTransaction.findMany).mockResolvedValue([] as never);

    const result = await getIGTFAction("company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(0);
  });
});
