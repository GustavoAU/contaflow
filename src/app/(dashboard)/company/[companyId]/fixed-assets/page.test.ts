// src/app/(dashboard)/company/[companyId]/fixed-assets/page.test.ts
//
// SPEC-012 · ENTREGA B2 · CA-19 (modo RED) — la página de activos fijos alimenta a TRES formularios de
// cuenta (alta de activo, baja y panel INPC) con DOS mapeos `accounts.map(...)`:
//   · la consulta `prisma.account.findMany` deja de filtrar `isPostable: true` y CONSERVA `companyId`,
//     `deletedAt: null` y el filtro por tipo;
//   · el filtro de tipos AÑADE `LIABILITY` (respuesta de la contadora: un activo comprado a crédito se
//     contrapone a una Cuenta por Pagar). Las otras cuentas (`findBestMatch`) no cambian;
//   · su `select` pide `isPostable` y los DOS mapeos lo entregan (sin él el combobox trataría todo como
//     título y no habría nada elegible). Al cliente viaja SOLO `{id, code, name, type, isPostable}`.
//
// Es una página de servidor (async): se invoca como función y se inspecciona el árbol de elementos que
// devuelve, sin renderizarlo. La consulta se evalúa contra una BD en memoria con varias empresas, cuentas
// eliminadas y columnas de más (ver `account-page-data.ts`): un `where` incompleto se nota.

import { beforeEach, describe, expect, it, vi } from "vitest";

import FixedAssetsPage from "./page";
import { FixedAssetList } from "@/modules/fixed-assets/components/FixedAssetList";
import { FixedAssetFormPanel } from "@/modules/fixed-assets/components/FixedAssetFormPanel";
import { FixedAssetService } from "@/modules/fixed-assets/services/FixedAssetService";
import { auth } from "@clerk/nextjs/server";
import { findAll } from "@/__tests__/helpers/react-tree";
import { accountRow } from "@/__tests__/helpers/in-memory-account-db";
import {
  COMPANY_ID,
  OTHER_COMPANY_ID,
  createSeededDb,
  expectKeysWithin,
  expectSelectKeys,
  expectWhereKeepsScope,
  expectedIds,
  seedAccounts,
} from "@/__tests__/helpers/account-page-data";

const { findMany, findFirstMember, findManyRates, findUniqueSettings } = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirstMember: vi.fn(),
  findManyRates: vi.fn(),
  findUniqueSettings: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    account: { findMany },
    companyMember: { findFirst: findFirstMember },
    iNPCRate: { findMany: findManyRates },
    companySettings: { findUnique: findUniqueSettings },
  };
  return { prisma, default: prisma };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/modules/fixed-assets/services/FixedAssetService", () => ({
  FixedAssetService: { getSummary: vi.fn() },
}));
vi.mock("@/modules/fixed-assets/components/FixedAssetList", () => ({
  FixedAssetList: function FixedAssetList() {
    return null;
  },
}));
vi.mock("@/modules/fixed-assets/components/FixedAssetFormPanel", () => ({
  FixedAssetFormPanel: function FixedAssetFormPanel() {
    return null;
  },
}));

/** Los tipos que la página entrega HOY, más LIABILITY (B2). */
const TYPES_B2 = ["ASSET", "EXPENSE", "CONTRA_ASSET", "REVENUE", "EQUITY", "LIABILITY"];
const DELETED = new Date("2026-02-01");

/** El plan sembrado (sin CONTRA_ASSET) + cuentas CONTRA_ASSET (título y movimiento, una eliminada y una de otra empresa). */
const rows = [
  ...seedAccounts(),
  accountRow({
    id: `${COMPANY_ID}:t:1.3`,
    companyId: COMPANY_ID,
    code: "1.3",
    name: "DEPRECIACION ACUMULADA",
    type: "CONTRA_ASSET",
    isPostable: false,
  }),
  accountRow({
    id: `${COMPANY_ID}:m:1.3.01.01.001`,
    companyId: COMPANY_ID,
    code: "1.3.01.01.001",
    name: "Depreciación Acumulada Equipos",
    type: "CONTRA_ASSET",
    isPostable: true,
  }),
  accountRow({
    id: `${COMPANY_ID}:m:1.3.01.01.099`,
    companyId: COMPANY_ID,
    code: "1.3.01.01.099",
    name: "Contra eliminada",
    type: "CONTRA_ASSET",
    isPostable: true,
    deletedAt: DELETED,
  }),
  accountRow({
    id: `${OTHER_COMPANY_ID}:m:1.3.01.01.001`,
    companyId: OTHER_COMPANY_ID,
    code: "1.3.01.01.001",
    name: "Contra de otra empresa",
    type: "CONTRA_ASSET",
    isPostable: true,
  }),
];

async function renderPage() {
  return FixedAssetsPage({ params: Promise.resolve({ companyId: COMPANY_ID }) });
}

async function deliveredToForm() {
  const tree = await renderPage();
  const panels = findAll(tree, FixedAssetFormPanel);
  expect(panels).toHaveLength(1);
  return (panels[0].props as { accounts: Record<string, unknown>[] }).accounts;
}

async function deliveredToList() {
  const tree = await renderPage();
  const lists = findAll(tree, FixedAssetList);
  expect(lists).toHaveLength(1);
  return (lists[0].props as { accounts: Record<string, unknown>[] }).accounts;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
  findFirstMember.mockResolvedValue({ role: "ADMIN", company: { name: "Empresa Uno C.A." } });
  vi.mocked(FixedAssetService.getSummary).mockResolvedValue([] as never);
  findManyRates.mockResolvedValue([]);
  findUniqueSettings.mockResolvedValue({ ivaDFAccountId: "iva-df", ivaCFAccountId: "iva-cf" });
  findMany.mockImplementation(createSeededDb(rows).findMany);
});

