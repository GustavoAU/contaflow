// src/app/(dashboard)/company/[companyId]/inflation/page.test.ts
//
// SPEC-012 · ENTREGA B1 · CA-19 y RN-19 (modo RED) — la página de ajuste por inflación hace DOS
// consultas de cuentas (Patrimonio para la cuenta actualizadora; Ingreso/Gasto para el REPOMO). Las dos
// dejan de filtrar `isPostable: true` y CONSERVAN `companyId`, su filtro de tipo
// (`EQUITY` y `REVENUE | EXPENSE`) y `deletedAt: null`; sus `select` incluyen `isPostable`; lo que
// viaja al cliente son SOLO `{id, code, name, type?, isPostable}`.
//
// RN-19: el aviso «No hay cuentas de Patrimonio (EQUITY) disponibles…» y la decisión de mostrar el panel
// cuentan SOLO cuentas de movimiento: con una lista que trae únicamente títulos el panel NO se monta.

import { beforeEach, describe, expect, it, vi } from "vitest";

import InflationPage from "./page";
import { InflationAdjustmentPanel } from "@/modules/inflation/components/InflationAdjustmentPanel";
import { INPCService } from "@/modules/inflation/services/INPCService";
import { requireCompanyPage } from "@/lib/company-page-guard";
import { collectText, findAll } from "@/__tests__/helpers/react-tree";
import {
  COMPANY_ID,
  createSeededDb,
  expectKeysWithin,
  expectSelectKeys,
  expectWhereKeepsScope,
  expectedIds,
  seedAccounts,
} from "@/__tests__/helpers/account-page-data";
import type { AccountRow } from "@/__tests__/helpers/in-memory-account-db";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => {
  const prisma = { account: { findMany } };
  return { prisma, default: prisma };
});
vi.mock("@/lib/company-page-guard", () => ({ requireCompanyPage: vi.fn() }));
vi.mock("@/modules/inflation/services/INPCService", () => ({
  INPCService: { getRates: vi.fn() },
}));
vi.mock("@/modules/inflation/components/INPCRateForm", () => ({
  INPCRateForm: function INPCRateForm() {
    return null;
  },
}));
vi.mock("@/modules/inflation/components/INPCRateTable", () => ({
  INPCRateTable: function INPCRateTable() {
    return null;
  },
}));
vi.mock("@/modules/inflation/components/InflationBaseForm", () => ({
  InflationBaseForm: function InflationBaseForm() {
    return null;
  },
}));
vi.mock("@/modules/inflation/components/InflationAdjustmentPanel", () => ({
  InflationAdjustmentPanel: function InflationAdjustmentPanel() {
    return null;
  },
}));

const rows = seedAccounts();
const EQUITY_WARNING = "No hay cuentas de Patrimonio (EQUITY) disponibles";

type WhereArg = { where: Record<string, unknown>; select?: Record<string, unknown> };

async function renderPage(data: AccountRow[] = rows, role = "ADMIN") {
  findMany.mockImplementation(createSeededDb(data).findMany);
  vi.mocked(requireCompanyPage).mockResolvedValue({
    company: { id: COMPANY_ID, name: "Empresa", inflationBaseYear: 2024, inflationBaseMonth: 1 },
    role,
    userId: "user-1",
  } as never);
  return InflationPage({ params: Promise.resolve({ companyId: COMPANY_ID }) });
}

/** Las dos consultas, identificadas por su filtro de tipo. */
function queries() {
  const calls = findMany.mock.calls.map((c) => c[0] as WhereArg);
  expect(calls).toHaveLength(2);
  const equity = calls.find((c) => c.where.type === "EQUITY");
  const repomo = calls.find((c) => typeof c.where.type === "object" && c.where.type !== null);
  expect(equity, "falta la consulta de Patrimonio").toBeDefined();
  expect(repomo, "falta la consulta de Ingreso/Gasto").toBeDefined();
  return { equity: equity as WhereArg, repomo: repomo as WhereArg };
}

async function panelProps(data: AccountRow[] = rows) {
  const tree = await renderPage(data);
  const panels = findAll(tree, InflationAdjustmentPanel);
  expect(panels).toHaveLength(1);
  return panels[0].props as {
    equityAccounts: Record<string, unknown>[];
    repomoAccounts: Record<string, unknown>[];
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(INPCService.getRates).mockResolvedValue([] as never);
});

