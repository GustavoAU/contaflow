// src/modules/company/actions/company.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

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
    companyMember: {
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    accountingPeriod: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  withDbRetry: vi.fn((fn: () => unknown) => fn()),
}));

import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
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
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          company: prisma.company,
          auditLog: prisma.auditLog,
          expenseCategory: { createMany: vi.fn().mockResolvedValue({ count: 9 }) },
        })) as never
    );
  });

  it("crea una empresa correctamente", async () => {
    vi.mocked(prisma.companyMember.count).mockResolvedValue(0);
    vi.mocked(prisma.company.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.company.create).mockResolvedValue(mockCompany as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await createCompanyAction({
      name: "Empresa Test C.A.",
      userId: "user-1",
      rif: "J-12345678-9",
      telefono: "0412-1234567",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Empresa Test C.A.");
  });

  it("retorna error si el nombre es muy corto", async () => {
    // Zod falla antes del count — no necesita mock
    const result = await createCompanyAction({
      name: "A",
      userId: "user-1",
      telefono: "0412-1234567",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("2 caracteres");
  });

  it("rechaza si falta el teléfono (obligatorio para recordatorios)", async () => {
    const result = await createCompanyAction({
      name: "Empresa Sin Tel C.A.",
      userId: "user-1",
      telefono: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/tel[eé]fono/i);
  });

  it("rechaza si el usuario ya tiene 1 empresa activa (límite del plan)", async () => {
    vi.mocked(prisma.companyMember.count).mockResolvedValue(1);

    const result = await createCompanyAction({
      name: "Segunda Empresa C.A.",
      userId: "user-1",
      telefono: "0412-1234567",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("1 empresa");
  });

  it("retorna error si el RIF ya existe", async () => {
    vi.mocked(prisma.companyMember.count).mockResolvedValue(0);
    vi.mocked(prisma.company.findUnique).mockResolvedValue(mockCompany as never);

    const result = await createCompanyAction({
      name: "Otra Empresa",
      userId: "user-1",
      rif: "J-12345678-9",
      telefono: "0412-1234567",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("RIF");
  });
});

describe("archiveCompanyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1", has: () => true } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "ADMIN" } as never);
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

    if ('clerk_error' in result) throw new Error('unexpected step-up');
    expect(result.success).toBe(true);
  });

  it("retorna error si hay período abierto", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);

    const result = await archiveCompanyAction("company-1", "user-1");

    if ('clerk_error' in result) throw new Error('unexpected step-up');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("período contable abierto");
  });
});

describe("reactivateCompanyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "ADMIN" } as never);
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