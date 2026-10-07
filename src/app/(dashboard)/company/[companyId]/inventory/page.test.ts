// src/app/(dashboard)/company/[companyId]/inventory/page.test.ts
//
// SPEC-012 · ENTREGA B3 · CA-19 (modo RED) — la página de inventario alimenta a TRES consumidores de
// cuenta (`InventoryItemForm` y `InventoryItemList` en «Catálogo»; `MovementForm` en «Movimientos») con UNA
// consulta `prisma.account.findMany`:
//   · la consulta deja de filtrar `isPostable: true` y CONSERVA `companyId`, `deletedAt: null` y el filtro por
//     tipo (ASSET, EXPENSE, LIABILITY, EQUITY);
//   · su `select` pide `isPostable` (sin él el combobox trataría todo como título y no habría nada elegible)
//     y `requiresThirdParty` (SPEC-007 / ADR-054: MovementForm no ofrece como contrapartida las cuentas que
//     exigen tercero);
//   · lo que viaja a MovementForm lleva `{id, code, name, type, requiresThirdParty, isPostable}`; lo que viaja a
//     `InventoryItemForm`/`InventoryItemList` es lo mismo SIN Patrimonio (un producto no puede usar una cuenta
//     de Patrimonio como inventario ni como costo);
//   · solo se consultan cuentas en las pestañas `catalogo` y `movimientos`.
//
// Es una página de servidor (async): se invoca como función y se inspecciona el árbol de elementos que
// devuelve, sin renderizarlo. La consulta se evalúa contra una BD en memoria con varias empresas, cuentas
// eliminadas y columnas de más (ver `account-page-data.ts`): un `where` incompleto se nota.

import { beforeEach, describe, expect, it, vi } from "vitest";

import InventoryPage from "./page";
import { InventoryItemForm } from "@/modules/inventory/components/InventoryItemForm";
import { InventoryItemList } from "@/modules/inventory/components/InventoryItemList";
import { MovementForm } from "@/modules/inventory/components/MovementForm";
import {
  getDraftMovements,
  getInventoryItems,
} from "@/modules/inventory/services/InventoryOperationsService";
import { getInventoryValuation } from "@/modules/inventory/services/InventoryAccountingService";
import { InventoryReportService } from "@/modules/inventory/services/InventoryReportService";
import { ExchangeRateService } from "@/modules/exchange-rates/services/ExchangeRateService";
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

const { findMany, findFirstMember, countMovements } = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirstMember: vi.fn(),
  countMovements: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    account: { findMany },
    companyMember: { findFirst: findFirstMember },
    inventoryMovement: { count: countMovements },
  };
  return { prisma, default: prisma };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/modules/inventory/services/InventoryOperationsService", () => ({
  getInventoryItems: vi.fn(),
  getDraftMovements: vi.fn(),
}));
vi.mock("@/modules/inventory/services/InventoryAccountingService", () => ({
  getInventoryValuation: vi.fn(),
}));
vi.mock("@/modules/inventory/services/InventoryReportService", () => ({
  InventoryReportService: { getStockSummary: vi.fn() },
}));
vi.mock("@/modules/exchange-rates/services/ExchangeRateService", () => ({
  ExchangeRateService: { getLatestRate: vi.fn() },
}));
vi.mock("@/modules/inventory/components/InventoryItemList", () => ({
  InventoryItemList: function InventoryItemList() {
    return null;
  },
}));
vi.mock("@/modules/inventory/components/InventoryItemForm", () => ({
  InventoryItemForm: function InventoryItemForm() {
    return null;
  },
}));
vi.mock("@/modules/inventory/components/MovementForm", () => ({
  MovementForm: function MovementForm() {
    return null;
  },
}));
vi.mock("@/modules/inventory/components/PendingMovementsList", () => ({
  PendingMovementsList: function PendingMovementsList() {
    return null;
  },
}));
vi.mock("@/modules/inventory/components/InventoryValuation", () => ({
  InventoryValuation: function InventoryValuation() {
    return null;
  },
}));
vi.mock("@/modules/inventory/components/InventoryReportsView", () => ({
  InventoryReportsView: function InventoryReportsView() {
    return null;
  },
}));
vi.mock("@/components/ui/SearchParamTabs", () => ({
  SearchParamTabs: function SearchParamTabs() {
    return null;
  },
}));

/** Los cuatro tipos que la página consulta (EQUITY solo es para la contrapartida de MovementForm). */
const TYPES = ["ASSET", "EXPENSE", "LIABILITY", "EQUITY"];
/** Lo que reciben los formularios de PRODUCTO: lo mismo sin Patrimonio. */
const ITEM_TYPES = ["ASSET", "EXPENSE", "LIABILITY"];
/** `seedAccounts()` trae `PASIVO Dos` (2.1.01.01.002): aquí es la cuenta que exige tercero (ADR-054). */
const THIRD_PARTY_ID = `${COMPANY_ID}:m:2.1.01.01.002`;

