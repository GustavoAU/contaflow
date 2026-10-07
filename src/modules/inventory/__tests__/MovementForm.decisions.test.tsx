// @vitest-environment jsdom
// src/modules/inventory/__tests__/MovementForm.decisions.test.tsx
//
// SPEC-012 B3 · paso 4 (mutantes, test-agent): las decisiones 5 y 6 de la sesión principal, que el paso 1 dejó
// «sin test todavía»:
//   · 5: el filtro de «cuenta de inventario del producto» y el de `requiresThirdParty` se aplican SOLO a
//     cuentas de MOVIMIENTO; los TÍTULOS se filtran únicamente por tipo (para no perder el encabezado de las
//     cuentas elegibles que cuelgan de ellos);
//   · 6: AJUSTE con la lista vacía muestra un aviso con texto propio (Gasto / Mermas), distinto del de ENTRADA.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

import {
  listedOptionLabels,
  movementLabels,
  openList,
  stubJsdomForListbox,
  visibleHeaderNames,
} from "@/__tests__/helpers/account-combobox-forms";
import {
  COUNTERPART_EMPTY_MESSAGE,
  ITEMS,
  ITEM_SIN_CUENTA,
  chooseItem,
  chooseType,
  counterpart,
  mountForm,
} from "./helpers/movement-form-kit";
import {
  AJUSTE_ACCOUNTS,
  ENTRADA_ACCOUNTS,
  A_BANCO,
  INV_PLAN,
  T_EXISTENCIAS,
  T_POR_PAGAR,
} from "./helpers/inventory-plan";

vi.mock("../actions/inventory-operations.actions", () => ({ createMovementAction: vi.fn() }));
vi.mock("../actions/inventory-uom.actions", () => ({ listUomsAction: vi.fn() }));

import { listUomsAction } from "../actions/inventory-uom.actions";

const AJUSTE_EMPTY_MESSAGE =
  "No hay cuentas disponibles para la contrapartida. Cree en el Plan de Cuentas una cuenta de movimiento de Gasto (por ejemplo, Mermas).";

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listUomsAction).mockResolvedValue({ success: true, data: [] } as never);
});

afterEach(cleanup);

describe("MovementForm — los filtros de cuenta se aplican SOLO a cuentas de movimiento (decisión 5)", () => {
  it("ENTRADA: un producto cuya «cuenta de inventario» guardada es un TÍTULO no hace desaparecer ese encabezado ni excluye cuentas", async () => {
    const legado = { ...ITEM_SIN_CUENTA, id: "item-legado", accountId: T_EXISTENCIAS.id };
    mountForm({ items: [...ITEMS, legado] });
    await chooseItem(legado.id);
    openList(counterpart());
    expect(visibleHeaderNames(["EXISTENCIAS"])).toEqual(["EXISTENCIAS"]);
    expect(listedOptionLabels()).toEqual(movementLabels(ENTRADA_ACCOUNTS));
  });

  it("ENTRADA: un TÍTULO marcado requiresThirdParty sigue siendo encabezado de sus cuentas elegibles", () => {
    const plan = INV_PLAN.map((a) =>
      a.id === T_POR_PAGAR.id ? { ...a, requiresThirdParty: true } : a
    );
    mountForm({ counterpartAccounts: plan });
    openList(counterpart());
    expect(visibleHeaderNames(["POR PAGAR"])).toEqual(["POR PAGAR"]);
    expect(listedOptionLabels()).toEqual(movementLabels(ENTRADA_ACCOUNTS));
  });

  it("…y una CUENTA de movimiento marcada requiresThirdParty sí se excluye de ENTRADA y sí se ofrece en AJUSTE", () => {
    const plan = INV_PLAN.map((a) =>
      a.id === A_BANCO.id ? { ...a, requiresThirdParty: true } : a
    );
    mountForm({ counterpartAccounts: plan });
    openList(counterpart());
    expect(listedOptionLabels()).toEqual(
      movementLabels(ENTRADA_ACCOUNTS.filter((a) => a.id !== A_BANCO.id))
    );
    fireEvent.blur(counterpart());
    chooseType("Ajuste");
    openList(counterpart());
    expect(listedOptionLabels()).toEqual(movementLabels(AJUSTE_ACCOUNTS));
  });
});

describe("MovementForm — el aviso de lista vacía de AJUSTE tiene texto propio (decisión 6)", () => {
  const TITLES_ONLY = INV_PLAN.filter((a) => !a.isPostable);

  it("AJUSTE con SOLO títulos: avisa de crear una cuenta de Gasto (Mermas) y NO usa el texto de ENTRADA", () => {
    mountForm({ counterpartAccounts: TITLES_ONLY });
    chooseType("Ajuste");
    expect(screen.getByText(AJUSTE_EMPTY_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(COUNTERPART_EMPTY_MESSAGE)).toBeNull();
  });

  it("ENTRADA con SOLO títulos: el texto de ENTRADA y no el de AJUSTE", () => {
    mountForm({ counterpartAccounts: TITLES_ONLY });
    expect(screen.getByText(COUNTERPART_EMPTY_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(AJUSTE_EMPTY_MESSAGE)).toBeNull();
  });

  it("AJUSTE con cuentas elegibles: ningún aviso de lista vacía", () => {
    mountForm({ counterpartAccounts: [...INV_PLAN] });
    chooseType("Ajuste");
    expect(screen.queryByText(AJUSTE_EMPTY_MESSAGE)).toBeNull();
    expect(screen.queryByText(COUNTERPART_EMPTY_MESSAGE)).toBeNull();
  });

  it("un pool de SOLO Patrimonio: ENTRADA lo ofrece (sin aviso) y AJUSTE avisa con su texto", () => {
    const equityOnly = INV_PLAN.filter((a) => a.type === "EQUITY");
    mountForm({ counterpartAccounts: equityOnly });
    expect(screen.queryByText(COUNTERPART_EMPTY_MESSAGE)).toBeNull();
    chooseType("Ajuste");
    expect(screen.getByText(AJUSTE_EMPTY_MESSAGE)).toBeTruthy();
  });
});
