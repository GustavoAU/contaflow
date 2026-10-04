// src/modules/accounting/actions/account.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

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
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    journalEntry: {
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi
    .fn()
    .mockImplementation((_companyId: string, _tx: unknown, fn: (_tx: unknown) => unknown) =>
      fn(_tx)
    ),
}));

// Limiters DISTINGUIBLES (no `{}` iguales): así un test puede comprobar QUÉ limiter usa cada action
// (SPEC-008 RN-13: la sugerencia es de lectura → `read`; alta/edición siguen en `fiscal`).
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  fiscalKey: (c: string, u: string) => `${c}:${u}`,
  limiters: { fiscal: { kind: "fiscal" }, read: { kind: "read" }, ocr: { kind: "ocr" } },
}));

import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { checkRateLimit } from "@/lib/ratelimit";
import {
  accountRow,
  createAccountDb,
  type AccountDb,
  type AccountRow,
} from "@/__tests__/helpers/in-memory-account-db";
import {
  createAccountAction,
  updateAccountAction,
  getAccountsAction,
  getNextAccountCodeAction,
} from "./account.actions";

// SPEC-008: `getNextAccountCodeAction` pasa de (type, companyId) a (type, companyId, parentId).
// Se invoca a través de este alias con la firma NUEVA para que `tsc` no se ponga rojo antes de que
// el ledger-agent cambie la firma (modo RED). `parentId` es opcional aquí solo para poder probar
// el rechazo de CA-7 (llamada sin padre).
type AccountTypeValue = "ASSET" | "CONTRA_ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
const getNext = getNextAccountCodeAction as unknown as (
  type: AccountTypeValue,
  companyId: string,
  parentId?: string
) => ReturnType<typeof getNextAccountCodeAction>;

// `mockClear` no restablece implementaciones: un `mockResolvedValue` de un test se filtraba al
// siguiente. Los bloques de SPEC-008 parten de mocks de cuenta en blanco.
function resetAccountMocks() {
  for (const fn of [
    prisma.account.findMany,
    prisma.account.findUnique,
    prisma.account.findFirst,
    prisma.account.create,
    prisma.account.update,
    prisma.journalEntry.count,
    prisma.auditLog.create,
  ]) {
    vi.mocked(fn).mockReset();
  }
}

/** Conecta una BD en memoria a `prisma.account.*` (cada consulta se evalúa contra filas reales). */
function mountAccountDb(db: AccountDb) {
  vi.mocked(prisma.account.findFirst).mockImplementation(db.findFirst as never);
  vi.mocked(prisma.account.findMany).mockImplementation(db.findMany as never);
  vi.mocked(prisma.account.findUnique).mockImplementation(db.findUnique as never);
  vi.mocked(prisma.account.create).mockImplementation(db.create as never);
  vi.mocked(prisma.account.update).mockImplementation(db.update as never);
}

type WhereArg = { where?: Record<string, unknown> };
/** `where` de todas las llamadas a un método de lectura (para aserciones de tenant / de padre). */
function wheresOf(fn: unknown): Record<string, unknown>[] {
  return vi
    .mocked(fn as (a: WhereArg) => unknown)
    .mock.calls.map(([args]) => (args as WhereArg).where ?? {});
}
/** ¿Alguna consulta preguntó por este código EXACTO (como valor, en cualquier forma de where)? */
function askedForCode(fn: unknown, code: string): boolean {
  return wheresOf(fn).some((w) => JSON.stringify(w).includes(`"${code}"`));
}

// Títulos de referencia (isPostable=false por la regla de 9 dígitos) y mensajes del copy de SPEC §8.
const TITULO_CAJAS = accountRow({ id: "t-cajas", code: "1.1.01.01", name: "CAJAS", type: "ASSET" });
const MSG_SIN_PADRE = (code: string, parent: string) =>
  `La cuenta ${code} necesita un título padre (${parent}) que no existe. Créalo primero.`;
const MSG_FORMA =
  "El código de una cuenta de movimiento debe tener el formato A.B.CC.DD.EEE (ej: 1.1.01.01.001).";
