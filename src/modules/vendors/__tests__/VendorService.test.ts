// src/modules/vendors/__tests__/VendorService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { VendorService } from "../services/VendorService";

vi.mock("@/lib/prisma", () => ({
  default: {
    vendor: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    invoice: {
      count: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

const NOW = new Date("2026-01-01");
const base = {
  id: "v1", companyId: "c1", name: "Acme", rif: null, email: null, phone: null, address: null,
  deletedAt: null, createdAt: NOW, updatedAt: NOW,
};

beforeEach(() => vi.clearAllMocks());

describe("VendorService.list", () => {
  it("filtra por companyId y deletedAt null", async () => {
    vi.mocked(prisma.vendor.findMany).mockResolvedValue([base] as never);
    const result = await VendorService.list("c1");
    expect(prisma.vendor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: "c1", deletedAt: null } }),
    );
    expect(result).toHaveLength(1);
  });
});

describe("VendorService.get", () => {
  it("retorna vendor si companyId coincide", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue(base as never);
    const result = await VendorService.get("c1", "v1");
    expect(result).toEqual(base);
  });

  it("retorna null si companyId no coincide (IDOR)", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue(base as never);
    const result = await VendorService.get("otroTenant", "v1");
    expect(result).toBeNull();
  });

  it("retorna null si vendor no existe", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue(null as never);
    const result = await VendorService.get("c1", "v_inexistente");
    expect(result).toBeNull();
  });
});

describe("VendorService.create", () => {
  it("crea vendor con companyId", async () => {
    vi.mocked(prisma.vendor.create).mockResolvedValue({ ...base, name: "Nuevo" } as never);
    const result = await VendorService.create("c1", { name: "Nuevo" });
    expect(prisma.vendor.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: "c1", name: "Nuevo" }) }),
    );
    expect(result.name).toBe("Nuevo");
  });
});

describe("VendorService.update", () => {
  it("actualiza vendor existente", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue(base as never);
    vi.mocked(prisma.vendor.update).mockResolvedValue({ ...base, name: "Actualizado" } as never);
    const result = await VendorService.update("c1", "v1", { name: "Actualizado" });
    expect(result?.name).toBe("Actualizado");
  });

  it("retorna null si companyId no coincide", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue(base as never);
    const result = await VendorService.update("otroTenant", "v1", { name: "X" });
    expect(result).toBeNull();
    expect(prisma.vendor.update).not.toHaveBeenCalled();
  });

  it("retorna null si vendor ya fue eliminado", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue({ ...base, deletedAt: NOW } as never);
    const result = await VendorService.update("c1", "v1", { name: "X" });
    expect(result).toBeNull();
  });
});

describe("VendorService.softDelete", () => {
  it("elimina vendor y retorna linkedCount", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue(base as never);
    vi.mocked(prisma.invoice.count).mockResolvedValue(3 as never);
    vi.mocked(prisma.vendor.update).mockResolvedValue({ ...base, deletedAt: NOW } as never);
    const result = await VendorService.softDelete("c1", "v1");
    expect(result).toEqual({ deleted: true, linkedCount: 3 });
  });

  it("retorna deleted:false si vendor no existe", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue(null as never);
    const result = await VendorService.softDelete("c1", "v_inexistente");
    expect(result).toEqual({ deleted: false, linkedCount: 0 });
    expect(prisma.vendor.update).not.toHaveBeenCalled();
  });

  it("retorna deleted:false si companyId no coincide (IDOR)", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue(base as never);
    const result = await VendorService.softDelete("otroTenant", "v1");
    expect(result).toEqual({ deleted: false, linkedCount: 0 });
  });
});

describe("VendorService.linkToInvoice — IDOR guards (CRITICAL-1, HIGH-1)", () => {
  const invoice = { id: "inv1", companyId: "c1" };

  it("vincula exitosamente si todo coincide", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(invoice as never);
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue(base as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    const ok = await VendorService.linkToInvoice("c1", "inv1", "v1");
    expect(ok).toBe(true);
  });

  it("rechaza si invoice pertenece a otro tenant (CRITICAL-1)", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: "inv1", companyId: "otroTenant" } as never);
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue(base as never);
    const ok = await VendorService.linkToInvoice("c1", "inv1", "v1");
    expect(ok).toBe(false);
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("rechaza si vendor pertenece a otro tenant (CRITICAL-1)", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(invoice as never);
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue({ ...base, companyId: "otroTenant" } as never);
    const ok = await VendorService.linkToInvoice("c1", "inv1", "v1");
    expect(ok).toBe(false);
  });

  it("rechaza si vendor está eliminado (HIGH-1)", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(invoice as never);
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue({ ...base, deletedAt: NOW } as never);
    const ok = await VendorService.linkToInvoice("c1", "inv1", "v1");
    expect(ok).toBe(false);
  });

  it("rechaza si invoice no existe", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue(base as never);
    const ok = await VendorService.linkToInvoice("c1", "inv1", "v1");
    expect(ok).toBe(false);
  });
});