const rows = seedAccounts().map((row) => ({
  ...row,
  requiresThirdParty: row.id === THIRD_PARTY_ID,
}));

const ITEM_ROW = {
  id: "item-1",
  sku: "SKU-1",
  name: "Harina de trigo",
  description: null,
  baseUnitName: "kg",
  stockQuantity: { toString: () => "10" },
  averageCost: { toString: () => "5" },
  itemType: "GOODS",
  defaultTaxRate: "GENERAL",
  minimumStock: null,
  accountId: "company-1:m:1.1.01.01.001",
  cogsAccountId: "company-1:m:5.1.01.01.001",
  account: { code: "1.1.01.01.001", name: "ACTIVO Uno" },
};

async function renderPage(tab?: string) {
  return InventoryPage({
    params: Promise.resolve({ companyId: COMPANY_ID }),
    searchParams: Promise.resolve({ tab }),
  });
}

async function queryArgs(tab?: string) {
  await renderPage(tab);
  expect(findMany).toHaveBeenCalledTimes(1);
  return findMany.mock.calls[0][0] as {
    where: Record<string, unknown>;
    select?: Record<string, unknown>;
    orderBy?: unknown;
  };
}

type Delivered = Record<string, unknown>[];

async function deliveredToItemForm(): Promise<Delivered> {
  const forms = findAll(await renderPage("catalogo"), InventoryItemForm);
  expect(forms).toHaveLength(1);
  return (forms[0].props as { accounts: Delivered }).accounts;
}

async function deliveredToItemList(): Promise<Delivered> {
  const lists = findAll(await renderPage("catalogo"), InventoryItemList);
  expect(lists).toHaveLength(1);
  return (lists[0].props as { accounts: Delivered }).accounts;
}

async function deliveredToMovementForm(): Promise<Delivered> {
  const forms = findAll(await renderPage("movimientos"), MovementForm);
  expect(forms).toHaveLength(1);
  return (forms[0].props as { counterpartAccounts: Delivered }).counterpartAccounts;
}

const idsOf = (delivered: Delivered) => delivered.map((a) => a.id as string).sort();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
  findFirstMember.mockResolvedValue({ role: "ADMIN", company: { name: "Empresa Uno C.A." } });
  countMovements.mockResolvedValue(0);
  findMany.mockImplementation(createSeededDb(rows).findMany);
  vi.mocked(getInventoryItems).mockResolvedValue([ITEM_ROW] as never);
  vi.mocked(getDraftMovements).mockResolvedValue([] as never);
  vi.mocked(getInventoryValuation).mockResolvedValue({
    items: [],
    totalValue: { toString: () => "0" },
  } as never);
  vi.mocked(InventoryReportService.getStockSummary).mockResolvedValue([] as never);
  vi.mocked(ExchangeRateService.getLatestRate).mockResolvedValue({
    rate: { toString: () => "36.5" },
  } as never);
});

