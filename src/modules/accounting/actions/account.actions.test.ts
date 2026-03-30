// src/modules/accounting/actions/account.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ÔöÇÔöÇÔöÇ Mock de Prisma ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
// No queremos tocar la DB real en los tests ÔÇö usamos un "mock"
// Un mock es un objeto falso que simula el comportamiento real

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    account: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { createAccountAction, getNextAccountCodeAction } from "./account.actions";

// ÔöÇÔöÇÔöÇ Tests ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

describe("createAccountAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) => fn({ account: prisma.account, auditLog: prisma.auditLog })) as never
    );
  });

  it("crea una cuenta correctamente", async () => {
    // Simular que no hay duplicados
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.account.create).mockResolvedValue({
      id: "acc-1",
      name: "Caja General",
      code: "1105",
      type: "ASSET",
      description: null,
      companyId: "company-1",
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await createAccountAction({
      companyId: "company-1",
      name: "Caja General",
      code: "1105",
      type: "ASSET",
    });

    expect(result.success).toBe(true);
  });

  it("rechaza codigo duplicado en la misma empresa", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValueOnce({
      id: "acc-existing",
      name: "Caja General",
      code: "1105",
      type: "ASSET",
      description: null,
      companyId: "company-1",
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await createAccountAction({
      companyId: "company-1",
      name: "Caja Nueva",
      code: "1105",
      type: "ASSET",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("1105");
    }
  });

  it("permite el mismo codigo en empresas diferentes", async () => {
    // Empresa B puede tener 1105 aunque Empresa A ya lo tenga
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.account.create).mockResolvedValue({
      id: "acc-2",
      name: "Caja General",
      code: "1105",
      type: "ASSET",
      description: null,
      companyId: "company-2", // ÔåÉ empresa diferente
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await createAccountAction({
      companyId: "company-2",
      name: "Caja General",
      code: "1105",
      type: "ASSET",
    });

    expect(result.success).toBe(true);
  });

  it("retorna warning si el codigo esta fuera del rango", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.account.create).mockResolvedValue({
      id: "acc-3",
      name: "Cuenta Especial",
      code: "9999",
      type: "ASSET",
      description: null,
      companyId: "company-1",
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await createAccountAction({
      companyId: "company-1",
      name: "Cuenta Especial",
      code: "9999",
      type: "ASSET",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain("rango estandar");
    }
  });
});

describe("getNextAccountCodeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sugiere el primer codigo disponible del rango para empresa sin cuentas", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([]);

    const result = await getNextAccountCodeAction("ASSET", "company-1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe("1000");
    }
  });

  it("sugiere el primer hueco disponible", async () => {
    // Empresa tiene 1000, 1001, 1002 ÔÇö debe sugerir 1003
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { code: "1000" },
      { code: "1001" },
      { code: "1002" },
    ] as never);

    const result = await getNextAccountCodeAction("ASSET", "company-1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe("1003");
    }
  });

  it("detecta huecos y sugiere el primero", async () => {
    // Tiene 1000, 1002 ÔÇö debe sugerir 1001 (el hueco)
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { code: "1000" },
      { code: "1002" },
    ] as never);

    const result = await getNextAccountCodeAction("ASSET", "company-1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe("1001");
    }
  });

  it("no mezcla codigos de otras empresas", async () => {
    // Solo retorna cuentas de company-1, no de company-2
    vi.mocked(prisma.account.findMany).mockResolvedValue([{ code: "1000" }] as never);

    const result = await getNextAccountCodeAction("ASSET", "company-1");

    expect(result.success).toBe(true);
    // Verificar que el findMany se llam├│ con el companyId correcto
    expect(prisma.account.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: "company-1", deletedAt: null },
      })
    );
  });
});