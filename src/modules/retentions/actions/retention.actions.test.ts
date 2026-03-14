// src/modules/retentions/actions/retention.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    retencion: {
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
import { createRetentionAction, getRetentionsAction } from "./retention.actions";

const mockRetention = {
  id: "ret-1",
  companyId: "company-1",
  providerName: "Distribuidora ABC C.A.",
  providerRif: "J-12345678-9",
  invoiceNumber: "B00000001",
  invoiceDate: new Date("2026-03-10"),
  invoiceAmount: { toString: () => "1160.00" },
  taxBase: { toString: () => "1000.00" },
  ivaAmount: { toString: () => "160.00" },
  ivaRetention: { toString: () => "120.00" },
  ivaRetentionPct: { toString: () => "75" },
  islrAmount: null,
  islrRetentionPct: null,
  totalRetention: { toString: () => "120.00" },
  type: "IVA",
  status: "PENDING",
  createdBy: "user-1",
  createdAt: new Date("2026-03-10"),
};

describe("createRetentionAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("crea retención IVA correctamente", async () => {
    vi.mocked(prisma.retencion.create).mockResolvedValue(mockRetention as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await createRetentionAction({
      companyId: "company-1",
      providerName: "Distribuidora ABC C.A.",
      providerRif: "J-12345678-9",
      invoiceNumber: "B00000001",
      invoiceDate: new Date("2026-03-10"),
      invoiceAmount: "1160.00",
      taxBase: "1000.00",
      ivaAmount: "160.00",
      ivaRetentionPct: 75,
      type: "IVA",
      createdBy: "user-1",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.ivaRetention).toBe("120.00");
    expect(result.data.totalRetention).toBe("120.00");
    expect(result.data.status).toBe("PENDING");
  });

  it("crea retención AMBAS (IVA + ISLR) correctamente", async () => {
    const mockAmbas = {
      ...mockRetention,
      islrAmount: { toString: () => "20.00" },
      islrRetentionPct: { toString: () => "2" },
      totalRetention: { toString: () => "140.00" },
      type: "AMBAS",
    };

    vi.mocked(prisma.retencion.create).mockResolvedValue(mockAmbas as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await createRetentionAction({
      companyId: "company-1",
      providerName: "Distribuidora ABC C.A.",
      providerRif: "J-12345678-9",
      invoiceNumber: "B00000001",
      invoiceDate: new Date("2026-03-10"),
      invoiceAmount: "1160.00",
      taxBase: "1000.00",
      ivaAmount: "160.00",
      ivaRetentionPct: 75,
      islrCode: "SERVICIOS_PJ",
      type: "AMBAS",
      createdBy: "user-1",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.islrAmount).toBe("20.00");
    expect(result.data.totalRetention).toBe("140.00");
  });

  it("falla con RIF inválido", async () => {
    const result = await createRetentionAction({
      companyId: "company-1",
      providerName: "ABC",
      providerRif: "12345678",
      invoiceNumber: "B00000001",
      invoiceDate: new Date("2026-03-10"),
      invoiceAmount: "1160.00",
      taxBase: "1000.00",
      ivaAmount: "160.00",
      ivaRetentionPct: 75,
      type: "IVA",
      createdBy: "user-1",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("RIF");
  });
});

describe("getRetentionsAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna lista de retenciones", async () => {
    vi.mocked(prisma.retencion.findMany).mockResolvedValue([mockRetention] as never);

    const result = await getRetentionsAction("company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].providerRif).toBe("J-12345678-9");
  });

  it("retorna lista vacía si no hay retenciones", async () => {
    vi.mocked(prisma.retencion.findMany).mockResolvedValue([] as never);

    const result = await getRetentionsAction("company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(0);
  });
});
