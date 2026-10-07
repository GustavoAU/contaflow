// src/app/(dashboard)/company/[companyId]/payroll/config/edit/page.test.ts
//
// SPEC-012 · ENTREGA B2 · CA-19 (modo RED) — la página «Editar configuración de nómina» alimenta a
// `PayrollWizard` con `prisma.account.findMany` DIRECTO (no pasa por `getAccountsAction`):
//   · la consulta deja de filtrar `isPostable: true` y CONSERVA `companyId` y `deletedAt: null` (esta
//     consulta no filtra por tipo: el asistente ofrece TODO el plan en los 17 selectores);
//   · su `select` pide `isPostable` (sin él el combobox trataría todo como título) y nada de más;
//   · al cliente viaja SOLO `{id, code, name, isPostable}`.
//
// Es una página de servidor (async): se invoca como función y se inspecciona el árbol de elementos que
// devuelve, sin renderizarlo. La consulta se evalúa contra una BD en memoria con varias empresas, cuentas
// eliminadas y columnas de más (ver `account-page-data.ts`): un `where` incompleto se nota.

import { beforeEach, describe, expect, it, vi } from "vitest";

import PayrollConfigEditPage from "./page";
import PayrollWizard from "@/modules/payroll/components/PayrollWizard";
import { PayrollConfigService } from "@/modules/payroll/services/PayrollConfigService";
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
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/modules/payroll/services/PayrollConfigService", () => ({
  PayrollConfigService: { getConfig: vi.fn() },
}));
vi.mock("@/modules/payroll/components/PayrollWizard", () => ({
  default: function PayrollWizard() {
    return null;
  },
}));

const rows = seedAccounts();
const CONFIG = { id: "cfg-1", companyId: COMPANY_ID, expenseAccountId: "m-expense" };

async function renderPage() {
  return PayrollConfigEditPage({ params: Promise.resolve({ companyId: COMPANY_ID }) });
}

async function deliveredAccounts() {
  const tree = await renderPage();
  const wizards = findAll(tree, PayrollWizard);
  expect(wizards).toHaveLength(1);
  return (wizards[0].props as { accounts: Record<string, unknown>[] }).accounts;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
  findFirstMember.mockResolvedValue({ role: "ADMIN" });
  vi.mocked(PayrollConfigService.getConfig).mockResolvedValue(CONFIG as never);
  findMany.mockImplementation(createSeededDb(rows).findMany);
});

describe("PayrollConfigEditPage — títulos y cuentas para el asistente de nómina (SPEC-012 B2, CA-19)", () => {
  it("la consulta de cuentas NO filtra isPostable y conserva companyId y deletedAt: null", async () => {
    await renderPage();
    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expectWhereKeepsScope(args.where);
  });

  it("el where es EXACTAMENTE { companyId, deletedAt: null } (el asistente ofrece todo el plan)", async () => {
    await renderPage();
    const args = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toEqual({ companyId: COMPANY_ID, deletedAt: null });
  });

  it("el select pide isPostable (sin él el combobox trataría todo como título) y nada de más", async () => {
    await renderPage();
    const args = findMany.mock.calls[0][0] as { select?: Record<string, unknown> };
    expectSelectKeys(args.select, ["id", "code", "name", "isPostable"]);
  });

  it("conserva el orden por código", async () => {
    await renderPage();
    const args = findMany.mock.calls[0][0] as { orderBy?: unknown };
    expect(args.orderBy).toEqual({ code: "asc" });
  });

  it("PayrollWizard recibe los títulos Y las cuentas de movimiento de la empresa (no las eliminadas ni las de otra)", async () => {
    const delivered = await deliveredAccounts();
    expect(delivered.map((a) => a.id).sort()).toEqual(expectedIds(rows).sort());
    expect(delivered.some((a) => a.isPostable === false)).toBe(true);
    expect(delivered.some((a) => a.isPostable === true)).toBe(true);
  });

  it("cada cuenta que viaja al cliente lleva SOLO {id, code, name, isPostable}", async () => {
    const delivered = await deliveredAccounts();
    expectKeysWithin(delivered, ["id", "code", "name", "isPostable"]);
    for (const account of delivered) {
      expect(Object.keys(account).sort()).toEqual(["code", "id", "isPostable", "name"]);
    }
  });

  it("isPostable viaja con su valor real: títulos con false y cuentas de movimiento con true", async () => {
    const delivered = await deliveredAccounts();
    for (const original of rows.filter((r) => r.companyId === COMPANY_ID && r.deletedAt === null)) {
      expect(delivered).toContainEqual(
        expect.objectContaining({
          id: original.id,
          code: original.code,
          name: original.name,
          isPostable: original.isPostable,
        })
      );
    }
  });

  it("sigue entregando la configuración vigente y el companyId (guarda verde)", async () => {
    const tree = await renderPage();
    const props = findAll(tree, PayrollWizard)[0].props as Record<string, unknown>;
    expect(PayrollConfigService.getConfig).toHaveBeenCalledWith(COMPANY_ID);
    expect(props.companyId).toBe(COMPANY_ID);
    expect(props.initial).toBe(CONFIG);
  });
});

describe("PayrollConfigEditPage — quién puede editar (guardas verdes)", () => {
  it("sin sesión redirige al inicio de sesión antes de leer nada", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(findMany).not.toHaveBeenCalled();
    expect(PayrollConfigService.getConfig).not.toHaveBeenCalled();
  });

  it("un usuario que no es miembro de la empresa es redirigido antes de leer las cuentas", async () => {
    findFirstMember.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("un rol que no es administrador es redirigido a la nómina antes de leer las cuentas", async () => {
    findFirstMember.mockResolvedValue({ role: "VIEWER" });
    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:/company/${COMPANY_ID}/payroll`);
    expect(findMany).not.toHaveBeenCalled();
  });
});