const MSG_TIPO = (parent: string) => `El título padre ${parent} es de otro tipo de cuenta.`;

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
    resetAccountMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn({ account: prisma.account, auditLog: prisma.auditLog })) as never);
  });

  it("crea una cuenta correctamente en el happy path", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.account.create).mockResolvedValue(BASE_ACCOUNT as never);

    const result = await createAccountAction({
      companyId: "company-1",
      name: "Caja General",
      code: "1105",
      type: "ASSET",
      isMonetary: false,
      isCurrent: false,
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
      isMonetary: false,
      isCurrent: false,
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
      isMonetary: false,
      isCurrent: false,
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
      isMonetary: false,
      isCurrent: false,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("1105");
  });

  // ADR-059: el nombre NO es único. Títulos, subtítulos y cuentas de movimiento repiten
  // nombre ("CAJAS" / "CAJAS" / "Caja Principal"); solo el código no se repite.
  // SPEC-008: un código de movimiento ahora exige su título padre → la ÚNICA consulta `findFirst`
  // permitida es la del padre (por código), nunca una por nombre.
  it("permite nombre repetido: no consulta por nombre, solo por código", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.account.findFirst).mockResolvedValue({
      code: "1.1.01.01",
      type: "ASSET",
      isPostable: false,
    } as never);
    vi.mocked(prisma.account.create).mockResolvedValue(BASE_ACCOUNT as never);

    const result = await createAccountAction({
      companyId: "company-1",
      name: "Caja General",
      code: "1.1.01.01.002",
      type: "ASSET",
      isMonetary: false,
      isCurrent: false,
    });

    expect(result.success).toBe(true);
    for (const where of wheresOf(prisma.account.findFirst))
      expect(where).not.toHaveProperty("name");
    for (const where of wheresOf(prisma.account.findUnique))
      expect(where).not.toHaveProperty("name");
  });

  // ADR-059: ≥ 9 dígitos = movimiento; menos = título/subtítulo.
  it("código de 9 dígitos → se crea como cuenta de movimiento (isPostable true)", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValueOnce(null);
    // SPEC-008: el título padre 1.1.01.01 existe.
    vi.mocked(prisma.account.findFirst).mockResolvedValue({
      code: "1.1.01.01",
      type: "ASSET",
      isPostable: false,
    } as never);
    vi.mocked(prisma.account.create).mockResolvedValue(BASE_ACCOUNT as never);

    const result = await createAccountAction({
      companyId: "company-1",
      name: "Caja Principal",
      code: "1.1.01.01.001",
      type: "ASSET",
      isMonetary: false,
      isCurrent: false,
    });

    expect(result.success).toBe(true);
    expect(prisma.account.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPostable: true }) })
    );
    // M-1: un código de movimiento válido NO debe disparar el aviso de "fuera de rango" (4 dígitos)
    if (result.success) expect(result.warning).toBeUndefined();
  });

  it("código de 9 dígitos que no empieza por el dígito de su tipo → aviso de primer dígito", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValueOnce(null);
    // SPEC-008: tiene título padre (2.1.01.01, del mismo tipo ASSET que se declara) → llega al aviso.
    vi.mocked(prisma.account.findFirst).mockResolvedValue({
      code: "2.1.01.01",
      type: "ASSET",
      isPostable: false,
    } as never);
    vi.mocked(prisma.account.create).mockResolvedValue(BASE_ACCOUNT as never);

    const result = await createAccountAction({
      companyId: "company-1",
      name: "Cuenta rara",
      code: "2.1.01.01.001",
      type: "ASSET",
      isMonetary: false,
      isCurrent: false,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.warning).toContain("dígito");
  });

  it("código de menos de 9 dígitos → se crea como título (isPostable false) con aviso", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.account.create).mockResolvedValue(BASE_ACCOUNT as never);

    const result = await createAccountAction({
      companyId: "company-1",
      name: "CAJAS",
      code: "1.1.01",
      type: "ASSET",
      isMonetary: false,
      isCurrent: false,
    });

    expect(result.success).toBe(true);
    expect(prisma.account.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPostable: false }) })
    );
    if (result.success) expect(result.warning).toContain("9 dígitos");
  });

  it("rechaza codigo con formato invalido", async () => {
    const invalidos = ["ABC", "1 105", "caja-1", "1@105", "ACTIVO1"];
    for (const code of invalidos) {
      const result = await createAccountAction({
        companyId: "company-1",
        name: "Cuenta X",
        code,
        type: "ASSET",
        isMonetary: false,
        isCurrent: false,
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
        isMonetary: false,
        isCurrent: false,
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
      isMonetary: false,
      isCurrent: false,
    });

    expect(result.success).toBe(true);
  });

  it("retorna warning si el primer dígito del código no corresponde al tipo", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
    // SPEC-008: título padre 9.9.99.99 presente (tipo ASSET, igual que la cuenta).
    vi.mocked(prisma.account.findFirst).mockResolvedValue({
      code: "9.9.99.99",
      type: "ASSET",
      isPostable: false,
    } as never);
    vi.mocked(prisma.account.create).mockResolvedValue({
      ...BASE_ACCOUNT,
      code: "9.9.99.99.999",
    } as never);

    const result = await createAccountAction({
      companyId: "company-1",
      name: "Cuenta Especial",
      code: "9.9.99.99.999",
      type: "ASSET",
      isMonetary: false,
      isCurrent: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain("dígito estándar");
    }
  });
});

// ─── updateAccountAction ──────────────────────────────────────────────────────

describe("updateAccountAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAccountMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn({
        account: prisma.account,
        auditLog: prisma.auditLog,
        journalEntry: prisma.journalEntry,
      })) as never);
  });

  // M-1 (auditoría SPEC-008): la edición era la única mutación de cuentas sin rate limit.
  it("[M-1] la edición pasa por el limiter fiscal y, con el límite excedido, no escribe", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(BASE_ACCOUNT as never);
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      allowed: false,
      error: "Límite de solicitudes excedido",
    } as never);

    const result = await updateAccountAction({ id: "acc-1", name: "Otro nombre" });

    expect(result.success).toBe(false);
    expect(checkRateLimit).toHaveBeenCalledWith("company-1:user-1", { kind: "fiscal" });
    expect(prisma.account.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
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
    vi.mocked(prisma.account.findUnique).mockResolvedValue(BASE_ACCOUNT as never);

    const result = await updateAccountAction({ id: "acc-1", name: "Nueva" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
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

  // ADR-059 / H-1 del security-agent: el formulario de edición reenvía SIEMPRE el `code`.
  // Editar el nombre de una cuenta heredada de 4 dígitos (movimiento) NO debe degradarla a
  // título ni bloquearse por tener asientos — solo importa si el código CRUZA el umbral.
  it("[H-1] edita nombre reenviando el MISMO código de 4 dígitos con asientos → éxito, isPostable intacto", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(BASE_ACCOUNT as never);
    vi.mocked(prisma.account.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.journalEntry.count).mockResolvedValue(5 as never);
    vi.mocked(prisma.account.update).mockResolvedValue(BASE_ACCOUNT as never);

    const result = await updateAccountAction({
      id: "acc-1",
      name: "Caja Renombrada",
      code: "1105",
    });

    expect(result.success).toBe(true);
    const data = vi.mocked(prisma.account.update).mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty("isPostable");
    expect(prisma.journalEntry.count).not.toHaveBeenCalled();
  });

  it("[H-1] cambio 4→4 dígitos en cuenta heredada → isPostable intacto", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue(BASE_ACCOUNT as never);
    vi.mocked(prisma.account.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.account.update).mockResolvedValue(BASE_ACCOUNT as never);

    const result = await updateAccountAction({ id: "acc-1", code: "1106" });

    expect(result.success).toBe(true);
    const data = vi.mocked(prisma.account.update).mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty("isPostable");
  });

  it("cambio <9 → ≥9 dígitos → se promueve a movimiento (isPostable true)", async () => {
    // SPEC-008 RN-10: el nuevo código es de movimiento → el título padre 1.1.01.01 debe existir.
    // La BD en memoria responde a la cuenta editada (1105), a la unicidad del código nuevo (nadie
    // lo usa) Y a la búsqueda del padre — `findFirst` hace las dos últimas.
    mountAccountDb(
      createAccountDb([TITULO_CAJAS, accountRow({ id: "acc-1", code: "1105", isPostable: true })])
    );
    vi.mocked(prisma.account.update).mockResolvedValue(BASE_ACCOUNT as never);

    const result = await updateAccountAction({ id: "acc-1", code: "1.1.01.01.001" });

    expect(result.success).toBe(true);
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPostable: true }) })
    );
  });

  it("cambio ≥9 → <9 dígitos sin asientos → pasa a título (isPostable false) y queda en el AuditLog", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue({
      ...BASE_ACCOUNT,
      code: "1.1.01.01.001",
    } as never);
    vi.mocked(prisma.account.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.journalEntry.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.account.update).mockResolvedValue(BASE_ACCOUNT as never);

    const result = await updateAccountAction({ id: "acc-1", code: "1.1.01" });

    expect(result.success).toBe(true);
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPostable: false }) })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          newValue: expect.objectContaining({ isPostable: false }),
        }),
      })
    );
  });

  it("cambio ≥9 → <9 dígitos con asientos → se bloquea con mensaje de negocio", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue({
      ...BASE_ACCOUNT,
      code: "1.1.01.01.001",
    } as never);
    vi.mocked(prisma.account.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.journalEntry.count).mockResolvedValue(3 as never);

    const result = await updateAccountAction({ id: "acc-1", code: "1.1.01" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("9 dígitos");
    expect(prisma.account.update).not.toHaveBeenCalled();
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
      expect(result.error).toBe("Datos inválidos");
      expect(result.fieldErrors).toBeDefined();
    }
  });
});

