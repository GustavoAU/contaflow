// src/app/(dashboard)/company/[companyId]/bank-reconciliation/page.test.ts
//
// SPEC-012 · ENTREGA B1 · CA-19 (modo RED) — la página de conciliación bancaria entrega a
// `BankAccountList` TÍTULOS Y cuentas de movimiento: la consulta `prisma.account.findMany` deja de
// filtrar `isPostable: true` y CONSERVA `companyId` y `deletedAt: null`; su `select` incluye
// `isPostable`; lo que viaja al cliente son SOLO `{id, code, name, type?, isPostable}`.
//
// Es una página de servidor (async): se invoca como función y se inspecciona el árbol de elementos que
// devuelve, sin renderizarlo. La consulta se evalúa contra una BD en memoria con varias empresas, cuentas
// eliminadas y columnas de más (ver `account-page-data.ts`), así que un `where` incompleto se nota.

import { beforeEach, describe, expect, it, vi } from "vitest";

import BankReconciliationPage from "./page";
import { BankAccountList } from "@/modules/bank-reconciliation/components/BankAccountList";
import { BankAccountService } from "@/modules/bank-reconciliation/services/BankAccountService";
import { currentUser } from "@clerk/nextjs/server";
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

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => {
  const prisma = { account: { findMany } };
  return { prisma, default: prisma };
});
vi.mock("@clerk/nextjs/server", () => ({ currentUser: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/modules/bank-reconciliation/services/BankAccountService", () => ({
  BankAccountService: { list: vi.fn() },
}));
vi.mock("@/modules/bank-reconciliation/services/BankStatementService", () => ({
  BankStatementService: { listByAccount: vi.fn() },
}));
vi.mock("@/modules/bank-reconciliation/components/BankAccountList", () => ({
  BankAccountList: function BankAccountList() {
    return null;
  },
}));
vi.mock("@/modules/bank-reconciliation/components/AutoReconciliationPanel", () => ({
  AutoReconciliationPanel: function AutoReconciliationPanel() {
    return null;
  },
}));

const rows = seedAccounts();

async function renderPage() {
  return BankReconciliationPage({
    params: Promise.resolve({ companyId: COMPANY_ID }),
    searchParams: Promise.resolve({}),
  });
}

async function chartAccounts() {
  const tree = await renderPage();
  const lists = findAll(tree, BankAccountList);
  expect(lists).toHaveLength(1);
  return (lists[0].props as { chartAccounts: Record<string, unknown>[] }).chartAccounts;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
  vi.mocked(BankAccountService.list).mockResolvedValue([] as never);
  findMany.mockImplementation(createSeededDb(rows).findMany);
});

describe("BankReconciliationPage — títulos y cuentas para el selector buscable (SPEC-012 B1, CA-19)", () => {
  it("la consulta de cuentas NO filtra isPostable y conserva companyId y deletedAt: null", async () => {
    await renderPage();
    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expectWhereKeepsScope(args.where);
  });

  it("el where es EXACTAMENTE { companyId, deletedAt: null } (este formulario no filtra por tipo)", async () => {
    await renderPage();
    const args = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toEqual({ companyId: COMPANY_ID, deletedAt: null });
  });

  it("el select pide isPostable (sin él el combobox trataría todo como título) y nada de más", async () => {
    await renderPage();
    const args = findMany.mock.calls[0][0] as { select?: Record<string, unknown> };
    expectSelectKeys(args.select, ["id", "code", "name", "isPostable"], ["type"]);
  });

  it("BankAccountList recibe los títulos Y las cuentas de movimiento de la empresa (no las eliminadas ni las de otra)", async () => {
    const delivered = await chartAccounts();
    const ids = delivered.map((a) => a.id);
    expect(ids.sort()).toEqual(expectedIds(rows).sort());
    expect(delivered.some((a) => a.isPostable === false)).toBe(true);
    expect(delivered.some((a) => a.isPostable === true)).toBe(true);
  });

  it("cada cuenta que viaja al cliente lleva SOLO {id, code, name, type?, isPostable}", async () => {
    expectKeysWithin(await chartAccounts(), ["id", "code", "name", "isPostable"], ["type"]);
  });

  it("isPostable viaja con su valor real: los títulos con false y las cuentas de movimiento con true", async () => {
    const delivered = await chartAccounts();
    for (const original of rows.filter((r) => r.companyId === COMPANY_ID && r.deletedAt === null)) {
      expect(delivered).toContainEqual(
        expect.objectContaining({ id: original.id, isPostable: original.isPostable })
      );
    }
  });

  it("sigue entregando la lista de cuentas bancarias, companyId y userId", async () => {
    const accounts = [{ id: "ba-1" }];
    vi.mocked(BankAccountService.list).mockResolvedValue(accounts as never);
    const tree = await renderPage();
    const props = findAll(tree, BankAccountList)[0].props as Record<string, unknown>;
    expect(props.accounts).toBe(accounts);
    expect(props.companyId).toBe(COMPANY_ID);
    expect(props.userId).toBe("user-1");
  });

  it("sin usuario redirige al inicio de sesión antes de consultar nada", async () => {
    vi.mocked(currentUser).mockResolvedValue(null as never);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(findMany).not.toHaveBeenCalled();
  });
});
