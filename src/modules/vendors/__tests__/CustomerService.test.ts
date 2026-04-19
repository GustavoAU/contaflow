// src/modules/vendors/__tests__/CustomerService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { CustomerService } from "../services/CustomerService";

vi.mock("@/lib/prisma", () => ({
  default: {
    customer: {
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
  id: "cu1", companyId: "c1", name: "Cliente SA", rif: null, email: null, phone: null, address: null,
  deletedAt: null, createdAt: NOW, updatedAt: NOW,
};

beforeEach(() => vi.clearAllMocks());

describe("CustomerService.list", () => {
  it("filtra por companyId y deletedAt null", async () => {
    vi.mocked(prisma.customer.findMany).mockResolvedValue([base] as never);
    await CustomerService.list("c1");
    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: "c1", deletedAt: null } }),
    );
  });
});

describe("CustomerService.get — IDOR (LOW-2)", () => {
  it("retorna null si companyId no coincide", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(base as never);
    const result = await CustomerService.get("otroTenant", "cu1");
    expect(result).toBeNull();
  });
});

describe("CustomerService.linkToInvoice — IDOR guards (CRITICAL-1, HIGH-1)", () => {
  const invoice = { id: "inv1", companyId: "c1" };

  it("rechaza si invoice pertenece a otro tenant", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: "inv1", companyId: "otroTenant" } as never);
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(base as never);
    const ok = await CustomerService.linkToInvoice("c1", "inv1", "cu1");
    expect(ok).toBe(false);
  });

  it("rechaza si customer eliminado (HIGH-1)", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(invoice as never);
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({ ...base, deletedAt: NOW } as never);
    const ok = await CustomerService.linkToInvoice("c1", "inv1", "cu1");
    expect(ok).toBe(false);
  });

  it("vincula si todo es válido", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(invoice as never);
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(base as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    const ok = await CustomerService.linkToInvoice("c1", "inv1", "cu1");
    expect(ok).toBe(true);
  });
});