// ─── getAccountsAction ────────────────────────────────────────────────────────

describe("getAccountsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
  });

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

  it("onlyPostable → filtra solo cuentas de movimiento (selectores, ADR-059)", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([BASE_ACCOUNT] as never);

    await getAccountsAction("company-1", { onlyPostable: true });

    expect(prisma.account.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: "company-1", deletedAt: null, isPostable: true },
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
    vi.mocked(prisma.account.findMany).mockRejectedValue(new Error("query execution failed"));

    const result = await getAccountsAction("company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("query execution failed");
  });
});

// ─── createAccountAction · título padre obligatorio (SPEC-008) ───────────────────

function expectRechazo(result: { success: boolean }, message: string) {
  expect(result.success).toBe(false);
  expect((result as { error?: string }).error).toBe(message);
}

describe("createAccountAction — título padre obligatorio para cuentas de movimiento (SPEC-008)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAccountMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn({ account: prisma.account, auditLog: prisma.auditLog })) as never);
  });

  const entrada = (
    code: string,
    extra: Partial<Parameters<typeof createAccountAction>[0]> = {}
  ): Parameters<typeof createAccountAction>[0] => ({
    companyId: "company-1",
    name: "Caja Chica",
    code,
    type: "ASSET",
    isMonetary: false,
    isCurrent: false,
    ...extra,
  });

  /** "No crea nada": ni la cuenta, ni la transacción, ni el AuditLog, ni revalida la página. */
  function sinEscrituras() {
    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  }

  // ─── CA-9 ──────────────────────────────────────────────────────────────────────────────────
  it("CA-9: 1.1.01.01.050 con el título padre 1.1.01.01 existente → se crea como movimiento", async () => {
    mountAccountDb(createAccountDb([TITULO_CAJAS]));

    const result = await createAccountAction(entrada("1.1.01.01.050"));

    expect(result.success).toBe(true);
    if (result.success) expect(result.warning).toBeUndefined();
    expect(prisma.account.create).toHaveBeenCalledTimes(1);
    expect(prisma.account.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: "1.1.01.01.050",
          isPostable: true,
          companyId: "company-1",
        }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/company/company-1/accounts");
  });

  it("CA-9: busca el padre por el código sin el último segmento, en la empresa y sin eliminadas", async () => {
    mountAccountDb(createAccountDb([TITULO_CAJAS]));

    await createAccountAction(entrada("1.1.01.01.050"));

    expect(prisma.account.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "company-1",
          code: "1.1.01.01",
          deletedAt: null,
        }),
      })
    );
  });

  it("CA-9: sin el título padre → rechaza con el mensaje de negocio y NO llama a account.create", async () => {
    mountAccountDb(createAccountDb([]));

    const result = await createAccountAction(entrada("1.1.01.01.050"));

    expectRechazo(result, MSG_SIN_PADRE("1.1.01.01.050", "1.1.01.01"));
    sinEscrituras();
  });

  it("CA-9: el padre calculado depende del código tecleado (2.1.05.02.123 → 2.1.05.02)", async () => {
    mountAccountDb(createAccountDb([TITULO_CAJAS])); // solo existe el título de ACTIVO

    const result = await createAccountAction(
      entrada("2.1.05.02.123", { name: "Proveedores", type: "LIABILITY" })
    );

    expectRechazo(result, MSG_SIN_PADRE("2.1.05.02.123", "2.1.05.02"));
    sinEscrituras();
  });

  // ─── CA-5 aplicado al alta: el padre existe pero no sirve ──────────────────────────────────
  it("CA-5: el título existe pero en OTRA empresa → se rechaza (el padre se busca en la empresa verificada)", async () => {
    mountAccountDb(createAccountDb([{ ...TITULO_CAJAS, companyId: "company-2" }]));

    const result = await createAccountAction(entrada("1.1.01.01.050"));

    expectRechazo(result, MSG_SIN_PADRE("1.1.01.01.050", "1.1.01.01"));
    sinEscrituras();
  });

  it("CA-5: el título está ELIMINADO → se rechaza", async () => {
    mountAccountDb(createAccountDb([{ ...TITULO_CAJAS, deletedAt: new Date("2026-09-01") }]));

    const result = await createAccountAction(entrada("1.1.01.01.050"));

    expectRechazo(result, MSG_SIN_PADRE("1.1.01.01.050", "1.1.01.01"));
    sinEscrituras();
  });

  it("CA-5: el 'padre' tiene isPostable=true (es una cuenta de movimiento) → se rechaza", async () => {
    mountAccountDb(createAccountDb([{ ...TITULO_CAJAS, isPostable: true }]));

    const result = await createAccountAction(entrada("1.1.01.01.050"));

    expectRechazo(result, MSG_SIN_PADRE("1.1.01.01.050", "1.1.01.01"));
    sinEscrituras();
  });

  it("CA-5: solo existe el abuelo (1.1.01) pero no el padre inmediato (1.1.01.01) → se rechaza", async () => {
    mountAccountDb(
      createAccountDb([
        accountRow({ id: "t-abuelo", code: "1.1.01", name: "CAJAS", type: "ASSET" }),
      ])
    );

    const result = await createAccountAction(entrada("1.1.01.01.050"));

    expectRechazo(result, MSG_SIN_PADRE("1.1.01.01.050", "1.1.01.01"));
    sinEscrituras();
  });

  // ─── CA-6 / RN-3 aplicado al alta ──────────────────────────────────────────────────────────
  it("CA-6: CONTRA_ASSET bajo un título ASSET se crea", async () => {
    mountAccountDb(
      createAccountDb([
        accountRow({ id: "t-dep", code: "1.1.09.01", name: "DEPRECIACION", type: "ASSET" }),
      ])
    );

    const result = await createAccountAction(
      entrada("1.1.09.01.001", { name: "Dep. Acum. Equipos", type: "CONTRA_ASSET" })
    );

    expect(result.success).toBe(true);
    expect(prisma.account.create).toHaveBeenCalledTimes(1);
  });

  it("CA-6: LIABILITY bajo un título ASSET → rechaza por tipo y NO crea nada", async () => {
    mountAccountDb(createAccountDb([TITULO_CAJAS]));

    const result = await createAccountAction(entrada("1.1.01.01.050", { type: "LIABILITY" }));

    expectRechazo(result, MSG_TIPO("1.1.01.01"));
    sinEscrituras();
  });

  it("CA-6: ASSET bajo un título CONTRA_ASSET → rechaza por tipo", async () => {
    mountAccountDb(createAccountDb([{ ...TITULO_CAJAS, type: "CONTRA_ASSET" }]));

    const result = await createAccountAction(entrada("1.1.01.01.050", { type: "ASSET" }));

    expectRechazo(result, MSG_TIPO("1.1.01.01"));
    sinEscrituras();
  });

  // ─── CA-10: forma ──────────────────────────────────────────────────────────────────────────
  it.each([
    ["sin puntos (9 dígitos planos)", "110101001"],
    ["10 dígitos (último segmento de 4)", "1.1.01.01.0010"],
    ["separador guion en vez de punto", "1-1-01-01-001"],
    ["segmentos con otro tamaño", "1.1.01.001.01"],
    ["un segmento de más", "1.1.01.01.01.1"],
  ])(
    "CA-10: %s → rechaza por forma (aunque exista un título que podría ser el padre)",
    async (_label, code) => {
      mountAccountDb(createAccountDb([TITULO_CAJAS]));

      const result = await createAccountAction(entrada(code));

      expectRechazo(result, MSG_FORMA);
      sinEscrituras();
    }
  );

  // ─── CA-11: los títulos siguen sin padre ───────────────────────────────────────────────────
  it.each([["1"], ["1.1"], ["1.1.01"], ["1.1.01.01"], ["1105"], ["1-1-05"]])(
    "CA-11: el título %s se crea sin padre y sin consultar a ningún padre",
    async (code) => {
      mountAccountDb(createAccountDb([])); // la BD no tiene ningún título

      const result = await createAccountAction(entrada(code, { name: "CAJAS" }));

      expect(result.success).toBe(true);
      if (result.success) expect(result.warning).toContain("9 dígitos");
      expect(prisma.account.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ code, isPostable: false }),
        })
      );
      expect(prisma.account.findFirst).not.toHaveBeenCalled();
    }
  );

  // ─── Regresiones y orden de guardas ────────────────────────────────────────────────────────
  it("un código de movimiento ya en uso sigue dando el error de código duplicado (con su padre presente)", async () => {
    mountAccountDb(
      createAccountDb([
        TITULO_CAJAS,
        accountRow({ id: "acc-uso", code: "1.1.01.01.050", name: "Caja Vieja" }),
      ])
    );

    const result = await createAccountAction(entrada("1.1.01.01.050"));

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error).toContain('ya esta en uso por la cuenta "Caja Vieja"');
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  it("un código ya usado por una cuenta ELIMINADA también se rechaza (el @@unique las cuenta)", async () => {
    mountAccountDb(
      createAccountDb([
        TITULO_CAJAS,
        accountRow({ id: "acc-del", code: "1.1.01.01.050", deletedAt: new Date("2026-09-01") }),
      ])
    );

    const result = await createAccountAction(entrada("1.1.01.01.050"));

    expect(result.success).toBe(false);
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  it("sin sesión (userId null) → 'No autorizado' ANTES de consultar a ningún padre", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    mountAccountDb(createAccountDb([TITULO_CAJAS]));

    const result = await createAccountAction(entrada("1.1.01.01.050"));

    expectRechazo(result, "No autorizado");
    expect(prisma.account.findFirst).not.toHaveBeenCalled();
    sinEscrituras();
  });

  it("un VIEWER no puede crear cuentas y no obtiene pistas sobre qué títulos existen", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    mountAccountDb(createAccountDb([])); // el padre NO existe: un mensaje de 'falta el padre' filtraría ese dato

    const result = await createAccountAction(entrada("1.1.01.01.050"));

    expectRechazo(result, "No autorizado");
    expect(prisma.account.findFirst).not.toHaveBeenCalled();
    sinEscrituras();
  });

  it("el alta sigue en el limiter fiscal (roles y limiters sin cambios)", async () => {
    mountAccountDb(createAccountDb([TITULO_CAJAS]));

    await createAccountAction(entrada("1.1.01.01.050"));

    expect(checkRateLimit).toHaveBeenCalledWith("company-1:user-1", { kind: "fiscal" });
  });

  it("CA-tenant: el padre se busca en la empresa del input verificada por el guard (company-2 con su propio título)", async () => {
    mountAccountDb(
      createAccountDb([
        { ...TITULO_CAJAS, id: "t-c1", companyId: "company-1" },
        { ...TITULO_CAJAS, id: "t-c2", companyId: "company-2" },
      ])
    );

    const result = await createAccountAction(entrada("1.1.01.01.050", { companyId: "company-2" }));

    expect(result.success).toBe(true);
    expect(prisma.companyMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: "company-2", userId: "user-1" } })
    );
    for (const where of wheresOf(prisma.account.findFirst)) {
      expect(where.companyId).toBe("company-2");
    }
    expect(prisma.account.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: "company-2" }) })
    );
  });
});

