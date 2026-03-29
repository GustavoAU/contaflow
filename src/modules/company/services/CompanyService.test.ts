// src/modules/company/services/CompanyService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    company: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    accountingPeriod: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

import prisma from "@/lib/prisma";
import { CompanyService } from "./CompanyService";

const mockCompany = {
  id: "company-1",
  name: "Empresa Test C.A.",
  rif: "J-12345678-9",
  address: null,
  status: "ACTIVE",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("CompanyService.createCompany", () => {
  beforeEach(() => vi.clearAllMocks());

  it("crea una empresa correctamente", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.company.create).mockResolvedValue(mockCompany as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await CompanyService.createCompany(
      "Empresa Test C.A.",
      "user-1",
      "J-12345678-9"
    );

    expect(result.name).toBe("Empresa Test C.A.");
    expect(prisma.company.create).toHaveBeenCalledOnce();
  });

  it("lanza error si el RIF ya existe", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue(mockCompany as never);

    await expect(
      CompanyService.createCompany("Otra Empresa", "user-1", "J-12345678-9")
    ).rejects.toThrow("Ya existe una empresa con el RIF");
  });
});

describe("CompanyService.archiveCompany", () => {
  beforeEach(() => vi.clearAllMocks());

  it("archiva una empresa correctamente", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.company.findUnique).mockResolvedValue(mockCompany as never);
    vi.mocked(prisma.company.update).mockResolvedValue({
      ...mockCompany,
      status: "ARCHIVED",
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await CompanyService.archiveCompany("company-1", "user-1");
    expect(result.status).toBe("ARCHIVED");
  });

  it("lanza error si hay período abierto", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);

    await expect(CompanyService.archiveCompany("company-1", "user-1")).rejects.toThrow(
      "período contable abierto"
    );
  });

  it("lanza error si la empresa ya está archivada", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      ...mockCompany,
      status: "ARCHIVED",
    } as never);

    await expect(CompanyService.archiveCompany("company-1", "user-1")).rejects.toThrow(
      "ya está archivada"
    );
  });
});

describe("CompanyService.reactivateCompany", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reactiva una empresa archivada correctamente", async () => {
    const archived = { ...mockCompany, status: "ARCHIVED" };
    vi.mocked(prisma.company.findUnique).mockResolvedValue(archived as never);
    vi.mocked(prisma.company.update).mockResolvedValue(mockCompany as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await CompanyService.reactivateCompany("company-1", "user-1");
    expect(result.status).toBe("ACTIVE");
  });

  it("lanza error si la empresa ya está activa", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue(mockCompany as never);

    await expect(CompanyService.reactivateCompany("company-1", "user-1")).rejects.toThrow(
      "ya está activa"
    );
  });
});