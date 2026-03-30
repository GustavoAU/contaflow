// src/modules/retentions/actions/retention.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    retencion: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    companyMember: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    invoice: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@/modules/retentions/services/RetentionVoucherPDFService", () => ({
  generateRetentionVoucherPDF: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
}));

vi.mock("../services/RetentionService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/RetentionService")>();
  return {
    ...actual,
    linkRetentionToInvoice: vi.fn(),
    getNextVoucherNumber: vi.fn().mockResolvedValue("CR-00000001"),
  };
});

import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { generateRetentionVoucherPDF } from "../services/RetentionVoucherPDFService";
import { linkRetentionToInvoice } from "../services/RetentionService";
import {
  createRetentionAction,
  getRetentionsAction,
  exportRetentionVoucherPDFAction,
  linkRetentionToInvoiceAction,
} from "./retention.actions";

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
  voucherNumber: "CR-00000001",
  type: "IVA",
  status: "PENDING",
  createdBy: "user-1",
  createdAt: new Date("2026-03-10"),
};

describe("createRetentionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // $transaction interactivo: pasa tx con los mismos mocks de retencion y auditLog
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
      const tx = {
        retencion: { create: vi.mocked(prisma.retencion.create) },
        auditLog: { create: vi.mocked(prisma.auditLog.create) },
        retentionSequence: { upsert: vi.fn().mockResolvedValue({ lastNumber: 1 }) },
      };
      return fn(tx as never);
    });
  });

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
    expect(result.data.voucherNumber).toBe("CR-00000001");
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

// ── Fixtures para nuevas actions ──────────────────────────────────────────────

const mockCompanyForPDF = {
  id: "company-1",
  name: "Empresa Test C.A.",
  rif: "J-12345678-9",
  address: null,
  status: "ACTIVE",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockMembership = {
  id: "mem-1",
  userId: "user-1",
  companyId: "company-1",
  role: "ACCOUNTANT",
  company: mockCompanyForPDF,
};

const mockRetentionFull = {
  ...mockRetention,
  company: mockCompanyForPDF,
  taxBase: { toString: () => "1000.00", toFixed: () => "1000.00" },
  invoiceAmount: { toString: () => "1160.00", toFixed: () => "1160.00" },
  totalRetention: { toString: () => "120.00", toFixed: () => "120.00" },
  ivaRetentionPct: { toString: () => "75", toNumber: () => 75 },
  islrRetentionPct: null,
};

// ── Tests: exportRetentionVoucherPDFAction ────────────────────────────────────

describe("exportRetentionVoucherPDFAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna error si no hay sesion autenticada", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await exportRetentionVoucherPDFAction("ret-1", "company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna error si retencion no encontrada (findFirst null)", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMembership as never);
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue(null);

    const result = await exportRetentionVoucherPDFAction("ret-999", "company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Retención no encontrada");
  });

  it("happy path: retorna buffer PDF serializable", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMembership as never);
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue(mockRetentionFull as never);
    vi.mocked(generateRetentionVoucherPDF).mockResolvedValue(Buffer.from("fake-pdf"));

    const result = await exportRetentionVoucherPDFAction("ret-1", "company-1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.buffer).toEqual(expect.any(Array));
      expect(result.buffer.length).toBeGreaterThan(0);
    }
    expect(generateRetentionVoucherPDF).toHaveBeenCalledOnce();
  });

  it("usa retention.id como fallback si voucherNumber es null", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMembership as never);
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue(
      { ...mockRetentionFull, voucherNumber: null } as never
    );
    vi.mocked(generateRetentionVoucherPDF).mockResolvedValue(Buffer.from("fake-pdf"));

    await exportRetentionVoucherPDFAction("ret-1", "company-1");

    expect(generateRetentionVoucherPDF).toHaveBeenCalledWith(
      expect.objectContaining({ voucherNumber: "ret-1" })
    );
  });
});

// ── Tests: linkRetentionToInvoiceAction ───────────────────────────────────────

describe("linkRetentionToInvoiceAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna error si no hay sesion autenticada", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await linkRetentionToInvoiceAction("ret-1", "inv-1", "company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("happy path: vincula retencion y llama revalidatePath", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMembership as never);
    vi.mocked(linkRetentionToInvoice).mockResolvedValue({} as never);

    const result = await linkRetentionToInvoiceAction("ret-1", "inv-1", "company-1");

    expect(result.success).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/accounting/retentions");
    expect(linkRetentionToInvoice).toHaveBeenCalledWith("ret-1", "inv-1", "company-1");
  });
});