// ─── updateAccountAction · título padre solo si el código cambia (SPEC-008) ──────

describe("updateAccountAction — título padre solo si el código cambia a uno de movimiento (SPEC-008)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAccountMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn({
        account: prisma.account,
        auditLog: prisma.auditLog,
        journalEntry: prisma.journalEntry,
      })) as never);
  });

  // Cuenta heredada de 4 dígitos (movimiento por antigüedad) y cuenta de movimiento de 9 dígitos.
  const LEGACY = accountRow({
    id: "acc-4d",
    code: "1105",
    name: "Caja General",
    type: "ASSET",
    isPostable: true,
  });
  const MOVIMIENTO = accountRow({
    id: "acc-mov",
    code: "1.1.01.01.001",
    name: "Caja Principal",
    type: "ASSET",
  });

  function sinCambios() {
    expect(prisma.account.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  }

  // ─── CA-12 / CA-15 / H-1: lo que NO debe disparar el chequeo ───────────────────────────────
  it("CA-12: editar solo el nombre reenviando el MISMO código de movimiento → no consulta el padre", async () => {
    // La empresa es 'demo/legada': la cuenta de 9 dígitos NO tiene título padre en la BD (RN-12).
    mountAccountDb(createAccountDb([MOVIMIENTO]));

    const result = await updateAccountAction({
      id: "acc-mov",
      name: "Caja Renombrada",
      code: "1.1.01.01.001",
    });

    expect(result.success).toBe(true);
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "acc-mov" },
        data: expect.objectContaining({ name: "Caja Renombrada" }),
      })
    );
    expect(askedForCode(prisma.account.findFirst, "1.1.01.01")).toBe(false);
    // H-1: tampoco se recalcula isPostable (el código no cruzó el umbral).
    const data = vi.mocked(prisma.account.update).mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty("isPostable");
  });

  it("CA-12: editar solo el nombre SIN reenviar el código → no consulta el padre", async () => {
    mountAccountDb(createAccountDb([MOVIMIENTO]));

    const result = await updateAccountAction({ id: "acc-mov", name: "Solo el nombre" });

    expect(result.success).toBe(true);
    expect(askedForCode(prisma.account.findFirst, "1.1.01.01")).toBe(false);
  });

  it("CA-12: cambiar la descripción con el mismo código → no consulta el padre", async () => {
    mountAccountDb(createAccountDb([MOVIMIENTO]));

    const result = await updateAccountAction({
      id: "acc-mov",
      description: "Efectivo en caja",
      code: "1.1.01.01.001",
    });

    expect(result.success).toBe(true);
    expect(askedForCode(prisma.account.findFirst, "1.1.01.01")).toBe(false);
  });

  it("CA-12: cambiar solo el tipo con el mismo código no dispara el chequeo (RN-10: solo si el CÓDIGO cambia)", async () => {
    mountAccountDb(createAccountDb([MOVIMIENTO]));

    const result = await updateAccountAction({
      id: "acc-mov",
      type: "LIABILITY",
      code: "1.1.01.01.001",
    });

    expect(result.success).toBe(true);
    expect(askedForCode(prisma.account.findFirst, "1.1.01.01")).toBe(false);
  });

  it("CA-15: una cuenta heredada de 4 dígitos se renombra sin tocar ningún título", async () => {
    mountAccountDb(createAccountDb([LEGACY]));

    const result = await updateAccountAction({ id: "acc-4d", name: "Caja Nueva", code: "1105" });

    expect(result.success).toBe(true);
    expect(prisma.account.update).toHaveBeenCalledTimes(1);
  });

  // ─── CA-13: el código cambia a uno de movimiento ───────────────────────────────────────────
  it("CA-13: cambiar el código a uno de movimiento SIN título padre → rechaza y no actualiza", async () => {
    mountAccountDb(createAccountDb([LEGACY])); // sin TITULO_CAJAS

    const result = await updateAccountAction({ id: "acc-4d", code: "1.1.01.01.001" });

    expectRechazo(result, MSG_SIN_PADRE("1.1.01.01.001", "1.1.01.01"));
    sinCambios();
  });

  it("CA-13: cambiar el código a uno de movimiento CON su título padre → actualiza y promueve a movimiento", async () => {
    mountAccountDb(createAccountDb([LEGACY, TITULO_CAJAS]));

    const result = await updateAccountAction({ id: "acc-4d", code: "1.1.01.01.001" });

    expect(result.success).toBe(true);
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "acc-4d" },
        data: expect.objectContaining({ code: "1.1.01.01.001", isPostable: true }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("CA-13: movimiento → otro código de movimiento bajo el mismo padre existente → actualiza", async () => {
    mountAccountDb(createAccountDb([MOVIMIENTO, TITULO_CAJAS]));

    const result = await updateAccountAction({ id: "acc-mov", code: "1.1.01.01.002" });

    expect(result.success).toBe(true);
    expect(prisma.account.update).toHaveBeenCalledTimes(1);
  });

  it("CA-13: movimiento → otro código de movimiento y el padre NO existe (demo) → rechaza", async () => {
    mountAccountDb(createAccountDb([MOVIMIENTO])); // la cuenta actual tiene código válido, pero no hay título

    const result = await updateAccountAction({ id: "acc-mov", code: "1.1.01.01.002" });

    expectRechazo(result, MSG_SIN_PADRE("1.1.01.01.002", "1.1.01.01"));
    sinCambios();
  });

  it("CA-13: movimiento → movimiento bajo OTRO padre inexistente (1.1.02.01) → rechaza nombrando ese padre", async () => {
    mountAccountDb(createAccountDb([MOVIMIENTO, TITULO_CAJAS]));

    const result = await updateAccountAction({ id: "acc-mov", code: "1.1.02.01.001" });

    expectRechazo(result, MSG_SIN_PADRE("1.1.02.01.001", "1.1.02.01"));
    sinCambios();
  });

  it.each([
    ["sin puntos (9 dígitos planos)", "110101001"],
    ["10 dígitos", "1.1.01.01.0010"],
    ["separador guion", "1-1-01-01-001"],
  ])(
    "CA-13/CA-10: cambiar a un código de movimiento mal formado (%s) → rechaza por forma",
    async (_label, code) => {
      mountAccountDb(createAccountDb([LEGACY, TITULO_CAJAS]));

      const result = await updateAccountAction({ id: "acc-4d", code });

      expectRechazo(result, MSG_FORMA);
      sinCambios();
    }
  );

  it("CA-13: cambiar a un título (< 9 dígitos) no exige padre", async () => {
    mountAccountDb(createAccountDb([MOVIMIENTO]));
    vi.mocked(prisma.journalEntry.count).mockResolvedValue(0 as never);

    const result = await updateAccountAction({ id: "acc-mov", code: "1.1.01.02" });

    expect(result.success).toBe(true);
    expect(askedForCode(prisma.account.findFirst, "1.1.01")).toBe(false);
  });

  // ─── CA-5 / CA-6 aplicados a la edición ────────────────────────────────────────────────────
  it("CA-5: el título padre existe solo en OTRA empresa → rechaza; todas las consultas van acotadas a la empresa de la cuenta", async () => {
    mountAccountDb(
      createAccountDb([
        { ...LEGACY, companyId: "company-9" },
        { ...TITULO_CAJAS, id: "t-c1", companyId: "company-1" }, // el título es de otra empresa
      ])
    );

    const result = await updateAccountAction({ id: "acc-4d", code: "1.1.01.01.001" });

    expectRechazo(result, MSG_SIN_PADRE("1.1.01.01.001", "1.1.01.01"));
    sinCambios();
    // companyId sale de la cuenta guardada (before), nunca de un campo del input.
    expect(wheresOf(prisma.account.findFirst).length).toBeGreaterThan(0);
    for (const where of wheresOf(prisma.account.findFirst)) {
      expect(where.companyId).toBe("company-9");
    }
  });

  it("CA-5: el título padre está ELIMINADO → rechaza", async () => {
    mountAccountDb(
      createAccountDb([LEGACY, { ...TITULO_CAJAS, deletedAt: new Date("2026-09-01") }])
    );

    const result = await updateAccountAction({ id: "acc-4d", code: "1.1.01.01.001" });

    expectRechazo(result, MSG_SIN_PADRE("1.1.01.01.001", "1.1.01.01"));
    sinCambios();
  });

  it("CA-5: el 'padre' tiene isPostable=true → rechaza", async () => {
    mountAccountDb(createAccountDb([LEGACY, { ...TITULO_CAJAS, isPostable: true }]));

    const result = await updateAccountAction({ id: "acc-4d", code: "1.1.01.01.001" });

    expectRechazo(result, MSG_SIN_PADRE("1.1.01.01.001", "1.1.01.01"));
    sinCambios();
  });

  it("CA-6: cambiar el código y declarar un tipo incompatible con el título (LIABILITY bajo ASSET) → rechaza", async () => {
    mountAccountDb(createAccountDb([LEGACY, TITULO_CAJAS]));

    const result = await updateAccountAction({
      id: "acc-4d",
      code: "1.1.01.01.001",
      type: "LIABILITY",
    });

    expectRechazo(result, MSG_TIPO("1.1.01.01"));
    sinCambios();
  });

  it("CA-6: sin tipo en el input se usa el tipo ACTUAL de la cuenta (LIABILITY heredada bajo un título ASSET → rechaza)", async () => {
    const pasivo = accountRow({
      id: "acc-pas",
      code: "2105",
      name: "Proveedores",
      type: "LIABILITY",
      isPostable: true,
    });
    mountAccountDb(createAccountDb([pasivo, TITULO_CAJAS]));

    const result = await updateAccountAction({ id: "acc-pas", code: "1.1.01.01.001" });

    expectRechazo(result, MSG_TIPO("1.1.01.01"));
    sinCambios();
  });

  it("CA-6: una CONTRA_ASSET cambia su código a uno de movimiento bajo un título ASSET → actualiza", async () => {
    const contra = accountRow({
      id: "acc-contra",
      code: "1199",
      name: "Depreciacion Acumulada",
      type: "CONTRA_ASSET",
      isPostable: true,
    });
    const tituloDep = accountRow({
      id: "t-dep",
      code: "1.1.09.01",
      name: "DEPRECIACION",
      type: "ASSET",
    });
    mountAccountDb(createAccountDb([contra, tituloDep]));

    const result = await updateAccountAction({ id: "acc-contra", code: "1.1.09.01.001" });

    expect(result.success).toBe(true);
    expect(prisma.account.update).toHaveBeenCalledTimes(1);
  });

  // ─── Orden de guardas ──────────────────────────────────────────────────────────────────────
  it("un VIEWER no puede editar y no obtiene pistas sobre qué títulos existen", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    mountAccountDb(createAccountDb([LEGACY])); // el padre no existe

    const result = await updateAccountAction({ id: "acc-4d", code: "1.1.01.01.001" });

    expectRechazo(result, "No autorizado");
    expect(askedForCode(prisma.account.findFirst, "1.1.01.01")).toBe(false);
    sinCambios();
  });
});

