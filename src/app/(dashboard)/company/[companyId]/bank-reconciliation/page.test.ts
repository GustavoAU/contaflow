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
//
// M-1 (revisión de seguridad de la Entrega B1) — TDD SPEC, modo RED: la página hacía
// `prisma.account.findMany` y `BankAccountService.list` con el `companyId` CRUDO de la URL, sin
// comprobar la membresía por su cuenta (solo confiaba en el `redirect` del layout, que vive en otro
// archivo). Contrato: la página llama `requireCompanyPage(companyId, { id: true })` de
// `@/lib/company-page-guard` ANTES de cualquier lectura (y la ESPERA), si la guarda rechaza no lee
// nada, y la prop `userId` de `BankAccountList` es el `userId` que devuelve la guarda (la página deja
// de usar `currentUser`).

import { beforeEach, describe, expect, it, vi } from "vitest";

import BankReconciliationPage from "./page";
import { BankAccountList } from "@/modules/bank-reconciliation/components/BankAccountList";
import { BankAccountService } from "@/modules/bank-reconciliation/services/BankAccountService";
import { BankStatementService } from "@/modules/bank-reconciliation/services/BankStatementService";
import { currentUser } from "@clerk/nextjs/server";
import { requireCompanyPage } from "@/lib/company-page-guard";
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
vi.mock("@/lib/company-page-guard", () => ({ requireCompanyPage: vi.fn() }));
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

async function renderPage(searchParams: { accountId?: string } = {}) {
  return BankReconciliationPage({
    params: Promise.resolve({ companyId: COMPANY_ID }),
    searchParams: Promise.resolve(searchParams),
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
  // `currentUser` queda mockeado a propósito: la página ya NO debe usarlo, y si lo siguiera haciendo
  // los tests de M-1 lo notan (distinto `userId`, o `null` sin que la página redirija).
  vi.mocked(currentUser).mockResolvedValue({ id: "user-1" } as never);
  vi.mocked(requireCompanyPage).mockResolvedValue({
    company: { id: COMPANY_ID },
    role: "ADMIN",
    userId: "user-1",
  } as never);
  vi.mocked(BankAccountService.list).mockResolvedValue([] as never);
  vi.mocked(BankStatementService.listByAccount).mockResolvedValue([] as never);
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

});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// M-1 — la página comprueba la membresía por su cuenta (requireCompanyPage), antes de leer nada.
// ═════════════════════════════════════════════════════════════════════════════════════════════════

const BANK_ACCOUNT = { id: "ba-1", name: "Mercantil Operativa", bankName: "Mercantil", currency: "VES" };

/** Resuelve la guarda cuando el test quiere: permite comprobar que la página la ESPERA. */
function deferredGuard() {
  let release!: (ctx: unknown) => void;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  vi.mocked(requireCompanyPage).mockReturnValue(pending as never);
  return release;
}

describe("BankReconciliationPage — M-1: la guarda de membresía va PRIMERO", () => {
  it("llama a requireCompanyPage una vez, con el companyId de la URL", async () => {
    await renderPage();
    expect(requireCompanyPage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requireCompanyPage).mock.calls[0][0]).toBe(COMPANY_ID);
  });

  it("pide solo { id: true }: la página no usa ningún dato de la empresa", async () => {
    await renderPage();
    expect(requireCompanyPage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requireCompanyPage).mock.calls[0][1]).toEqual({ id: true });
  });

  it("la guarda se invoca ANTES de prisma.account.findMany y de BankAccountService.list", async () => {
    await renderPage();
    expect(requireCompanyPage).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(BankAccountService.list).toHaveBeenCalledTimes(1);
    const guardOrder = vi.mocked(requireCompanyPage).mock.invocationCallOrder[0];
    expect(guardOrder).toBeLessThan(findMany.mock.invocationCallOrder[0]);
    expect(guardOrder).toBeLessThan(
      vi.mocked(BankAccountService.list).mock.invocationCallOrder[0]
    );
  });

  it("la guarda se invoca también ANTES de listar los extractos de la cuenta elegida", async () => {
    vi.mocked(BankAccountService.list).mockResolvedValue([BANK_ACCOUNT] as never);
    await renderPage({ accountId: BANK_ACCOUNT.id });
    expect(requireCompanyPage).toHaveBeenCalledTimes(1);
    expect(BankStatementService.listByAccount).toHaveBeenCalledWith(BANK_ACCOUNT.id, COMPANY_ID);
    expect(vi.mocked(requireCompanyPage).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(BankStatementService.listByAccount).mock.invocationCallOrder[0]
    );
  });

  it("la página ESPERA la guarda: mientras no resuelve, no se lee ninguna cuenta (contable ni bancaria)", async () => {
    const release = deferredGuard();
    const pending = renderPage();
    await new Promise((resolve) => setTimeout(resolve, 0)); // deja correr todas las microtareas
    expect(requireCompanyPage).toHaveBeenCalledTimes(1);
    expect(findMany).not.toHaveBeenCalled();
    expect(BankAccountService.list).not.toHaveBeenCalled();

    release({ company: { id: COMPANY_ID }, role: "ADMIN", userId: "user-1" });
    await pending;
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(BankAccountService.list).toHaveBeenCalledTimes(1);
  });
});

