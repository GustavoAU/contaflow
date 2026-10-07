// @vitest-environment jsdom
// src/modules/inventory/__tests__/InventoryItemList.accounts.test.tsx
//
// SPEC-012 · ENTREGA B3 · paso 1 — GUARDA VERDE: `InventoryItemList` solo PROPAGA `accounts` al formulario de
// edición en línea (`InventoryItemForm`); no tiene un selector de cuenta propio. B3 solo cambia el TIPO de
// esa prop (`isPostable: boolean` obligatorio), así que lo que hay que proteger es que la lista:
//   · entregue al formulario las cuentas TAL CUAL las recibe (títulos incluidos, con su `isPostable`): si la
//     lista filtrara o remapeara las cuentas, el combobox del formulario no vería los encabezados o trataría
//     todo como título;
//   · entregue las cuentas guardadas del ítem SIN corregirlas (la alerta de Q4 del formulario las necesita
//     tal como están guardadas, aunque sean un título o ya no existan).
//
// El formulario se sustituye por un stub que registra sus props. El menú «Acciones del producto» es el
// DropdownMenu de Radix: se abre con el teclado (Enter en el disparador), porque jsdom no tiene PointerEvent.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { InventoryItemList, type InventoryItemRow } from "../components/InventoryItemList";
import { stubJsdomForListbox } from "@/__tests__/helpers/account-combobox-forms";
import { A_INV_MERC, E_COSTO, ITEM_ACCOUNTS, T_EXISTENCIAS } from "./helpers/inventory-plan";

const { formProps } = vi.hoisted(() => ({ formProps: [] as Array<Record<string, unknown>> }));

vi.mock("../components/InventoryItemForm", () => ({
  InventoryItemForm: (props: Record<string, unknown>) => {
    formProps.push(props);
    return null;
  },
}));
vi.mock("../components/ItemMovementHistory", () => ({ ItemMovementHistory: () => null }));
vi.mock("../components/UomManager", () => ({ UomManager: () => null }));
vi.mock("../actions/inventory-operations.actions", () => ({
  softDeleteInventoryItemAction: vi.fn(),
  getItemMovementsAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const COMPANY_ID = "company-1";

const ROW: InventoryItemRow = {
  id: "item-1",
  sku: "SKU-001",
  name: "Harina de trigo",
  description: null,
  unit: "kg",
  stockQuantity: "10",
  averageCost: "5",
  itemType: "GOODS",
  defaultTaxRate: "GENERAL",
  minimumStock: null,
  accountId: A_INV_MERC.id,
  cogsAccountId: E_COSTO.id,
  accountCode: A_INV_MERC.code,
  accountName: A_INV_MERC.name,
};

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  formProps.length = 0;
});

afterEach(cleanup);

function openEditor(row: InventoryItemRow) {
  render(
    <InventoryItemList
      items={[row]}
      companyId={COMPANY_ID}
      accounts={[...ITEM_ACCOUNTS]}
      canEdit
      canDelete={false}
    />
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "Acciones del producto" }), {
    key: "Enter",
  });
  fireEvent.click(screen.getByRole("menuitem", { name: /Editar producto/ }));
}

describe("InventoryItemList — propaga las cuentas al formulario de edición (SPEC-012 B3)", () => {
  it("sin editar, el formulario no está montado", () => {
    render(
      <InventoryItemList
        items={[ROW]}
        companyId={COMPANY_ID}
        accounts={[...ITEM_ACCOUNTS]}
        canEdit
        canDelete={false}
      />
    );
    expect(formProps).toHaveLength(0);
  });

  it("«Editar producto» monta el formulario con las cuentas TAL CUAL llegan: títulos incluidos y con su isPostable", () => {
    openEditor(ROW);
    const props = formProps.at(-1);
    expect(props, "el formulario de edición no se montó").toBeDefined();
    expect(props!.companyId).toBe(COMPANY_ID);
    expect(props!.accounts).toEqual(ITEM_ACCOUNTS);
    const accounts = props!.accounts as Array<{ isPostable: boolean }>;
    expect(accounts.some((a) => a.isPostable === false)).toBe(true);
    expect(accounts.some((a) => a.isPostable === true)).toBe(true);
  });

  it("entrega las cuentas guardadas del ítem sin corregirlas, aunque sean un título", () => {
    openEditor({
      ...ROW,
      accountId: T_EXISTENCIAS.id,
      cogsAccountId: "id-de-una-cuenta-eliminada",
    });
    const item = formProps.at(-1)!.item as Record<string, unknown>;
    expect(item).toMatchObject({
      id: "item-1",
      sku: "SKU-001",
      itemType: "GOODS",
      accountId: T_EXISTENCIAS.id,
      cogsAccountId: "id-de-una-cuenta-eliminada",
    });
  });
});
