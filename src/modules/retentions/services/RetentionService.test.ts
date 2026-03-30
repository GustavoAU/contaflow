// src/modules/retentions/services/RetentionService.test.ts
import { describe, it, expect } from "vitest";
import { RetentionService } from "./RetentionService";

describe("RetentionService.calculateIvaRetention", () => {
  it("calcula retención IVA al 75% correctamente", () => {
    const result = RetentionService.calculateIvaRetention("1000.00", 16, 75);
    expect(result.ivaAmount).toBe("160.00");
    expect(result.ivaRetention).toBe("120.00");
    expect(result.ivaRetentionPct).toBe(75);
  });

  it("calcula retención IVA al 100% correctamente", () => {
    const result = RetentionService.calculateIvaRetention("1000.00", 16, 100);
    expect(result.ivaAmount).toBe("160.00");
    expect(result.ivaRetention).toBe("160.00");
    expect(result.ivaRetentionPct).toBe(100);
  });

  it("calcula correctamente con base imponible decimal", () => {
    const result = RetentionService.calculateIvaRetention("840696.00", 16, 75);
    expect(result.ivaAmount).toBe("134511.36");
    expect(result.ivaRetention).toBe("100883.52");
  });
});

describe("RetentionService.calculateIslrRetention", () => {
  it("calcula retención ISLR para servicios PJ al 2%", () => {
    const result = RetentionService.calculateIslrRetention("1000.00", "SERVICIOS_PJ");
    expect(result).not.toBeNull();
    expect(result!.islrAmount).toBe("20.00");
    expect(result!.islrRetentionPct).toBe(2);
  });

  it("calcula retención ISLR para honorarios PN al 5%", () => {
    const result = RetentionService.calculateIslrRetention("1000.00", "HONORARIOS_PN");
    expect(result).not.toBeNull();
    expect(result!.islrAmount).toBe("50.00");
    expect(result!.islrRetentionPct).toBe(5);
  });

  it("retorna null si el código ISLR no existe", () => {
    const result = RetentionService.calculateIslrRetention("1000.00", "CODIGO_INVALIDO");
    expect(result).toBeNull();
  });
});

describe("RetentionService.calculate", () => {
  it("calcula retención completa IVA + ISLR", () => {
    const result = RetentionService.calculate("1000.00", 75, "SERVICIOS_PJ");
    expect(result.ivaRetention).toBe("120.00");
    expect(result.islrAmount).toBe("20.00");
    expect(result.totalRetention).toBe("140.00");
  });

  it("calcula retención solo IVA sin ISLR", () => {
    const result = RetentionService.calculate("1000.00", 75);
    expect(result.ivaRetention).toBe("120.00");
    expect(result.islrAmount).toBeNull();
    expect(result.totalRetention).toBe("120.00");
  });

  it("calcula retención IVA 100% + ISLR", () => {
    const result = RetentionService.calculate("1000.00", 100, "SERVICIOS_PJ");
    expect(result.ivaRetention).toBe("160.00");
    expect(result.islrAmount).toBe("20.00");
    expect(result.totalRetention).toBe("180.00");
  });
});

describe("RetentionService.validateRif", () => {
  it("valida RIF correcto formato J", () => {
    expect(RetentionService.validateRif("J-40137367-4")).toBe(true);
  });

  it("valida RIF correcto formato V", () => {
    expect(RetentionService.validateRif("V-12345678-9")).toBe(true);
  });

  it("rechaza RIF sin guiones", () => {
    expect(RetentionService.validateRif("J401373674")).toBe(false);
  });

  it("rechaza RIF con letra inválida", () => {
    expect(RetentionService.validateRif("X-12345678-9")).toBe(false);
  });
});

// ─── Tests para linkRetentionToInvoice y getRetentionsByInvoice ───────────────

import { vi, beforeEach } from "vitest";
import { linkRetentionToInvoice, getRetentionsByInvoice } from "./RetentionService";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    retencion: { findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    invoice: { findFirst: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";

const mockRetencion = {
  id: "ret-1",
  companyId: "comp-1",
  providerName: "Proveedor S.A.",
  providerRif: "J-12345678-9",
  invoiceNumber: "0001",
  invoiceDate: new Date("2026-01-15"),
  invoiceAmount: "1000.00",
  taxBase: "1000.00",
  ivaAmount: "160.00",
  ivaRetention: "120.00",
  ivaRetentionPct: "75",
  islrAmount: null,
  islrRetentionPct: null,
  totalRetention: "120.00",
  voucherNumber: "CR-00000001",
  type: "IVA",
  status: "PENDING",
  transactionId: null,
  invoiceId: null,
  idempotencyKey: "key-1",
  deletedAt: null,
  createdAt: new Date("2026-01-15"),
  createdBy: "user-1",
};

const mockInvoice = {
  id: "inv-1",
  companyId: "comp-1",
  ivaRetentionAmount: "0",
  ivaRetentionVoucher: null,
  ivaRetentionDate: null,
  islrRetentionAmount: "0",
};

describe("linkRetentionToInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: vincula retención a factura y sincroniza campos de Invoice", async () => {
    const updatedRetencion = { ...mockRetencion, invoiceId: "inv-1", invoice: mockInvoice };

    vi.mocked(prisma.retencion.findFirst).mockResolvedValue(mockRetencion as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(mockInvoice as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([updatedRetencion, {}, {}] as never);

    const result = await linkRetentionToInvoice("ret-1", "inv-1", "comp-1");

    expect(result.invoiceId).toBe("inv-1");
    expect(result.invoice).toEqual(mockInvoice);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it("lanza error si retención no pertenece a companyId", async () => {
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue(null as never);

    await expect(linkRetentionToInvoice("ret-x", "inv-1", "comp-1")).rejects.toThrow(
      "Retención no encontrada"
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("lanza error si factura no pertenece a companyId", async () => {
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue(mockRetencion as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null as never);

    await expect(linkRetentionToInvoice("ret-1", "inv-x", "comp-1")).rejects.toThrow(
      "Factura no encontrada"
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("getRetentionsByInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: retorna array de 2 retenciones para una factura", async () => {
    const retenciones = [
      { ...mockRetencion, id: "ret-1", invoiceId: "inv-1" },
      { ...mockRetencion, id: "ret-2", invoiceId: "inv-1" },
    ];
    vi.mocked(prisma.retencion.findMany).mockResolvedValue(retenciones as never);

    const result = await getRetentionsByInvoice("inv-1", "comp-1");

    expect(result).toHaveLength(2);
    expect(prisma.retencion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("retorna array vacío si no hay retenciones vinculadas (no throw)", async () => {
    vi.mocked(prisma.retencion.findMany).mockResolvedValue([] as never);

    const result = await getRetentionsByInvoice("inv-sin-retenciones", "comp-1");

    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });
});
