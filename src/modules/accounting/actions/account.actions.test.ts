// src/modules/accounting/actions/account.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

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
    companyMember: {
      findUnique: vi.fn(),
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

vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi.fn().mockImplementation(
    (_companyId: string, _tx: unknown, fn: (_tx: unknown) => unknown) => fn(_tx)
  ),
}));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {}, ocr: {} },
}));

import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import {
  createAccountAction,
  updateAccountAction,
  getAccountsAction,
  getNextAccountCodeAction,
} from "./account.actions";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_ACCOUNT = {
  id: "acc-1",
  name: "Caja General",
  code: "1105",
  type: "ASSET",
  description: null,
  companyId: "company-1",
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── createAccountAction ──────────────────────────────────────────────────────

describe("createAccountAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({ account: prisma.account, auditLog: prisma.auditLog })) as never
    );
  });

  it("crea una cuenta correctamente en el happy path", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.account.create).mockResolvedValue(BASE_ACCOUNT as never);

    const result = await createAccountAction({
      companyId: "company-1",
      name: "Caja General",
      code: "1105",
      type: "ASSET",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("acc-1");
      expect(result.data.name).toBe("Caja General");
    }
    expect(revalidatePath).toHaveBeenCalledWith("/company/company-1/accounts");
  });

  it("rechaza cuando userId es null — no autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);

    const result = await createAccountAction({
      companyId: "company-1",
      name: "Caja General",
      code: "1105",
      type: "ASSET",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rechaza cuando rate limit excedido", async () => {
    const { checkRateLimit } = await import("@/lib/ratelimit");
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      allowed: false,
      error: "Límite de solicitudes excedido",
    } as never);
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);

    const result = await createAccountAction({
      companyId: "company-1",
      name: "Caja General",
      code: "1105",
      type: "ASSET",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Límite");
  });

  it("rechaza codigo duplicado en la misma empresa", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValueOnce(BASE_ACCOUNT as never);

    const result = await createAccountAction({
      companyId: "company-1",
      name: "Caja Nueva",
      code: "1105",
      type: "ASSET",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("1105");
  });

  it("rechaza nombre duplicado en la misma empresa", async () => {
    // Primer findUnique (código) → null, segundo (nombre) → existente
    vi.mocked(prisma.account.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(BASE_ACCOUNT as never);

    const result = await createAccountAction({
      companyId: "company-1",
      name: "Caja General",
      code: "1999",
      type: "ASSET",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Caja General");
  });

  it("rechaza codigo con formato invalido", async () => {
    const invalidos = ["ABC", "1 105", "caja-1", "1@105", "ACTIVO1"];
    for (const code of invalidos) {
      const result = await createAccountAction({
        companyId: "company-1",
        name: "Cuenta X",
        code,
        type: "ASSET",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.fieldErrors?.code?.some((e) => e.includes("numérico"))).toBe(true);
      }
    }
  });

  it("acepta codigos jerarquicos validos", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);

    const validos = ["1105", "1-1-05", "1.1.05", "1105001"];
    for (const code of validos) {
      vi.mocked(prisma.account.create).mockResolvedValueOnce({
        ...BASE_ACCOUNT,
        code,
      } as never);

      const result = await createAccountAction({
        companyId: "company-1",
        name: "Cuenta",
        code,
        type: "ASSET",
      });
      expect(result.success, `código "${code}" debe ser válido`).toBe(true);
    }
  });

  it("permite el mismo codigo en empresas diferentes (aislamiento multi-tenant)", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.account.create).mockResolvedValue({
      ...BASE_ACCOUNT,
      companyId: "company-2",
    } as never);

    const result = await createAccountAction({
      companyId: "company-2",
      name: "Caja General",
      code: "1105",
      type: "ASSET",
    });

    expect(result.success).toBe(true);
  });

  it("retorna warning si el codigo esta fuera del rango estandar", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.account.create).mockResolvedValue({
      ...BASE_ACCOUNT,
      code: "9999",
    } as never);

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

// ─── updateAccountAction ──────────────────────────────────────────────────────

