// src/modules/accounting/actions/transaction.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    transaction: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    companyMember: {
      findFirst: vi.fn(),
    },
    rolePermission: {
      findFirst: vi.fn(),
    },
    accountingPeriod: {
      findFirst: vi.fn(),
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

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  fiscalKey: (c: string, u: string) => `${c}:${u}`,
  limiters: { fiscal: {}, read: {} },
}));

vi.mock("@/lib/report-cache", () => ({
  withPeriodCache: vi.fn().mockImplementation((_key: unknown, fn: () => unknown) => fn()),
  invalidatePeriod: vi.fn(),
}));

// createTransactionAction — solo se sobreescribe `createBalancedTransaction`. El
// resto de TransactionService (getTransactionsByCompany, getTransactionsPaginated,
// ...) se mantiene REAL: esos métodos delegan en `prisma.transaction.findMany`, ya
// mockeado arriba, y las pruebas de auth guards de abajo dependen de eso.
//
// IMPORTANTE: `TransactionService` es una CLASE — sus métodos estáticos son
// propiedades NO enumerables, así que `{ ...actual.TransactionService }` los
// pierde todos (spread solo copia propiedades enumerables). Hay que mutar el
// objeto real en vez de espaciarlo.
vi.mock("../services/TransactionService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/TransactionService")>();
  actual.TransactionService.createBalancedTransaction = vi.fn();
  return actual;
});

vi.mock("@/modules/billing/services/SubscriptionService", () => ({
  assertWriteAllowed: vi.fn().mockResolvedValue(undefined),
  READ_ONLY_MESSAGE: "Tu suscripción venció. Estás en modo solo lectura — renueva tu plan para volver a operar.",
}));

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { TransactionService } from "../services/TransactionService";
import {
  getTransactionsByCompanyAction,
  getTransactionsPaginatedAction,
  createTransactionAction,
} from "./transaction.actions";

// ─── getTransactionsByCompanyAction ──────────────────────────────────────────

describe("getTransactionsByCompanyAction — auth guards (HIGH finding)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rechaza llamada sin autenticar", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await getTransactionsByCompanyAction("company-1");

    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe("No autorizado");
  });

  it("rechaza usuario autenticado que no es miembro de la empresa", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-outsider" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);

    const result = await getTransactionsByCompanyAction("company-1");

    expect(result.success).toBe(false);
  });

  it("permite acceso a miembro válido de la empresa", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      userId: "user-1",
      companyId: "company-1",
      role: "ACCOUNTANT",
    } as never);
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

    const result = await getTransactionsByCompanyAction("company-1");

    expect(result.success).toBe(true);
  });
});

// ─── getTransactionsPaginatedAction ──────────────────────────────────────────

describe("getTransactionsPaginatedAction — membership guard (HIGH finding)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rechaza llamada sin autenticar", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await getTransactionsPaginatedAction("company-1");

    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe("No autorizado");
  });

  it("rechaza usuario autenticado que no pertenece a la empresa (IDOR)", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-attacker" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);

    const result = await getTransactionsPaginatedAction("company-victim");

    expect(result.success).toBe(false);
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });

  it("permite acceso a miembro válido con rol VIEWER", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      userId: "user-1",
      companyId: "company-1",
      role: "VIEWER",
    } as never);
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

    const result = await getTransactionsPaginatedAction("company-1");

    expect(result.success).toBe(true);
  });
});

// ─── createTransactionAction — ADR-025 grant vs canAccess (VIEWER bypass) ────
//
// Regresión del hallazgo confirmado: createTransactionAction usaba
// `roles: "MEMBER_ANY"` + `hasModuleAccess(companyId, role, "accounting")` como
// ÚNICO gate de rol. Un VIEWER con un grant de RolePermission al módulo
// "accounting" (otorgado vía PermissionsMatrix en /settings) terminaba pudiendo
// crear asientos — exactamente lo que ADR-025 (líneas 68-80) prohíbe: los grants
// dan SOLO visibilidad de módulo, nunca deben bastar para saltarse un check de
// operación más restrictivo. El fix agrega `canAccess(ctx.role, ROLES.ACCOUNTING)`
// inmediatamente después de `hasModuleAccess`.
describe("createTransactionAction — ADR-025 grant vs canAccess (VIEWER bypass regression)", () => {
  const VALID_TRANSACTION_INPUT = {
    companyId: "company-1",
    userId: "user-1",
    description: "Asiento de prueba",
    date: new Date("2026-03-10"),
    type: "DIARIO" as const,
    entries: [
      { accountId: "acc-1", debit: "100", credit: "" },
      { accountId: "acc-2", debit: "", credit: "100" },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.rolePermission.findFirst).mockResolvedValue(null as never);
    vi.mocked(TransactionService.createBalancedTransaction).mockResolvedValue({
      id: "tx-1",
      number: "T-2026-001",
    } as never);
  });

  it("rechaza VIEWER sin grant al módulo de contabilidad", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      userId: "user-1",
      companyId: "company-1",
      role: "VIEWER",
      company: { country: "VEN" },
    } as never);
    // VIEWER sin grant explícito → hasModuleAccess retorna false (ADR-025)
    vi.mocked(prisma.rolePermission.findFirst).mockResolvedValue(null as never);

    const result = await createTransactionAction(VALID_TRANSACTION_INPUT);

    expect(result.success).toBe(false);
    expect(TransactionService.createBalancedTransaction).not.toHaveBeenCalled();
  });

  it("REGRESIÓN (bypass cerrado): VIEWER CON grant explícito a 'accounting' sigue sin poder crear asientos", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      userId: "user-1",
      companyId: "company-1",
      role: "VIEWER",
      company: { country: "VEN" },
    } as never);
    // El grant SÍ existe — antes del fix esto hacía que hasModuleAccess retornara
    // true y la mutación se ejecutara igual (el bug real y confirmado). El nuevo
    // canAccess(ctx.role, ROLES.ACCOUNTING) debe bloquearlo de todos modos.
    vi.mocked(prisma.rolePermission.findFirst).mockResolvedValue({
      id: "grant-1",
      companyId: "company-1",
      role: "VIEWER",
      module: "accounting",
    } as never);

    const result = await createTransactionAction(VALID_TRANSACTION_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(
        "Crear asientos contables requiere rol Contador, Administrador o Propietario",
      );
    }
    expect(TransactionService.createBalancedTransaction).not.toHaveBeenCalled();
  });

  it("ACCOUNTANT puede crear asientos (acceso base, sin necesitar grant)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      userId: "user-1",
      companyId: "company-1",
      role: "ACCOUNTANT",
      company: { country: "VEN" },
    } as never);

    const result = await createTransactionAction(VALID_TRANSACTION_INPUT);

    expect(result.success).toBe(true);
    expect(TransactionService.createBalancedTransaction).toHaveBeenCalledTimes(1);
  });
});