// ─── getAccountsAction · lo existente no se bloquea (SPEC-008 RN-12 / CA-15) ─────

describe("getAccountsAction — el plan existente se lee sin exigir títulos padre (SPEC-008 RN-12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAccountMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
  });

  it("CA-15: una empresa con cuentas de movimiento SIN título padre se lee completa, sin validar jerarquía", async () => {
    const huerfanas = [
      accountRow({ id: "a1", code: "1.1.01.01.001" }),
      accountRow({ id: "a2", code: "1.1.01.01.002" }),
      accountRow({ id: "a3", code: "1105", isPostable: true }),
    ];
    mountAccountDb(createAccountDb(huerfanas));

    const result = await getAccountsAction("company-1");

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(3);
    expect(prisma.account.findFirst).not.toHaveBeenCalled();
  });
});

// ─── getNextAccountCodeAction · sugerencia de 9 dígitos dentro de un título (SPEC-008) ──

const MSG_PADRE_INVALIDO = "La cuenta padre no es válida para este tipo de cuenta.";
const MSG_999 = (parent: string) => `El título ${parent} ya tiene 999 cuentas; elige otro título.`;

describe("getNextAccountCodeAction — sugerencia de código de 9 dígitos dentro de un título (SPEC-008)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAccountMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
  });

  const hijas = (parent: string, from: number, to: number, over: Partial<AccountRow> = {}) =>
    Array.from({ length: to - from + 1 }, (_, i) =>
      accountRow({
        id: `h-${over.companyId ?? "company-1"}-${parent}-${from + i}`,
        code: `${parent}.${String(from + i).padStart(3, "0")}`,
        ...over,
      })
    );

  // ─── CA-1 / CA-2: la serie del plan real ───────────────────────────────────────────────────
  it("CA-1: con 1.1.01.01.001 y .002 existentes sugiere 1.1.01.01.003 (con la forma { success, data: { code } })", async () => {
    mountAccountDb(createAccountDb([TITULO_CAJAS, ...hijas("1.1.01.01", 1, 2)]));

    const result = await getNext("ASSET", "company-1", "t-cajas");

    expect(result).toEqual({ success: true, data: { code: "1.1.01.01.003" } });
  });

  it("padre sin hijos → 001", async () => {
    mountAccountDb(createAccountDb([TITULO_CAJAS]));

    const result = await getNext("ASSET", "company-1", "t-cajas");

    expect(result).toEqual({ success: true, data: { code: "1.1.01.01.001" } });
  });

  it("CA-2: con un hueco (001 y 003) sugiere 002", async () => {
    mountAccountDb(
      createAccountDb([
        TITULO_CAJAS,
        accountRow({ id: "h1", code: "1.1.01.01.001" }),
        accountRow({ id: "h3", code: "1.1.01.01.003" }),
      ])
    );

    const result = await getNext("ASSET", "company-1", "t-cajas");

    expect(result).toEqual({ success: true, data: { code: "1.1.01.01.002" } });
  });

  it("los hijos de OTRO título de la misma empresa no cuentan", async () => {
    mountAccountDb(
      createAccountDb([
        TITULO_CAJAS,
        accountRow({ id: "t-bancos", code: "1.1.01.02", name: "BANCOS" }),
        ...hijas("1.1.01.02", 1, 5),
        ...hijas("1.1.01.01", 1, 1),
      ])
    );

    const result = await getNext("ASSET", "company-1", "t-cajas");

    expect(result).toEqual({ success: true, data: { code: "1.1.01.01.002" } });
  });

  // ─── CA-3 / RN-5: las eliminadas siguen ocupando el código ─────────────────────────────────
  it("CA-3: 1.1.01.01.003 existe ELIMINADA → no se sugiere ese código (sugiere 004)", async () => {
    mountAccountDb(
      createAccountDb([
        TITULO_CAJAS,
        ...hijas("1.1.01.01", 1, 2),
        accountRow({ id: "h3-del", code: "1.1.01.01.003", deletedAt: new Date("2026-09-01") }),
      ])
    );

    const result = await getNext("ASSET", "company-1", "t-cajas");

    expect(result).toEqual({ success: true, data: { code: "1.1.01.01.004" } });
  });

  it("CA-3: una eliminada en un hueco (001 viva, 002 eliminada, 003 viva) no se reutiliza → 004", async () => {
    mountAccountDb(
      createAccountDb([
        TITULO_CAJAS,
        accountRow({ id: "h1", code: "1.1.01.01.001" }),
        accountRow({ id: "h2-del", code: "1.1.01.01.002", deletedAt: new Date("2026-09-01") }),
        accountRow({ id: "h3", code: "1.1.01.01.003" }),
      ])
    );

    const result = await getNext("ASSET", "company-1", "t-cajas");

    expect(result).toEqual({ success: true, data: { code: "1.1.01.01.004" } });
  });

  it("RN-5: los códigos ocupados se leen de TODAS las filas de la empresa, sin filtrar deletedAt", async () => {
    mountAccountDb(createAccountDb([TITULO_CAJAS, ...hijas("1.1.01.01", 1, 2)]));

    await getNext("ASSET", "company-1", "t-cajas");

    const wheres = wheresOf(prisma.account.findMany);
    expect(wheres.length).toBeGreaterThan(0);
    for (const where of wheres) {
      expect(where.companyId).toBe("company-1");
      expect(where).not.toHaveProperty("deletedAt");
    }
  });

  // ─── CA-4 / RN-6 ───────────────────────────────────────────────────────────────────────────
  it("CA-4: el título ya tiene los 999 hijos → error de negocio, no un código", async () => {
    // 999 filas, algunas eliminadas: las eliminadas siguen contando.
    const todas = hijas("1.1.01.01", 1, 999).map((r, i) =>
      i % 7 === 0 ? { ...r, deletedAt: new Date("2026-09-01") } : r
    );
    mountAccountDb(createAccountDb([TITULO_CAJAS, ...todas]));

    const result = await getNext("ASSET", "company-1", "t-cajas");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(MSG_999("1.1.01.01"));
    expect(result).not.toHaveProperty("data");
  });

  it("CA-4: con 998 hijos todavía sugiere el 999", async () => {
    mountAccountDb(createAccountDb([TITULO_CAJAS, ...hijas("1.1.01.01", 1, 998)]));

    const result = await getNext("ASSET", "company-1", "t-cajas");

    expect(result).toEqual({ success: true, data: { code: "1.1.01.01.999" } });
  });

  // ─── CA-5: el padre no sirve (un test por caso) ────────────────────────────────────────────
  it.each([
    ["el padre es de OTRA empresa", [{ ...TITULO_CAJAS, companyId: "company-2" }] as AccountRow[]],
    [
      "el padre está ELIMINADO",
      [{ ...TITULO_CAJAS, deletedAt: new Date("2026-09-01") }] as AccountRow[],
    ],
    [
      "el padre tiene 9 dígitos (es una cuenta de movimiento)",
      [
        accountRow({
          id: "t-cajas",
          code: "1.1.01.01.001",
          name: "Caja Principal",
          isPostable: true,
        }),
      ],
    ],
    [
      "el padre tiene 9 dígitos aunque isPostable=false (dato inconsistente)",
      [
        accountRow({
          id: "t-cajas",
          code: "1.1.01.01.001",
          name: "Caja Principal",
          isPostable: false,
        }),
      ],
    ],
    [
      "el padre tiene 4 dígitos (1.1.01)",
      [accountRow({ id: "t-cajas", code: "1.1.01", name: "CAJAS", isPostable: false })],
    ],
    [
      "el padre tiene 6 dígitos pero isPostable=true",
      [{ ...TITULO_CAJAS, isPostable: true }] as AccountRow[],
    ],
    ["el padre no existe (id desconocido)", [] as AccountRow[]],
  ])("CA-5: %s → error de negocio y ninguna sugerencia", async (_label, rows) => {
    mountAccountDb(createAccountDb(rows));

    const result = await getNext("ASSET", "company-1", "t-cajas");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(MSG_PADRE_INVALIDO);
    expect(result).not.toHaveProperty("data");
  });

  // ─── CA-6 ──────────────────────────────────────────────────────────────────────────────────
  it("CA-6: CONTRA_ASSET con un título ASSET como padre → sugiere dentro de él", async () => {
    mountAccountDb(
      createAccountDb([
        accountRow({ id: "t-dep", code: "1.1.09.01", name: "DEPRECIACION", type: "ASSET" }),
      ])
    );

    const result = await getNext("CONTRA_ASSET", "company-1", "t-dep");

    expect(result).toEqual({ success: true, data: { code: "1.1.09.01.001" } });
  });

  it("CA-6: LIABILITY con un título ASSET como padre → se rechaza", async () => {
    mountAccountDb(createAccountDb([TITULO_CAJAS]));

    const result = await getNext("LIABILITY", "company-1", "t-cajas");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(MSG_PADRE_INVALIDO);
  });

  it("CA-6: ASSET con un título CONTRA_ASSET como padre → se rechaza", async () => {
    mountAccountDb(createAccountDb([{ ...TITULO_CAJAS, type: "CONTRA_ASSET" }]));

    const result = await getNext("ASSET", "company-1", "t-cajas");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe(MSG_PADRE_INVALIDO);
  });

  it.each([
    ["ASSET", "1.1.01.01"],
    ["LIABILITY", "2.1.05.02"],
    ["EQUITY", "3.2.01.01"],
    ["REVENUE", "4.1.01.01"],
    ["EXPENSE", "5.1.02.03"],
  ] as const)("el tipo %s sugiere dentro de su título (%s) → .001", async (type, parent) => {
    mountAccountDb(
      createAccountDb([accountRow({ id: "t-x", code: parent, name: "TITULO", type })])
    );

    const result = await getNext(type, "company-1", "t-x");

    expect(result).toEqual({ success: true, data: { code: `${parent}.001` } });
  });

  // ─── CA-7: parentId obligatorio ────────────────────────────────────────────────────────────
  it("CA-7: sin parentId → error de validación, sin consultar cuentas", async () => {
    mountAccountDb(createAccountDb([TITULO_CAJAS]));

    const result = await getNext("ASSET", "company-1", undefined);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Datos inválidos");
      expect(result.fieldErrors?.parentId).toBeDefined();
    }
    expect(prisma.account.findMany).not.toHaveBeenCalled();
    expect(prisma.account.findFirst).not.toHaveBeenCalled();
  });

  it("CA-7: parentId vacío ('') → error de validación, sin consultar cuentas", async () => {
    mountAccountDb(createAccountDb([TITULO_CAJAS]));

    const result = await getNext("ASSET", "company-1", "");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Datos inválidos");
      expect(result.fieldErrors?.parentId).toBeDefined();
    }
    expect(prisma.account.findMany).not.toHaveBeenCalled();
    expect(prisma.account.findFirst).not.toHaveBeenCalled();
  });

  it("CA-7: parentId que no es string → error de validación", async () => {
    mountAccountDb(createAccountDb([TITULO_CAJAS]));

    const result = await getNext("ASSET", "company-1", 123 as unknown as string);

    expect(result.success).toBe(false);
    expect(prisma.account.findMany).not.toHaveBeenCalled();
  });

  it("CA-7: un tipo de cuenta inválido → error de validación en `type`", async () => {
    mountAccountDb(createAccountDb([TITULO_CAJAS]));

    const result = await getNext(
      "PATRIMONIO_X" as unknown as AccountTypeValue,
      "company-1",
      "t-cajas"
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.fieldErrors?.type).toBeDefined();
    expect(prisma.account.findMany).not.toHaveBeenCalled();
  });

  // ─── CA-tenant ─────────────────────────────────────────────────────────────────────────────
  it("CA-tenant: el padre se busca por id + empresa verificada + sin eliminadas", async () => {
    mountAccountDb(createAccountDb([TITULO_CAJAS]));

    await getNext("ASSET", "company-1", "t-cajas");

    expect(prisma.account.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "t-cajas", companyId: "company-1", deletedAt: null }),
      })
    );
    expect(prisma.companyMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: "company-1", userId: "user-1" } })
    );
  });

  it("CA-tenant: usuario que NO es miembro de la empresa → acceso denegado y ninguna cuenta consultada", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    mountAccountDb(createAccountDb([TITULO_CAJAS, ...hijas("1.1.01.01", 1, 2)]));

    const result = await getNext("ASSET", "company-1", "t-cajas");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Empresa no encontrada");
    expect(prisma.account.findMany).not.toHaveBeenCalled();
    expect(prisma.account.findFirst).not.toHaveBeenCalled();
  });

  it("CA-tenant: el id de un título de OTRA empresa no sirve, y el error no filtra ningún dato ajeno", async () => {
    const ajeno = accountRow({
      id: "t-ajeno",
      companyId: "company-2",
      code: "1.1.07.07",
      name: "TITULO SECRETO",
      type: "ASSET",
    });
    mountAccountDb(
      createAccountDb([
        TITULO_CAJAS,
        ajeno,
        ...hijas("1.1.07.07", 1, 3, { companyId: "company-2" }),
      ])
    );

    const result = await getNext("ASSET", "company-1", "t-ajeno");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(MSG_PADRE_INVALIDO);
      expect(result.error).not.toContain("1.1.07.07");
      expect(result.error).not.toContain("SECRETO");
    }
  });

  it("CA-tenant: los códigos de otra empresa NO ocupan códigos de ésta (mismo código de título en dos empresas)", async () => {
    mountAccountDb(
      createAccountDb([
        { ...TITULO_CAJAS, id: "t-c1", companyId: "company-1" },
        { ...TITULO_CAJAS, id: "t-c2", companyId: "company-2" },
        ...hijas("1.1.01.01", 1, 1, { companyId: "company-1" }),
        ...hijas("1.1.01.01", 2, 40, { companyId: "company-2" }),
      ])
    );

    const result = await getNext("ASSET", "company-1", "t-c1");

    expect(result).toEqual({ success: true, data: { code: "1.1.01.01.002" } });
    for (const where of wheresOf(prisma.account.findMany))
      expect(where.companyId).toBe("company-1");
  });

  // ─── Guarda: sesión, rol, limiter (lectura) ────────────────────────────────────────────────
  it("sin sesión (userId null) → 'No autorizado' y ninguna cuenta consultada", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    mountAccountDb(createAccountDb([TITULO_CAJAS]));

    const result = await getNext("ASSET", "company-1", "t-cajas");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(prisma.account.findMany).not.toHaveBeenCalled();
    expect(prisma.account.findFirst).not.toHaveBeenCalled();
  });

  it("RN-13: es de LECTURA — un VIEWER (MEMBER_ANY) obtiene la sugerencia", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    mountAccountDb(createAccountDb([TITULO_CAJAS, ...hijas("1.1.01.01", 1, 2)]));

    const result = await getNext("ASSET", "company-1", "t-cajas");

    expect(result).toEqual({ success: true, data: { code: "1.1.01.01.003" } });
  });

  it("RN-13: usa el limiter de lectura (limiters.read), no el fiscal", async () => {
    mountAccountDb(createAccountDb([TITULO_CAJAS]));

    await getNext("ASSET", "company-1", "t-cajas");

    expect(checkRateLimit).toHaveBeenCalledWith("company-1:user-1", { kind: "read" });
    expect(checkRateLimit).not.toHaveBeenCalledWith(expect.anything(), { kind: "fiscal" });
  });

  it("rate limit excedido → error y ninguna cuenta consultada", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      allowed: false,
      error: "Límite de solicitudes excedido",
    } as never);
    mountAccountDb(createAccountDb([TITULO_CAJAS]));

    const result = await getNext("ASSET", "company-1", "t-cajas");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Límite");
    expect(prisma.account.findMany).not.toHaveBeenCalled();
  });

  it("RN-13: sin AuditLog, sin transacción y sin revalidar (es una lectura)", async () => {
    mountAccountDb(createAccountDb([TITULO_CAJAS]));

    await getNext("ASSET", "company-1", "t-cajas");

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  it("un error inesperado de la BD se devuelve como error de negocio, sin lanzar", async () => {
    vi.mocked(prisma.account.findFirst).mockRejectedValue(new Error("query execution failed"));
    vi.mocked(prisma.account.findMany).mockResolvedValue([] as never);

    const result = await getNext("ASSET", "company-1", "t-cajas");

    expect(result.success).toBe(false);
  });
});
