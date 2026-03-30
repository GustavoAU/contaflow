// src/modules/company/actions/company.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

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
    $transaction: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import {
  createCompanyAction,
  archiveCompanyAction,
  reactivateCompanyAction,
} from "./company.actions";

const mockCompany = {
  id: "company-1",
  name: "Empresa Test C.A.",
  rif: "J-12345678-9",
  address: null,
  status: "ACTIVE",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("createCompanyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) => fn({ company: prisma.company, auditLog: prisma.auditLog })) as never
    );
  });

  it("crea una empresa correctamente", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.company.create).mockResolvedValue(mockCompany as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await createCompanyAction({
      name: "Empresa Test C.A.",
      userId: "user-1",
      rif: "J-12345678-9",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Empresa Test C.A.");
  });

  it("retorna error si el nombre es muy corto", async () => {
    const result = await createCompanyAction({
      name: "A",
      userId: "user-1",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("2 caracteres");
  });

  it("retorna error si el RIF ya existe", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue(mockCompany as never);

    const result = await createCompanyAction({
      name: "Otra Empresa",
      userId: "user-1",
      rif: "J-12345678-9",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("RIF");
  });
});

describe("archiveCompanyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) => fn({ company: prisma.company, auditLog: prisma.auditLog })) as never
    );
  });

  it("archiva una empresa correctamente", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.company.findUnique).mockResolvedValue(mockCompany as never);
    vi.mocked(prisma.company.update).mockResolvedValue({
      ...mockCompany,
      status: "ARCHIVED",
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await archiveCompanyAction("company-1", "user-1");

    expect(result.success).toBe(true);
  });

  it("retorna error si hay período abierto", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);

    const result = await archiveCompanyAction("company-1", "user-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("período contable abierto");
  });
});

describe("reactivateCompanyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) => fn({ company: prisma.company, auditLog: prisma.auditLog })) as never
    );
  });

  it("reactiva una empresa archivada correctamente", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      ...mockCompany,
      status: "ARCHIVED",
    } as never);
    vi.mocked(prisma.company.update).mockResolvedValue(mockCompany as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await reactivateCompanyAction("company-1", "user-1");

    expect(result.success).toBe(true);
  });

  it("retorna error si la empresa ya está activa", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue(mockCompany as never);

    const result = await reactivateCompanyAction("company-1", "user-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("ya está activa");
  });
});