describe("InventoryPage — títulos y cuentas para los formularios de inventario (SPEC-012 B3, CA-19)", () => {
  it.each([["catalogo"], ["movimientos"]])(
    "pestaña %s: la consulta NO filtra isPostable y conserva companyId y deletedAt: null",
    async (tab) => {
      const args = await queryArgs(tab);
      expectWhereKeepsScope(args.where);
    }
  );

  it("el filtro por tipo conserva ASSET, EXPENSE, LIABILITY y EQUITY (ni más ni menos)", async () => {
    const args = await queryArgs("catalogo");
    const type = args.where.type as { in?: string[] } | undefined;
    expect(type?.in, "el where debe filtrar por `type: { in: [...] }`").toBeDefined();
    expect([...(type?.in ?? [])].sort()).toEqual([...TYPES].sort());
  });

  it("el where tiene EXACTAMENTE tres claves: companyId, deletedAt y type", async () => {
    const args = await queryArgs("catalogo");
    expect(Object.keys(args.where).sort()).toEqual(["companyId", "deletedAt", "type"]);
  });

  it("conserva el orden por código", async () => {
    const args = await queryArgs("catalogo");
    expect(args.orderBy).toEqual([{ code: "asc" }]);
  });

  it("el select pide isPostable (sin él el combobox trataría todo como título) y requiresThirdParty, y nada de más", async () => {
    const args = await queryArgs("catalogo");
    expectSelectKeys(args.select, [
      "id",
      "code",
      "name",
      "type",
      "requiresThirdParty",
      "isPostable",
    ]);
  });

  it("InventoryItemForm recibe los títulos Y las cuentas de movimiento de Activo, Gasto y Pasivo (no las eliminadas ni las de otra empresa)", async () => {
    const delivered = await deliveredToItemForm();
    expect(idsOf(delivered)).toEqual(expectedIds(rows, { types: ITEM_TYPES }).sort());
    expect(delivered.some((a) => a.isPostable === false)).toBe(true);
    expect(delivered.some((a) => a.isPostable === true)).toBe(true);
  });

  it("InventoryItemList recibe EXACTAMENTE las mismas cuentas que el formulario de alta", async () => {
    const delivered = await deliveredToItemList();
    expect(idsOf(delivered)).toEqual(expectedIds(rows, { types: ITEM_TYPES }).sort());
    expect(delivered.some((a) => a.isPostable === false)).toBe(true);
    expect(idsOf(delivered)).toEqual(idsOf(await deliveredToItemForm()));
  });

  it.each([
    ["InventoryItemForm", deliveredToItemForm],
    ["InventoryItemList", deliveredToItemList],
  ])(
    "%s: NO recibe Patrimonio (ni títulos ni cuentas) — un producto no puede usarlo como inventario ni como costo",
    async (_name, deliver) => {
      const delivered = await deliver();
      expect(delivered.filter((a) => a.type === "EQUITY")).toEqual([]);
      expect(delivered.filter((a) => a.type === "REVENUE")).toEqual([]);
    }
  );

  it("MovementForm recibe los títulos Y las cuentas de movimiento de los CUATRO tipos (incluido Patrimonio)", async () => {
    const delivered = await deliveredToMovementForm();
    expect(idsOf(delivered)).toEqual(expectedIds(rows, { types: TYPES }).sort());
    for (const type of TYPES) {
      const ofType = delivered.filter((a) => a.type === type);
      expect(
        ofType.some((a) => a.isPostable === true),
        `${type}: sin cuentas de movimiento`
      ).toBe(true);
      expect(
        ofType.some((a) => a.isPostable === false),
        `${type}: sin títulos`
      ).toBe(true);
    }
    expect(delivered.filter((a) => a.type === "REVENUE")).toEqual([]);
  });

  it("MovementForm: cada cuenta que viaja al cliente lleva SOLO {id, code, name, type, requiresThirdParty, isPostable}", async () => {
    const delivered = await deliveredToMovementForm();
    expectKeysWithin(delivered, ["id", "code", "name", "type", "requiresThirdParty", "isPostable"]);
  });

  it.each([
    ["InventoryItemForm", deliveredToItemForm],
    ["InventoryItemList", deliveredToItemList],
  ])(
    "%s: cada cuenta lleva {id, code, name, type, isPostable} (requiresThirdParty es opcional) y nada de más",
    async (_name, deliver) => {
      const delivered = await deliver();
      expectKeysWithin(
        delivered,
        ["id", "code", "name", "type", "isPostable"],
        ["requiresThirdParty"]
      );
    }
  );

  it.each([
    ["InventoryItemForm", deliveredToItemForm],
    ["InventoryItemList", deliveredToItemList],
    ["MovementForm", deliveredToMovementForm],
  ])(
    "%s: isPostable viaja con su valor real (títulos false, movimiento true)",
    async (_name, deliver) => {
      const delivered = await deliver();
      expect(delivered.length).toBeGreaterThan(0);
      for (const account of delivered) {
        const original = rows.find((r) => r.id === account.id && r.deletedAt === null);
        expect(original, `la cuenta ${String(account.id)} no existe en la BD`).toBeDefined();
        expect(account).toMatchObject({
          code: original!.code,
          name: original!.name,
          type: original!.type,
          isPostable: original!.isPostable,
        });
      }
    }
  );

  it("MovementForm: requiresThirdParty viaja con su valor real (solo la cuenta que exige tercero lo trae en true)", async () => {
    const delivered = await deliveredToMovementForm();
    const flagged = delivered.filter((a) => a.requiresThirdParty === true).map((a) => a.id);
    expect(flagged).toEqual([THIRD_PARTY_ID]);
    expect(delivered.filter((a) => a.requiresThirdParty === false)).toHaveLength(
      delivered.length - 1
    );
  });

  it("el producto de la lista conserva la cuenta de inventario que MovementForm excluye de la contrapartida (SPEC-007)", async () => {
    const forms = findAll(await renderPage("movimientos"), MovementForm);
    const items = (forms[0].props as { items: Record<string, unknown>[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "item-1", accountId: ITEM_ROW.accountId });
  });
});

describe("InventoryPage — solo consulta cuentas donde hay un formulario que las usa", () => {
  it.each([[undefined], ["catalogo"], ["movimientos"], ["una-pestana-inexistente"]])(
    "pestaña %s: consulta las cuentas UNA vez",
    async (tab) => {
      await renderPage(tab);
      expect(findMany).toHaveBeenCalledTimes(1);
    }
  );

  it.each([["valoracion"], ["reportes"]])("pestaña %s: NO consulta cuentas", async (tab) => {
    await renderPage(tab);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("sin sesión redirige antes de leer las cuentas", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    await expect(renderPage("catalogo")).rejects.toThrow("NEXT_REDIRECT");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("un usuario que no es miembro de la empresa es redirigido antes de leer las cuentas", async () => {
    findFirstMember.mockResolvedValue(null);
    await expect(renderPage("catalogo")).rejects.toThrow("NEXT_REDIRECT");
    expect(findMany).not.toHaveBeenCalled();
  });
});