describe("updateAccountAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({ account: prisma.account, auditLog: prisma.auditLog })) as never
    );
  });

  it("actualiza una cuenta correctamente en el happy path", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(BASE_ACCOUNT as never);
    vi.mocked(prisma.account.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.account.update).mockResolvedValue({
      ...BASE_ACCOUNT,
      name: "Caja Actualizada",
    } as never);

    const result = await updateAccountAction({
      id: "acc-1",
      name: "Caja Actualizada",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Caja Actualizada");
    expect(revalidatePath).toHaveBeenCalledWith("/company");
  });

  it("retorna error cuando userId es null — no autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await updateAccountAction({ id: "acc-1", name: "Nueva" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(prisma.account.findUnique).not.toHaveBeenCalled();
  });

  it("retorna error cuando la cuenta no existe", async () => {
    // findUnique retorna null → cuenta no encontrada
    // Necesario porque el beforeEach no configura este mock para updateAccountAction
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null as never);

    const result = await updateAccountAction({ id: "acc-inexistente", name: "NombreValido" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Cuenta no encontrada");
  });

  it("rechaza codigo duplicado en la misma empresa — CRÍTICO-1 fix (LL-003)", async () => {
    // Arrange: la cuenta a editar existe
    vi.mocked(prisma.account.findUnique).mockResolvedValue(BASE_ACCOUNT as never);
    // Otra cuenta en la MISMA empresa ya tiene el código 1106
    vi.mocked(prisma.account.findFirst).mockResolvedValue({
      ...BASE_ACCOUNT,
      id: "acc-otro",
      code: "1106",
      name: "Caja Chica",
    } as never);

    const result = await updateAccountAction({ id: "acc-1", code: "1106" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("1106");
    // Verificar que findFirst se llamó con companyId — garantía del fix ADR-004
    expect(prisma.account.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: "company-1" }),
      })
    );
  });

  it("permite el mismo codigo si pertenece a la cuenta que se edita (NOT id)", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(BASE_ACCOUNT as never);
    // findFirst retorna null → no hay otro con ese código en la empresa
    vi.mocked(prisma.account.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.account.update).mockResolvedValue(BASE_ACCOUNT as never);

    const result = await updateAccountAction({ id: "acc-1", code: "1105" });

    expect(result.success).toBe(true);
  });

  it("no verifica unicidad de codigo si no se esta cambiando el codigo", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(BASE_ACCOUNT as never);
    vi.mocked(prisma.account.update).mockResolvedValue({
      ...BASE_ACCOUNT,
      name: "Solo nombre cambia",
    } as never);

    const result = await updateAccountAction({ id: "acc-1", name: "Solo nombre cambia" });

    expect(result.success).toBe(true);
    // findFirst no debe llamarse si no hay code en el input
    expect(prisma.account.findFirst).not.toHaveBeenCalled();
  });

  it("retorna fieldErrors en input invalido (Zod)", async () => {
    const result = await updateAccountAction({ id: "" }); // id vacío falla Zod

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Datos invalidos");
      expect(result.fieldErrors).toBeDefined();
    }
  });
});

// ─── getAccountsAction ────────────────────────────────────────────────────────

describe("getAccountsAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna lista de cuentas de la empresa", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([BASE_ACCOUNT] as never);

    const result = await getAccountsAction("company-1");

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(1);
    expect(prisma.account.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: "company-1", deletedAt: null },
      })
    );
  });

  it("retorna array vacío si la empresa no tiene cuentas", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([] as never);

    const result = await getAccountsAction("company-nueva");

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(0);
  });

  it("retorna error cuando falla la query", async () => {
    vi.mocked(prisma.account.findMany).mockRejectedValue(new Error("DB connection failed"));

    const result = await getAccountsAction("company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("DB connection failed");
  });
});

// ─── getNextAccountCodeAction ─────────────────────────────────────────────────

describe("getNextAccountCodeAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sugiere el primer codigo del rango para empresa sin cuentas", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([]);

    const result = await getNextAccountCodeAction("ASSET", "company-1");

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.code).toBe("1000");
  });

  it("sugiere el siguiente disponible cuando el rango empieza ocupado", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { code: "1000" },
      { code: "1001" },
      { code: "1002" },
    ] as never);

    const result = await getNextAccountCodeAction("ASSET", "company-1");

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.code).toBe("1003");
  });

  it("detecta huecos y sugiere el primero libre", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { code: "1000" },
      { code: "1002" }, // hueco en 1001
    ] as never);

    const result = await getNextAccountCodeAction("ASSET", "company-1");

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.code).toBe("1001");
  });

  it("retorna error cuando el rango de codigos esta agotado", async () => {
    // Todos los códigos del rango LIABILITY (2000-2999) ocupados
    const allCodes = Array.from({ length: 1000 }, (_, i) => ({ code: String(2000 + i) }));
    vi.mocked(prisma.account.findMany).mockResolvedValue(allCodes as never);

    const result = await getNextAccountCodeAction("LIABILITY", "company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("agotado");
  });

  it("no mezcla codigos de otras empresas — aislamiento multi-tenant", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([{ code: "1000" }] as never);

    await getNextAccountCodeAction("ASSET", "company-1");

    expect(prisma.account.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: "company-1", deletedAt: null },
      })
    );
  });

  it("ignora codigos no numericos al calcular el siguiente", async () => {
    // Códigos jerárquicos no son números → se ignoran en el cálculo del rango
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { code: "1-1-01" }, // jerárquico — NaN, se descarta
      { code: "1000" },
    ] as never);

    const result = await getNextAccountCodeAction("ASSET", "company-1");

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.code).toBe("1001");
  });

  it("funciona correctamente para cada tipo de cuenta", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([]);

    const expected: Record<string, string> = {
      ASSET: "1000",
      LIABILITY: "2000",
      EQUITY: "3000",
      REVENUE: "4000",
      EXPENSE: "5000",
    };

    for (const [type, code] of Object.entries(expected)) {
      const result = await getNextAccountCodeAction(
        type as "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE",
        "company-1"
      );
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.code).toBe(code);
    }
  });
});