describe("InflationPage — Patrimonio: títulos y cuentas para el selector buscable (SPEC-012 B1, CA-19)", () => {
  it("la consulta de Patrimonio NO filtra isPostable y conserva companyId, deletedAt: null y el tipo", async () => {
    await renderPage();
    const { equity } = queries();
    expectWhereKeepsScope(equity.where);
    expect(equity.where).toEqual({ companyId: COMPANY_ID, type: "EQUITY", deletedAt: null });
  });

  it("el select de Patrimonio pide isPostable y nada de más", async () => {
    await renderPage();
    expectSelectKeys(queries().equity.select, ["id", "code", "name", "isPostable"], ["type"]);
  });

  it("el panel recibe los títulos Y las cuentas de movimiento de Patrimonio (no las eliminadas ni las de otra empresa)", async () => {
    const { equityAccounts } = await panelProps();
    expect(equityAccounts.map((a) => a.id).sort()).toEqual(
      expectedIds(rows, { types: ["EQUITY"] }).sort()
    );
    expect(equityAccounts.some((a) => a.isPostable === false)).toBe(true);
    expect(equityAccounts.some((a) => a.isPostable === true)).toBe(true);
  });

  it("cada cuenta de Patrimonio que viaja al cliente lleva SOLO {id, code, name, type?, isPostable}", async () => {
    const { equityAccounts } = await panelProps();
    expectKeysWithin(equityAccounts, ["id", "code", "name", "isPostable"], ["type"]);
  });
});

describe("InflationPage — REPOMO: títulos y cuentas para el selector buscable (SPEC-012 B1, CA-19)", () => {
  it("la consulta de REPOMO NO filtra isPostable y conserva companyId, deletedAt: null y REVENUE | EXPENSE", async () => {
    await renderPage();
    const { repomo } = queries();
    expectWhereKeepsScope(repomo.where);
    expect(repomo.where).toEqual({
      companyId: COMPANY_ID,
      type: { in: ["REVENUE", "EXPENSE"] },
      deletedAt: null,
    });
  });

  it("el select de REPOMO pide isPostable y nada de más", async () => {
    await renderPage();
    expectSelectKeys(queries().repomo.select, ["id", "code", "name", "isPostable"], ["type"]);
  });

  it("el panel recibe los títulos Y las cuentas de movimiento de Ingreso y Gasto", async () => {
    const { repomoAccounts } = await panelProps();
    expect(repomoAccounts.map((a) => a.id).sort()).toEqual(
      expectedIds(rows, { types: ["REVENUE", "EXPENSE"] }).sort()
    );
    expect(repomoAccounts.some((a) => a.isPostable === false)).toBe(true);
    expect(repomoAccounts.some((a) => a.isPostable === true)).toBe(true);
  });

  it("cada cuenta de REPOMO que viaja al cliente lleva SOLO {id, code, name, type?, isPostable}", async () => {
    const { repomoAccounts } = await panelProps();
    expectKeysWithin(repomoAccounts, ["id", "code", "name", "isPostable"], ["type"]);
  });

  it("isPostable viaja con su valor real en las dos listas", async () => {
    const { equityAccounts, repomoAccounts } = await panelProps();
    const sent = [...equityAccounts, ...repomoAccounts];
    for (const original of rows.filter(
      (r) =>
        r.companyId === COMPANY_ID &&
        r.deletedAt === null &&
        ["EQUITY", "REVENUE", "EXPENSE"].includes(r.type)
    )) {
      expect(sent).toContainEqual(
        expect.objectContaining({ id: original.id, isPostable: original.isPostable })
      );
    }
  });
});

describe("InflationPage — RN-19: el aviso de Patrimonio cuenta solo cuentas de movimiento", () => {
  const onlyEquityTitles = rows.filter((r) => !(r.type === "EQUITY" && r.isPostable));
  const noEquityAtAll = rows.filter((r) => r.type !== "EQUITY");

  it("con cuentas de Patrimonio de movimiento: se monta el panel y NO hay aviso", async () => {
    const tree = await renderPage();
    expect(findAll(tree, InflationAdjustmentPanel)).toHaveLength(1);
    expect(collectText(tree).join(" ")).not.toContain(EQUITY_WARNING);
  });

  it("con SOLO títulos de Patrimonio (ninguna cuenta de movimiento): aviso visible y el panel NO se monta", async () => {
    const tree = await renderPage(onlyEquityTitles);
    expect(collectText(tree).join(" ")).toContain(EQUITY_WARNING);
    expect(findAll(tree, InflationAdjustmentPanel)).toHaveLength(0);
  });

  it("sin ninguna cuenta de Patrimonio: aviso visible y el panel NO se monta", async () => {
    const tree = await renderPage(noEquityAtAll);
    expect(collectText(tree).join(" ")).toContain(EQUITY_WARNING);
    expect(findAll(tree, InflationAdjustmentPanel)).toHaveLength(0);
  });

  it("una sola cuenta de movimiento de Patrimonio entre muchos títulos basta para montar el panel", async () => {
    const oneAccount = rows.filter(
      (r) => !(r.type === "EQUITY" && r.isPostable && !r.code.endsWith("001"))
    );
    const tree = await renderPage(oneAccount);
    expect(findAll(tree, InflationAdjustmentPanel)).toHaveLength(1);
    expect(collectText(tree).join(" ")).not.toContain(EQUITY_WARNING);
  });

  it("un rol que no es ADMIN no ve el panel ni el aviso (comportamiento previo)", async () => {
    const tree = await renderPage(rows, "ACCOUNTANT");
    expect(findAll(tree, InflationAdjustmentPanel)).toHaveLength(0);
    expect(collectText(tree).join(" ")).not.toContain(EQUITY_WARNING);
  });
});
