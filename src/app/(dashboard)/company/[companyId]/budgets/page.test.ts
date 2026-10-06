// src/app/(dashboard)/company/[companyId]/budgets/page.test.ts
//
// SPEC-012 · ENTREGA B1 · CA-19 (modo RED) — la página de presupuestos entrega a `BudgetPageClient`
// (y de ahí a `BudgetList` → `BudgetDetail`) TÍTULOS Y cuentas de movimiento: la consulta
// `prisma.account.findMany` deja de filtrar `isPostable: true` y CONSERVA `companyId` y
// `deletedAt: null`; su `select` incluye `isPostable`; lo que viaja al cliente son SOLO
// `{id, code, name, type?, isPostable}`.
//
// Página de servidor (async): se invoca como función y se inspecciona el árbol que devuelve. La consulta
// se evalúa contra una BD en memoria con varias empresas, cuentas eliminadas y columnas de más.

import { beforeEach, describe, expect, it, vi } from "vitest";

import BudgetsPage from "./page";
import { BudgetPageClient } from "./BudgetPageClient";
import { BudgetService } from "@/modules/budgets/services/BudgetService";
import { CashFlowProjectionService } from "@/modules/budgets/services/CashFlowProjectionService";
import { auth } from "@clerk/nextjs/server";
import { findAll } from "@/__tests__/helpers/react-tree";
import {
  COMPANY_ID,
  createSeededDb,
  expectKeysWithin,
  expectSelectKeys,
  expectWhereKeepsScope,
  expectedIds,
  seedAccounts,
} from "@/__tests__/helpers/account-page-data";

const { findMany, findFirstMember } = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirstMember: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const prisma = { account: { findMany }, companyMember: { findFirst: findFirstMember } };
  return { prisma, default: prisma };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/modules/budgets/services/BudgetService", () => ({ BudgetService: { list: vi.fn() } }));
vi.mock("@/modules/budgets/services/CashFlowProjectionService", () => ({
  CashFlowProjectionService: { project: vi.fn() },
}));
vi.mock("./BudgetPageClient", () => ({
  BudgetPageClient: function BudgetPageClient() {
    return null;
  },
}));

const rows = seedAccounts();

async function renderPage() {
  return BudgetsPage({ params: Promise.resolve({ companyId: COMPANY_ID }) });
}

async function deliveredAccounts() {
  const tree = await renderPage();
  const clients = findAll(tree, BudgetPageClient);
  expect(clients).toHaveLength(1);
  return (clients[0].props as { accounts: Record<string, unknown>[] }).accounts;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
  findFirstMember.mockResolvedValue({ role: "ACCOUNTANT" });
  vi.mocked(BudgetService.list).mockResolvedValue([] as never);
  vi.mocked(CashFlowProjectionService.project).mockResolvedValue({} as never);
  findMany.mockImplementation(createSeededDb(rows).findMany);
});

describe("BudgetsPage — títulos y cuentas para el selector buscable (SPEC-012 B1, CA-19)", () => {
  it("la consulta de cuentas NO filtra isPostable y conserva companyId y deletedAt: null", async () => {
    await renderPage();
    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expectWhereKeepsScope(args.where);
  });

  it("el where es EXACTAMENTE { companyId, deletedAt: null } (el selector de presupuestos no filtra por tipo)", async () => {
    await renderPage();
    const args = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toEqual({ companyId: COMPANY_ID, deletedAt: null });
  });

  it("el select pide isPostable (sin él el combobox trataría todo como título) y nada de más", async () => {
    await renderPage();
    const args = findMany.mock.calls[0][0] as { select?: Record<string, unknown> };
    expectSelectKeys(args.select, ["id", "code", "name", "isPostable"], ["type"]);
  });

  it("BudgetPageClient recibe los títulos Y las cuentas de movimiento de la empresa (no las eliminadas ni las de otra)", async () => {
    const delivered = await deliveredAccounts();
    expect(delivered.map((a) => a.id).sort()).toEqual(expectedIds(rows).sort());
    expect(delivered.some((a) => a.isPostable === false)).toBe(true);
    expect(delivered.some((a) => a.isPostable === true)).toBe(true);
  });

  it("cada cuenta que viaja al cliente lleva SOLO {id, code, name, type?, isPostable}", async () => {
    expectKeysWithin(await deliveredAccounts(), ["id", "code", "name", "isPostable"], ["type"]);
  });

  it("isPostable viaja con su valor real", async () => {
    const delivered = await deliveredAccounts();
    for (const original of rows.filter((r) => r.companyId === COMPANY_ID && r.deletedAt === null)) {
      expect(delivered).toContainEqual(
        expect.objectContaining({ id: original.id, isPostable: original.isPostable })
      );
    }
  });

  it("conserva los permisos: ACCOUNTANT escribe pero no borra; OWNER ambos", async () => {
    let tree = await renderPage();
    let props = findAll(tree, BudgetPageClient)[0].props as Record<string, unknown>;
    expect(props.canWrite).toBe(true);
    expect(props.canDelete).toBe(false);

    findFirstMember.mockResolvedValue({ role: "OWNER" });
    tree = await renderPage();
    props = findAll(tree, BudgetPageClient)[0].props as Record<string, unknown>;
    expect(props.canWrite).toBe(true);
    expect(props.canDelete).toBe(true);
  });

  it("sin sesión redirige antes de consultar las cuentas", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("un no-miembro es redirigido antes de consultar las cuentas", async () => {
    findFirstMember.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(findMany).not.toHaveBeenCalled();
  });
});