describe("FixedAssetsPage — títulos y cuentas para los formularios de activos (SPEC-012 B2, CA-19)", () => {
  it("la consulta de cuentas NO filtra isPostable y conserva companyId y deletedAt: null", async () => {
    await renderPage();
    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expectWhereKeepsScope(args.where);
  });

  it("el filtro por tipo incluye LIABILITY y conserva ASSET, EXPENSE, CONTRA_ASSET, REVENUE y EQUITY (ni más ni menos)", async () => {
    await renderPage();
    const args = findMany.mock.calls[0][0] as { where: { type?: { in?: string[] } } };
    expect(args.where.type?.in, "el where debe filtrar por `type: { in: [...] }`").toBeDefined();
    expect([...(args.where.type?.in ?? [])].sort()).toEqual([...TYPES_B2].sort());
  });

  // Mutantes B2 (test-agent): el orden de la consulta no estaba fijado (como sí lo está en la página de nómina).
  it("conserva el orden por tipo y luego por código", async () => {
    await renderPage();
    const args = findMany.mock.calls[0][0] as { orderBy?: unknown };
    expect(args.orderBy).toEqual([{ type: "asc" }, { code: "asc" }]);
  });

  it("el where tiene EXACTAMENTE tres claves: companyId, deletedAt y type", async () => {
    await renderPage();
    const args = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(Object.keys(args.where).sort()).toEqual(["companyId", "deletedAt", "type"]);
  });

  it("el select pide isPostable (sin él el combobox trataría todo como título) y nada de más", async () => {
    await renderPage();
    const args = findMany.mock.calls[0][0] as { select?: Record<string, unknown> };
    expectSelectKeys(args.select, ["id", "code", "name", "type", "isPostable"]);
  });

  it("FixedAssetFormPanel recibe los títulos Y las cuentas de movimiento de los seis tipos (no las eliminadas ni las de otra empresa)", async () => {
    const delivered = await deliveredToForm();
    expect(delivered.map((a) => a.id).sort()).toEqual(
      expectedIds(rows, { types: TYPES_B2 }).sort()
    );
    expect(delivered.some((a) => a.isPostable === false)).toBe(true);
    expect(delivered.some((a) => a.isPostable === true)).toBe(true);
  });

  it("FixedAssetList recibe EXACTAMENTE las mismas cuentas (segundo mapeo)", async () => {
    const delivered = await deliveredToList();
    expect(delivered.map((a) => a.id).sort()).toEqual(
      expectedIds(rows, { types: TYPES_B2 }).sort()
    );
    expect(delivered.some((a) => a.isPostable === false)).toBe(true);
  });

  it("las cuentas de Pasivo (títulos y movimiento) llegan a los dos componentes: la contrapartida puede ser una CxP", async () => {
    for (const delivered of [await deliveredToForm(), await deliveredToList()]) {
      const liabilities = delivered.filter((a) => a.type === "LIABILITY");
      expect(liabilities.some((a) => a.isPostable === true)).toBe(true);
      expect(liabilities.some((a) => a.isPostable === false)).toBe(true);
    }
  });

  it.each([
    ["FixedAssetFormPanel", deliveredToForm],
    ["FixedAssetList", deliveredToList],
  ])(
    "%s: cada cuenta que viaja al cliente lleva SOLO {id, code, name, type, isPostable}",
    async (_name, deliver) => {
      const delivered = await deliver();
      expectKeysWithin(delivered, ["id", "code", "name", "type", "isPostable"]);
      for (const account of delivered) {
        expect(Object.keys(account).sort()).toEqual(["code", "id", "isPostable", "name", "type"]);
      }
    }
  );

  it.each([
    ["FixedAssetFormPanel", deliveredToForm],
    ["FixedAssetList", deliveredToList],
  ])(
    "%s: isPostable viaja con su valor real (títulos false, movimiento true)",
    async (_name, deliver) => {
      const delivered = await deliver();
      for (const original of rows.filter(
        (r) => r.companyId === COMPANY_ID && r.deletedAt === null && TYPES_B2.includes(r.type)
      )) {
        expect(delivered).toContainEqual(
          expect.objectContaining({
            id: original.id,
            code: original.code,
            name: original.name,
            type: original.type,
            isPostable: original.isPostable,
          })
        );
      }
    }
  );

  it("sigue entregando companyId, las tasas INPC y las cuentas de IVA configuradas", async () => {
    findManyRates.mockResolvedValue([
      { year: 2026, month: 8, indexValue: { toString: () => "1500.12" } },
    ]);
    const tree = await renderPage();
    const list = findAll(tree, FixedAssetList)[0].props as Record<string, unknown>;
    expect(list.companyId).toBe(COMPANY_ID);
    expect(list.inpcRates).toEqual([{ year: 2026, month: 8, indexValue: "1500.12" }]);
    expect(list.ivaDFAccountId).toBe("iva-df");
    expect(list.ivaCFAccountId).toBe("iva-cf");
    expect((findAll(tree, FixedAssetFormPanel)[0].props as Record<string, unknown>).companyId).toBe(
      COMPANY_ID
    );
  });

  it("sin sesión redirige antes de leer las cuentas", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("un usuario que no es miembro de la empresa es redirigido antes de leer las cuentas", async () => {
    findFirstMember.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(findMany).not.toHaveBeenCalled();
  });
});
