// @vitest-environment jsdom
// src/modules/inventory/__tests__/InventoryItemForm.decisions.test.tsx
//
// SPEC-012 B3 · paso 4 (mutantes, test-agent): decisiones de `InventoryItemForm` que los tests del paso 1
// dejaron sin un test dirigido y que los mutantes reales delataron (revalidación del campo de COSTO contra
// la lista vigente, y la alerta Q4 que NO existe en el alta). Archivo aparte, pequeño; reutiliza los helpers.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

import { InventoryItemForm } from "../components/InventoryItemForm";
import {
  expectAccountComboboxes,
  expectNoSavedAccountsAlert,
  labelOf,
  newTextsSince,
  pickByCode,
  snapshotTexts,
  stubJsdomForListbox,
  type PlanAccount,
} from "@/__tests__/helpers/account-combobox-forms";
import { A_INV_MERC, E_COSTO, ITEM_ACCOUNTS } from "./helpers/inventory-plan";

const { createInventoryItemAction, updateInventoryItemAction } = vi.hoisted(() => ({
  createInventoryItemAction: vi.fn(),
  updateInventoryItemAction: vi.fn(),
}));

vi.mock("../actions/inventory-operations.actions", () => ({
  createInventoryItemAction,
  updateInventoryItemAction,
}));

type ItemProp = NonNullable<ComponentProps<typeof InventoryItemForm>["item"]>;
const EXISTING: ItemProp = {
  id: "item-1",
  sku: "PROD-001",
  name: "Harina de trigo",
  description: null,
  itemType: "GOODS",
  defaultTaxRate: "GENERAL",
  minimumStock: "0",
  accountId: A_INV_MERC.id,
  cogsAccountId: E_COSTO.id,
};

const ui = (accounts: readonly PlanAccount[], item?: ItemProp) => (
  <InventoryItemForm companyId="company-1" accounts={[...accounts]} item={item} />
);
const asTitle = (a: PlanAccount): PlanAccount => ({ ...a, isPostable: false });
const withTitle = (list: readonly PlanAccount[], target: PlanAccount) =>
  list.map((a) => (a.id === target.id ? asTitle(a) : a));
const form = () => document.querySelector("form") as HTMLFormElement;
const submitBtn = () => screen.getByRole("button", { name: /Crear producto/ });
const field = (name: string) => document.querySelector(`[name="${name}"]`) as HTMLInputElement;
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

function mountNewWithBoth() {
  const utils = render(ui(ITEM_ACCOUNTS));
  fireEvent.change(field("sku"), { target: { value: "PROD-9" } });
  fireEvent.change(field("name"), { target: { value: "Harina" } });
  const [inventory, cogs] = expectAccountComboboxes(2, "InventoryItemForm (alta)");
  pickByCode(inventory, A_INV_MERC.code);
  pickByCode(cogs, E_COSTO.code);
  return { inventory, cogs, refresh: (next: readonly PlanAccount[]) => utils.rerender(ui(next)) };
}

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  createInventoryItemAction.mockResolvedValue({ success: true, data: "item-nuevo" });
  updateInventoryItemAction.mockResolvedValue({ success: true, data: "item-1" });
});

afterEach(cleanup);

describe("InventoryItemForm — el campo de COSTO también se revalida contra la lista vigente (D1)", () => {
  it("una cuenta de costo elegida que pasa a ser título se ve vacía y NO se envía (aunque la de inventario siga válida)", async () => {
    const { inventory, cogs, refresh } = mountNewWithBoth();
    refresh(withTitle(ITEM_ACCOUNTS, E_COSTO));
    expect(cogs.value).toBe("");
    expect(inventory.value).toBe(labelOf(A_INV_MERC));
    fireEvent.submit(form());
    await flush();
    expect(createInventoryItemAction).not.toHaveBeenCalled();
  });

  it("…y al volver a ser elegible (lista restaurada) el alta se envía con las DOS cuentas", async () => {
    const { refresh } = mountNewWithBoth();
    refresh(withTitle(ITEM_ACCOUNTS, E_COSTO));
    refresh(ITEM_ACCOUNTS);
    fireEvent.submit(form());
    await flush();
    expect(createInventoryItemAction).toHaveBeenCalledTimes(1);
    expect(createInventoryItemAction.mock.calls[0][0]).toMatchObject({
      accountId: A_INV_MERC.id,
      cogsAccountId: E_COSTO.id,
    });
  });
});