describe("BankReconciliationPage — M-1: si la guarda rechaza (no es miembro) no se lee NADA", () => {
  beforeEach(() => {
    vi.mocked(requireCompanyPage).mockRejectedValue(new Error("NEXT_REDIRECT"));
    // Con la guarda satisfecha esta URL llegaría hasta los extractos: nada de eso debe ocurrir.
    vi.mocked(BankAccountService.list).mockResolvedValue([BANK_ACCOUNT] as never);
  });

  it("la página lanza (propaga el redirect de la guarda en vez de renderizar)", async () => {
    await expect(renderPage({ accountId: BANK_ACCOUNT.id })).rejects.toThrow("NEXT_REDIRECT");
    expect(requireCompanyPage).toHaveBeenCalledTimes(1);
  });

  it("no consulta las cuentas contables con el companyId de la URL", async () => {
    await expect(renderPage({ accountId: BANK_ACCOUNT.id })).rejects.toThrow("NEXT_REDIRECT");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("no lista las cuentas bancarias ni los extractos de la cuenta elegida", async () => {
    await expect(renderPage({ accountId: BANK_ACCOUNT.id })).rejects.toThrow("NEXT_REDIRECT");
    expect(BankAccountService.list).not.toHaveBeenCalled();
    expect(BankStatementService.listByAccount).not.toHaveBeenCalled();
  });
});

describe("BankReconciliationPage — M-1: el userId viene de la guarda, no de currentUser", () => {
  async function listProps() {
    const tree = await renderPage();
    const lists = findAll(tree, BankAccountList);
    expect(lists).toHaveLength(1);
    return lists[0].props as Record<string, unknown>;
  }

  it("la prop userId de BankAccountList es el userId que devuelve la guarda", async () => {
    vi.mocked(requireCompanyPage).mockResolvedValue({
      company: { id: COMPANY_ID },
      role: "ADMIN",
      userId: "guard-user-9",
    } as never);
    // Un `currentUser` con OTRO id: si la página lo siguiera usando, la prop sería «clerk-user-2».
    vi.mocked(currentUser).mockResolvedValue({ id: "clerk-user-2" } as never);
    const props = await listProps();
    expect(props.userId).toBe("guard-user-9");
    expect(props.companyId).toBe(COMPANY_ID);
  });

  it("la página ya no consulta currentUser", async () => {
    await renderPage();
    expect(currentUser).not.toHaveBeenCalled();
  });

  it("con la guarda satisfecha la página no depende de currentUser: aunque devuelva null, renderiza con el userId de la guarda", async () => {
    vi.mocked(requireCompanyPage).mockResolvedValue({
      company: { id: COMPANY_ID },
      role: "ACCOUNTANT",
      userId: "guard-user-9",
    } as never);
    vi.mocked(currentUser).mockResolvedValue(null as never);
    const props = await listProps();
    expect(props.userId).toBe("guard-user-9");
  });
});