describe("InventoryItemForm — la alerta Q4 NO existe en el alta (decisión 7)", () => {
  it.each([
    { caso: "la de inventario", target: A_INV_MERC },
    { caso: "la de costo", target: E_COSTO },
  ])(
    "alta: si $caso pasa a ser título tras elegirla no hay alerta ni se bloquea el botón; el campo solo se ve vacío",
    ({ target }) => {
      const { refresh } = mountNewWithBoth();
      refresh(withTitle(ITEM_ACCOUNTS, target));
      expectNoSavedAccountsAlert(submitBtn());
    }
  );
});

describe("InventoryItemForm — Q4: el submit bloqueado retorna EN SILENCIO (la alerta es la única guía)", () => {
  it("edición con la cuenta de inventario guardada como título: el submit no llama a la acción ni agrega banner ni mensajes de campo", async () => {
    render(ui(withTitle(ITEM_ACCOUNTS, A_INV_MERC), EXISTING));
    const before = snapshotTexts();
    fireEvent.submit(form());
    await flush();
    expect(updateInventoryItemAction).not.toHaveBeenCalled();
    expect(newTextsSince(before)).toEqual([]);
  });
});

describe("InventoryItemForm — el banner de error (role=alert, decisión 8) nombra las cuentas que faltan", () => {
  const MSG = "Selecciona una cuenta de movimiento para:";
  const LBL_INV = "Cuenta de inventario (Activo)";
  const LBL_COGS = "Cuenta de costo de ventas (Gasto)";

  function mountBasics() {
    render(ui(ITEM_ACCOUNTS));
    fireEvent.change(field("sku"), { target: { value: "PROD-9" } });
    fireEvent.change(field("name"), { target: { value: "Harina" } });
    return expectAccountComboboxes(2, "InventoryItemForm (alta)");
  }

  it("sin ninguna cuenta: UN role=alert que lista las dos etiquetas, en ese orden", async () => {
    mountBasics();
    fireEvent.submit(form());
    await flush();
    expect(screen.getByRole("alert").textContent).toBe(`${MSG} ${LBL_INV}, ${LBL_COGS}.`);
    expect(createInventoryItemAction).not.toHaveBeenCalled();
  });

  it("solo falta la de costo: el aviso nombra SOLO el campo de costo", async () => {
    const [inventory] = mountBasics();
    pickByCode(inventory, A_INV_MERC.code);
    fireEvent.submit(form());
    await flush();
    expect(screen.getByRole("alert").textContent).toBe(`${MSG} ${LBL_COGS}.`);
  });

  it("solo falta la de inventario: el aviso nombra SOLO el campo de inventario", async () => {
    const [, cogs] = mountBasics();
    pickByCode(cogs, E_COSTO.code);
    fireEvent.submit(form());
    await flush();
    expect(screen.getByRole("alert").textContent).toBe(`${MSG} ${LBL_INV}.`);
  });

  it("si la acción devuelve un error de negocio, se anuncia en un role=alert", async () => {
    const [inventory, cogs] = mountBasics();
    pickByCode(inventory, A_INV_MERC.code);
    pickByCode(cogs, E_COSTO.code);
    createInventoryItemAction.mockResolvedValue({
      success: false,
      error: "Ya existe un producto con ese SKU.",
    });
    fireEvent.submit(form());
    await flush();
    expect(screen.getByRole("alert").textContent).toBe("Ya existe un producto con ese SKU.");
  });
});
