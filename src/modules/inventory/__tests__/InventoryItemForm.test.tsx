// @vitest-environment jsdom
// src/modules/inventory/__tests__/InventoryItemForm.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Lo que sigue en rojo FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase.
//
// SPEC-012 · ENTREGA B3 · paso 1 (modo RED) — alta y edición de ítems de inventario (`InventoryItemForm`):
// los DOS selectores de cuenta (`accountId` de Activo y `cogsAccountId` de Gasto) pasan del <select> nativo
// (`FormData` + `defaultValue`, sin estado) a `AccountCombobox` con ESTADO (D6):
//   · OBLIGATORIOS solo si el ítem es físico (Mercancía, Materia prima, Producto terminado); un Servicio no
//     muestra selectores ni alerta y envía `null` en las dos cuentas;
//   · cada uno ofrece las cuentas de SU tipo (Activo / Gasto) con sus títulos como encabezados NO elegibles;
//   · sin `required` nativo: se valida al enviar con `isSelectableAccountId`, en alta y en edición; nunca se
//     llama a la acción con un valor no elegible;
//   · Q4 (solo EDICIÓN de un ítem físico): si una cuenta guardada es un título, ya no existe o no es de su
//     tipo, `SavedAccountsAlert` la lista con los rótulos «Cuenta de inventario (Activo)» y «Cuenta de costo
//     de ventas (Gasto)», «Guardar cambios» queda deshabilitado (con `aria-describedby` hacia la alerta) y el
//     `submit` retorna sin llamar a la acción. El combobox muestra el campo vacío con `aria-invalid` (D1);
//   · el resto del payload (SKU, nombre, descripción, stock mínimo, alícuota, tipo) NO cambia.
//
// Lo que el contrato NO fija y aquí se comprueba de forma tolerante (declarado en el reporte): el texto de la
// etiqueta VISIBLE de cada campo (hoy «Cuenta de inventario (ASSET)» / «Cuenta COGS (EXPENSE)») y el texto
// del error de «sin cuenta» al enviar. Las guardas VERDES a propósito (no tocan el combobox) fijan lo que no
// cambia: Servicio, payloads, acción que falla, `aria-busy`, Cancelar y los campos prellenados.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";

import { InventoryItemForm } from "../components/InventoryItemForm";
import {
  accessibleNames,
  accountComboboxes,
  accountErrorShown,
  expectAccountComboboxes,
  expectAlertListing,
  expectBlockedByAlert,
  expectNoSavedAccountsAlert,
  labelOf,
  listedOptionLabels,
  movementLabels,
  ofType,
  openList,
  pickByCode,
  pressEveryHeader,
  savedAccountsAlerts,
  snapshotTexts,
  stubJsdomForListbox,
  visibleHeaderNames,
  type PlanAccount,
} from "@/__tests__/helpers/account-combobox-forms";
import {
  ALL_TITLE_NAMES,
  A_CAJA,
  A_INV_MERC,
  A_INV_MP,
  E_COSTO,
  E_MERMAS,
  INV_PLAN,
  ITEM_ACCOUNTS,
  T_EXISTENCIAS,
  T_OPERATIVOS,
  titleNamesOf,
  without,
} from "./helpers/inventory-plan";

const { createInventoryItemAction, updateInventoryItemAction, toastError } = vi.hoisted(() => ({
  createInventoryItemAction: vi.fn(),
  updateInventoryItemAction: vi.fn(),
  toastError: vi.fn(),
}));

// El formulario hoy muestra los errores en su banner; si el ui-agent usa `toast.error` para el aviso de «sin
// cuenta» (como los formularios de B1), `accountErrorShown` lo acepta igual.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: toastError }, Toaster: () => null }));

vi.mock("../actions/inventory-operations.actions", () => ({
  createInventoryItemAction,
  updateInventoryItemAction,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────

const COMPANY_ID = "company-1";
/** Rótulos con los que la alerta de Q4 nombra a cada campo (decisión 2 de B3). */
const LBL_INV = "Cuenta de inventario (Activo)";
const LBL_COGS = "Cuenta de costo de ventas (Gasto)";

type ItemProp = NonNullable<ComponentProps<typeof InventoryItemForm>["item"]>;

/** Un ítem físico ya guardado, con las dos cuentas válidas. */
const EXISTING: ItemProp = {
  id: "item-1",
  sku: "PROD-001",
  name: "Harina de trigo",
  description: "Harina de trigo 1 kg",
  itemType: "GOODS",
  defaultTaxRate: "REDUCED",
  minimumStock: "5.0000",
  accountId: A_INV_MERC.id,
  cogsAccountId: E_COSTO.id,
};

const ASSET_POOL = ofType(ITEM_ACCOUNTS, "ASSET");
const EXPENSE_POOL = ofType(ITEM_ACCOUNTS, "EXPENSE");
const ASSET_TITLES = titleNamesOf(ASSET_POOL);
const EXPENSE_TITLES = titleNamesOf(EXPENSE_POOL);

const onSuccess = vi.fn();
const onCancel = vi.fn();

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  createInventoryItemAction.mockResolvedValue({ success: true, data: "item-nuevo" });
  updateInventoryItemAction.mockResolvedValue({ success: true, data: "item-1" });
});

afterEach(cleanup);

// ─── Helpers de render ───────────────────────────────────────────────────────────────────────────

function ui(accounts: readonly PlanAccount[], item?: ItemProp) {
  return (
    <InventoryItemForm
      companyId={COMPANY_ID}
      accounts={[...accounts]}
      item={item}
      onSuccess={onSuccess}
      onCancel={onCancel}
    />
  );
}

/** Alta de un ítem (sin `item`). */
function mountNew(accounts: readonly PlanAccount[] = ITEM_ACCOUNTS) {
  const utils = render(ui(accounts));
  return { ...utils, refresh: (next: readonly PlanAccount[]) => utils.rerender(ui(next)) };
}

/** Edición de un ítem ya guardado (`EXISTING` con los cambios de `overrides`). */
function mountEdit(
  overrides: Partial<ItemProp> = {},
  accounts: readonly PlanAccount[] = ITEM_ACCOUNTS
) {
  const item: ItemProp = { ...EXISTING, ...overrides };
  const utils = render(ui(accounts, item));
  return {
    ...utils,
    item,
    refresh: (next: readonly PlanAccount[]) => utils.rerender(ui(next, item)),
  };
}

/** Los dos combobox, en el orden del formulario: inventario (Activo) y costo (Gasto). */
function fields() {
  const inputs = expectAccountComboboxes(2, "InventoryItemForm (producto físico)");
  return { inventory: inputs[0], cogs: inputs[1] };
}

const submitBtn = () =>
  screen.getByRole("button", { name: /Crear producto|Creando|Guardar cambios|Guardando/ });
const form = () => document.querySelector("form") as HTMLFormElement;
const typeButton = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label}`) });
const field = (name: string) => document.querySelector(`[name="${name}"]`) as HTMLInputElement;
const taxSelect = () => document.querySelector("select") as HTMLSelectElement;
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

function fillBasics(sku = "PROD-001", name = "Harina de trigo") {
  fireEvent.change(field("sku"), { target: { value: sku } });
  fireEvent.change(field("name"), { target: { value: name } });
}

const asTitle = (a: PlanAccount): PlanAccount => ({ ...a, isPostable: false });
const withTitle = (list: readonly PlanAccount[], target: PlanAccount) =>
  list.map((a) => (a.id === target.id ? asTitle(a) : a));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("InventoryItemForm — los dos selectores de cuenta son AccountCombobox, no <select> (SPEC-012 B3)", () => {
  it("producto físico (alta): hay DOS <input role=combobox>; el único <select> que queda es el de la alícuota IVA", () => {
    mountNew();
    fields();
    expect(document.querySelector('select[name="accountId"]')).toBeNull();
    expect(document.querySelector('select[name="cogsAccountId"]')).toBeNull();
    expect(document.querySelectorAll("select")).toHaveLength(1);
    expect(taxSelect().value).toBe("GENERAL");
  });

  it("D9: cada combobox tiene un nombre accesible propio (inventario / costo) y los dos son distintos", () => {
    mountNew();
    fields();
    const names = accessibleNames();
    expect(names).toHaveLength(2);
    expect(names.every((name) => name.trim() !== "")).toBe(true);
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toMatch(/inventario/i);
    expect(names[1]).toMatch(/costo|COGS/i);
  });

  it("sin `required` nativo (el combobox no lo lleva; el formulario valida al enviar)", () => {
    mountNew();
    fields();
    for (const input of accountComboboxes()) expect(input.required).toBe(false);
  });

  it("alta: los dos nacen VACÍOS y sin marcar como inválidos (nada se autoselecciona)", () => {
    mountNew();
    const { inventory, cogs } = fields();
    for (const input of [inventory, cogs]) {
      expect(input.value).toBe("");
      expect(input.getAttribute("aria-invalid")).not.toBe("true");
    }
  });

  it("el de inventario ofrece SOLO cuentas de Activo, con los títulos de Activo como encabezados", () => {
    mountNew();
    const { inventory } = fields();
    openList(inventory);
    expect(listedOptionLabels()).toEqual(movementLabels(ASSET_POOL));
    expect(visibleHeaderNames(ALL_TITLE_NAMES)).toEqual(ASSET_TITLES);
  });

  it("el de costo ofrece SOLO cuentas de Gasto, con los títulos de Gasto como encabezados", () => {
    mountNew();
    const { cogs } = fields();
    openList(cogs);
    expect(listedOptionLabels()).toEqual(movementLabels(EXPENSE_POOL));
    expect(visibleHeaderNames(ALL_TITLE_NAMES)).toEqual(EXPENSE_TITLES);
  });

  it("aunque reciba TODO el plan, cada uno filtra por su tipo: Pasivo y Patrimonio no se ofrecen en ninguno", () => {
    mountNew(INV_PLAN);
    const { inventory, cogs } = fields();
    openList(inventory);
    expect(listedOptionLabels()).toEqual(movementLabels(ofType(INV_PLAN, "ASSET")));
    expect(visibleHeaderNames(ALL_TITLE_NAMES)).toEqual(titleNamesOf(ofType(INV_PLAN, "ASSET")));
    fireEvent.blur(inventory);
    openList(cogs);
    expect(listedOptionLabels()).toEqual(movementLabels(ofType(INV_PLAN, "EXPENSE")));
    expect(visibleHeaderNames(ALL_TITLE_NAMES)).toEqual(titleNamesOf(ofType(INV_PLAN, "EXPENSE")));
  });

  it("se busca por nombre: «materia» deja Inventario de Materia Prima y el de costo ofrece las suyas por separado", () => {
    mountNew();
    const { inventory, cogs } = fields();
    openList(inventory);
    fireEvent.change(inventory, { target: { value: "materia" } });
    expect(listedOptionLabels()).toEqual([labelOf(A_INV_MP)]);
    fireEvent.blur(inventory);
    openList(cogs);
    fireEvent.change(cogs, { target: { value: "mermas" } });
    expect(listedOptionLabels()).toEqual([labelOf(E_MERMAS)]);
  });

  it("un producto de tipo Servicio NO muestra selectores de cuenta (los combobox desaparecen)", () => {
    mountNew();
    fields();
    fireEvent.click(typeButton("Servicio"));
    expect(accountComboboxes()).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("InventoryItemForm — los títulos NO se pueden elegir ni se autoseleccionan (CA-9 / RN-19)", () => {
  it("clic en los encabezados no elige nada: los dos campos siguen vacíos y crear NO llama a la acción", async () => {
    mountNew();
    fillBasics();
    const { inventory, cogs } = fields();
    pressEveryHeader(inventory, ASSET_TITLES);
    fireEvent.blur(inventory);
    pressEveryHeader(cogs, EXPENSE_TITLES);
    fireEvent.blur(cogs);
    expect(inventory.value).toBe("");
    expect(cogs.value).toBe("");
    fireEvent.submit(form());
    await flush();
    expect(createInventoryItemAction).not.toHaveBeenCalled();
  });

  it("con SOLO títulos de Activo el campo de inventario no es utilizable y el producto no se puede crear", async () => {
    mountNew([...ASSET_POOL.filter((a) => !a.isPostable), ...EXPENSE_POOL]);
    fillBasics();
    const { inventory, cogs } = fields();
    expect(inventory.disabled).toBe(true);
    expect(cogs.disabled).toBe(false);
    pickByCode(cogs, E_COSTO.code);
    fireEvent.submit(form());
    await flush();
    expect(createInventoryItemAction).not.toHaveBeenCalled();
  });

  it("con SOLO títulos de Gasto el campo de costo no es utilizable y el producto no se puede crear", async () => {
    mountNew([...ASSET_POOL, ...EXPENSE_POOL.filter((a) => !a.isPostable)]);
    fillBasics();
    const { inventory, cogs } = fields();
    expect(cogs.disabled).toBe(true);
    pickByCode(inventory, A_INV_MERC.code);
    fireEvent.submit(form());
    await flush();
    expect(createInventoryItemAction).not.toHaveBeenCalled();
  });

  it("un pool con un título y UNA sola cuenta de movimiento ofrece esa cuenta, pero NO la autoselecciona", () => {
    mountNew([T_EXISTENCIAS, A_INV_MERC, T_OPERATIVOS, E_COSTO]);
    const { inventory, cogs } = fields();
    expect(inventory.value).toBe("");
    expect(cogs.value).toBe("");
    openList(inventory);
    expect(listedOptionLabels()).toEqual([labelOf(A_INV_MERC)]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("InventoryItemForm — alta de un producto físico (el payload NO cambia)", () => {
  it("elegir las dos cuentas (código + Enter) y crear envía EXACTAMENTE el payload de siempre", async () => {
    mountNew();
    fillBasics("PROD-001", "Harina de trigo");
    const { inventory, cogs } = fields();
    pickByCode(inventory, "1.1.03.01.001");
    pickByCode(cogs, "510101001");
    expect(inventory.value).toBe(labelOf(A_INV_MERC));
    expect(cogs.value).toBe(labelOf(E_COSTO));
    fireEvent.click(submitBtn());
    await waitFor(() => expect(createInventoryItemAction).toHaveBeenCalledTimes(1));
    expect(createInventoryItemAction).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      sku: "PROD-001",
      name: "Harina de trigo",
      description: null,
      itemType: "GOODS",
      defaultTaxRate: "GENERAL",
      minimumStock: null,
      accountId: A_INV_MERC.id,
      cogsAccountId: E_COSTO.id,
    });
    expect(updateInventoryItemAction).not.toHaveBeenCalled();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("tipo, alícuota, descripción y stock mínimo se conservan en el payload", async () => {
    mountNew();
    fireEvent.click(typeButton("Materia prima"));
    fillBasics("MP-009", "Azúcar refinada");
    fireEvent.change(field("description"), { target: { value: "Saco de 50 kg" } });
    fireEvent.change(field("minimumStock"), { target: { value: "12.5" } });
    fireEvent.change(taxSelect(), { target: { value: "EXEMPT" } });
    const { inventory, cogs } = fields();
    pickByCode(inventory, A_INV_MP.code);
    pickByCode(cogs, E_MERMAS.code);
    fireEvent.click(submitBtn());
    await waitFor(() => expect(createInventoryItemAction).toHaveBeenCalledTimes(1));
    expect(createInventoryItemAction).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      sku: "MP-009",
      name: "Azúcar refinada",
      description: "Saco de 50 kg",
      itemType: "RAW_MATERIAL",
      defaultTaxRate: "EXEMPT",
      minimumStock: 12.5,
      accountId: A_INV_MP.id,
      cogsAccountId: E_MERMAS.id,
    });
  });

  it("cambiar la alícuota o el tipo DESPUÉS de elegir las cuentas no las pierde (D6: estado, no FormData)", async () => {
    mountNew();
    const { inventory, cogs } = fields();
    pickByCode(inventory, A_INV_MERC.code);
    pickByCode(cogs, E_COSTO.code);
    fireEvent.change(taxSelect(), { target: { value: "LUXURY" } });
    fireEvent.click(typeButton("Producto terminado"));
    const after = fields();
    expect(after.inventory.value).toBe(labelOf(A_INV_MERC));
    expect(after.cogs.value).toBe(labelOf(E_COSTO));
    fillBasics();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(createInventoryItemAction).toHaveBeenCalledTimes(1));
    expect(createInventoryItemAction.mock.calls[0][0]).toMatchObject({
      itemType: "FINISHED_GOOD",
      defaultTaxRate: "LUXURY",
      accountId: A_INV_MERC.id,
      cogsAccountId: E_COSTO.id,
    });
  });

  it("sin ninguna cuenta elegida: NO llama a la acción y avisa de la cuenta (ya no hay `required` nativo)", async () => {
    mountNew();
    fillBasics();
    fields();
    const before = snapshotTexts();
    fireEvent.submit(form());
    await flush();
    expect(createInventoryItemAction).not.toHaveBeenCalled();
    expect(accountErrorShown(before, toastError)).toBe(true);
  });

  it.each([
    { caso: "solo la de inventario", pick: "inventory" as const },
    { caso: "solo la de costo", pick: "cogs" as const },
  ])("con UNA sola cuenta elegida ($caso) tampoco crea y avisa", async ({ pick }) => {
    mountNew();
    fillBasics();
    const { inventory, cogs } = fields();
    if (pick === "inventory") pickByCode(inventory, A_INV_MERC.code);
    else pickByCode(cogs, E_COSTO.code);
    const before = snapshotTexts();
    fireEvent.submit(form());
    await flush();
    expect(createInventoryItemAction).not.toHaveBeenCalled();
    expect(accountErrorShown(before, toastError)).toBe(true);
  });

  it("D1: una cuenta elegida que deja de ser elegible (la lista se refresca y pasa a ser título) se ve vacía y NO se envía", async () => {
    const { refresh } = mountNew();
    fillBasics();
    const { inventory, cogs } = fields();
    pickByCode(inventory, A_INV_MERC.code);
    pickByCode(cogs, E_COSTO.code);
    refresh(withTitle(ITEM_ACCOUNTS, A_INV_MERC));
    expect(inventory.value).toBe("");
    expect(cogs.value).toBe(labelOf(E_COSTO));
    fireEvent.submit(form());
    await flush();
    expect(createInventoryItemAction).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("InventoryItemForm — Servicio: sin selectores ni alerta, las dos cuentas viajan null (guardas)", () => {
  it("alta de un Servicio: crear envía accountId y cogsAccountId = null y el resto del payload", async () => {
    mountNew();
    fireEvent.click(typeButton("Servicio"));
    fillBasics("SRV-001", "Asesoría contable");
    fireEvent.click(submitBtn());
    await waitFor(() => expect(createInventoryItemAction).toHaveBeenCalledTimes(1));
    expect(createInventoryItemAction).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      sku: "SRV-001",
      name: "Asesoría contable",
      description: null,
      itemType: "SERVICE",
      defaultTaxRate: "GENERAL",
      minimumStock: null,
      accountId: null,
      cogsAccountId: null,
    });
  });

  it("pasar a Servicio DESPUÉS de elegir las cuentas no las envía: viajan null", async () => {
    mountNew();
    const { inventory, cogs } = fields();
    pickByCode(inventory, A_INV_MERC.code);
    pickByCode(cogs, E_COSTO.code);
    fireEvent.click(typeButton("Servicio"));
    fillBasics("SRV-002", "Mantenimiento");
    fireEvent.click(submitBtn());
    await waitFor(() => expect(createInventoryItemAction).toHaveBeenCalledTimes(1));
    expect(createInventoryItemAction.mock.calls[0][0]).toMatchObject({
      itemType: "SERVICE",
      accountId: null,
      cogsAccountId: null,
    });
  });

  it("editar un Servicio cuyas cuentas guardadas son un título o no existen: SIN selectores, SIN alerta, guardar habilitado y envía null", async () => {
    mountEdit({
      itemType: "SERVICE",
      minimumStock: null,
      accountId: T_EXISTENCIAS.id,
      cogsAccountId: "id-de-una-cuenta-eliminada",
    });
    expect(accountComboboxes()).toHaveLength(0);
    expect(savedAccountsAlerts()).toHaveLength(0);
    expect(submitBtn().hasAttribute("disabled")).toBe(false);
    fireEvent.click(submitBtn());
    await waitFor(() => expect(updateInventoryItemAction).toHaveBeenCalledTimes(1));
    expect(updateInventoryItemAction.mock.calls[0][0]).toMatchObject({
      itemId: "item-1",
      itemType: "SERVICE",
      accountId: null,
      cogsAccountId: null,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("InventoryItemForm — edición de un producto físico", () => {
  it("las cuentas guardadas se muestran como «código — nombre», sin alerta, y «Guardar cambios» está habilitado", () => {
    mountEdit();
    const { inventory, cogs } = fields();
    expect(inventory.value).toBe(labelOf(A_INV_MERC));
    expect(cogs.value).toBe(labelOf(E_COSTO));
    expect(inventory.getAttribute("aria-invalid")).not.toBe("true");
    expect(cogs.getAttribute("aria-invalid")).not.toBe("true");
    expect(submitBtn().textContent).toBe("Guardar cambios");
    expectNoSavedAccountsAlert(submitBtn());
  });

  it("guardar sin tocar nada envía EXACTAMENTE el payload de actualización con las cuentas guardadas", async () => {
    mountEdit();
    fields();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(updateInventoryItemAction).toHaveBeenCalledTimes(1));
    expect(updateInventoryItemAction).toHaveBeenCalledWith({
      itemId: "item-1",
      companyId: COMPANY_ID,
      sku: "PROD-001",
      name: "Harina de trigo",
      description: "Harina de trigo 1 kg",
      itemType: "GOODS",
      defaultTaxRate: "REDUCED",
      minimumStock: 5,
      accountId: A_INV_MERC.id,
      cogsAccountId: E_COSTO.id,
    });
    expect(createInventoryItemAction).not.toHaveBeenCalled();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("cambiar las dos cuentas antes de guardar envía las nuevas", async () => {
    mountEdit();
    const { inventory, cogs } = fields();
    pickByCode(inventory, A_INV_MP.code);
    pickByCode(cogs, E_MERMAS.code);
    expect(inventory.value).toBe(labelOf(A_INV_MP));
    fireEvent.click(submitBtn());
    await waitFor(() => expect(updateInventoryItemAction).toHaveBeenCalledTimes(1));
    expect(updateInventoryItemAction.mock.calls[0][0]).toMatchObject({
      accountId: A_INV_MP.id,
      cogsAccountId: E_MERMAS.id,
    });
  });

  it("edición: una cuenta de movimiento de OTRO tipo que no es la del campo (Gasto en el de Activo) es un problema", () => {
    mountEdit({ accountId: E_COSTO.id });
    expectAlertListing([LBL_INV], [LBL_COGS]);
  });

  it("los demás campos vienen prellenados y los botones Guardar / Cancelar funcionan (guarda)", () => {
    mountEdit();
    expect(field("sku").value).toBe("PROD-001");
    expect(field("name").value).toBe("Harina de trigo");
    expect(field("description").value).toBe("Harina de trigo 1 kg");
    expect(field("minimumStock").value).toBe("5");
    expect(taxSelect().value).toBe("REDUCED");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Q4 — la cuenta guardada del ítem es un título, ya no existe o no es del tipo del campo.
describe("InventoryItemForm — Q4: alerta que BLOQUEA el guardado (cuenta guardada no elegible)", () => {
  it("una cuenta de TÍTULO guardada como inventario: alerta desde el primer render que lista SOLO ese campo", () => {
    mountEdit({ accountId: T_EXISTENCIAS.id });
    expectAlertListing([LBL_INV], [LBL_COGS]);
    expect(savedAccountsAlerts()).toHaveLength(1);
  });

  it("el campo del título queda VACÍO e inválido; el otro conserva su cuenta y no es inválido", () => {
    mountEdit({ accountId: T_EXISTENCIAS.id });
    const { inventory, cogs } = fields();
    expect(inventory.value).toBe("");
    expect(inventory.getAttribute("aria-invalid")).toBe("true");
    expect(cogs.value).toBe(labelOf(E_COSTO));
    expect(cogs.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("«Guardar cambios» queda DESHABILITADO y su descripción accesible apunta a la alerta", () => {
    mountEdit({ accountId: T_EXISTENCIAS.id });
    expectBlockedByAlert(submitBtn(), LBL_INV);
  });

  it("el `submit` retorna SIN llamar a la acción (el botón deshabilitado no es la única barrera)", async () => {
    mountEdit({ accountId: T_EXISTENCIAS.id });
    fireEvent.submit(form());
    await flush();
    expect(updateInventoryItemAction).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("hacer clic en el botón deshabilitado tampoco llama a la acción", async () => {
    mountEdit({ cogsAccountId: T_OPERATIVOS.id });
    fireEvent.click(submitBtn());
    await flush();
    expect(updateInventoryItemAction).not.toHaveBeenCalled();
  });

  it("un título de Gasto guardado como costo: la alerta lista el rótulo del campo de costo y no el de inventario", () => {
    mountEdit({ cogsAccountId: T_OPERATIVOS.id });
    expectAlertListing([LBL_COGS], [LBL_INV]);
    const { inventory, cogs } = fields();
    expect(cogs.value).toBe("");
    expect(cogs.getAttribute("aria-invalid")).toBe("true");
    expect(inventory.value).toBe(labelOf(A_INV_MERC));
    expectBlockedByAlert(submitBtn(), LBL_COGS);
  });

  it("una cuenta que YA NO EXISTE (id ausente de la lista): misma alerta", () => {
    mountEdit({ accountId: "id-de-una-cuenta-eliminada" });
    expectAlertListing([LBL_INV], [LBL_COGS]);
    const { inventory } = fields();
    expect(inventory.value).toBe("");
    expect(inventory.getAttribute("aria-invalid")).toBe("true");
    expectBlockedByAlert(submitBtn(), LBL_INV);
  });

  it("una cuenta de movimiento que NO es del tipo del campo (Activo guardado como costo) también es un problema", () => {
    mountEdit({ cogsAccountId: A_CAJA.id });
    expectAlertListing([LBL_COGS], [LBL_INV]);
    expectBlockedByAlert(submitBtn(), LBL_COGS);
  });

  it("las DOS cuentas con problema: UNA alerta que lista ambos rótulos", () => {
    mountEdit({ accountId: T_EXISTENCIAS.id, cogsAccountId: "no-existe" });
    expectAlertListing([LBL_INV, LBL_COGS]);
    expect(savedAccountsAlerts()).toHaveLength(1);
  });

  it("reemplazar la cuenta del título por una de movimiento hace DESAPARECER la alerta y permite guardar", async () => {
    mountEdit({ accountId: T_EXISTENCIAS.id });
    const { inventory } = fields();
    pickByCode(inventory, A_INV_MP.code);
    expect(inventory.value).toBe(labelOf(A_INV_MP));
    expect(inventory.getAttribute("aria-invalid")).not.toBe("true");
    expectNoSavedAccountsAlert(submitBtn());
    fireEvent.click(submitBtn());
    await waitFor(() => expect(updateInventoryItemAction).toHaveBeenCalledTimes(1));
    expect(updateInventoryItemAction.mock.calls[0][0]).toMatchObject({
      accountId: A_INV_MP.id,
      cogsAccountId: E_COSTO.id,
    });
  });

  it("con dos problemas, arreglar UNO deja la alerta con el otro y el botón sigue bloqueado", () => {
    mountEdit({ accountId: T_EXISTENCIAS.id, cogsAccountId: T_OPERATIVOS.id });
    const { inventory } = fields();
    pickByCode(inventory, A_INV_MERC.code);
    expectAlertListing([LBL_COGS], [LBL_INV]);
    expect(submitBtn().hasAttribute("disabled")).toBe(true);
  });

  it("con dos problemas, arreglar LOS DOS retira la alerta y se puede guardar", async () => {
    mountEdit({ accountId: "no-existe", cogsAccountId: T_OPERATIVOS.id });
    const { inventory, cogs } = fields();
    pickByCode(inventory, A_INV_MERC.code);
    pickByCode(cogs, E_MERMAS.code);
    expectNoSavedAccountsAlert(submitBtn());
    fireEvent.click(submitBtn());
    await waitFor(() => expect(updateInventoryItemAction).toHaveBeenCalledTimes(1));
    expect(updateInventoryItemAction.mock.calls[0][0]).toMatchObject({
      accountId: A_INV_MERC.id,
      cogsAccountId: E_MERMAS.id,
    });
  });

  it("clic sobre los encabezados NO arregla el problema: la alerta sigue y el botón también", () => {
    mountEdit({ accountId: T_EXISTENCIAS.id });
    const { inventory } = fields();
    pressEveryHeader(inventory, ASSET_TITLES);
    fireEvent.blur(inventory);
    expect(inventory.value).toBe("");
    expectAlertListing([LBL_INV]);
    expect(submitBtn().hasAttribute("disabled")).toBe(true);
  });

  it("un ítem físico SIN cuentas guardadas (null) NO dispara la alerta: «sin configurar» no es un problema", () => {
    mountEdit({ accountId: null, cogsAccountId: null });
    expectNoSavedAccountsAlert(submitBtn());
  });

  it("…pero sin cuentas elegidas tampoco se guarda: la acción no se llama y se avisa de la cuenta", async () => {
    mountEdit({ accountId: null, cogsAccountId: null });
    const before = snapshotTexts();
    fireEvent.submit(form());
    await flush();
    expect(updateInventoryItemAction).not.toHaveBeenCalled();
    expect(accountErrorShown(before, toastError)).toBe(true);
  });

  it("la alerta usa los valores ACTUALES: si tras refrescar la lista una cuenta elegida pasa a ser título, aparece", () => {
    const { refresh } = mountEdit();
    expectNoSavedAccountsAlert(submitBtn());
    refresh(withTitle(ITEM_ACCOUNTS, A_INV_MERC));
    expectAlertListing([LBL_INV], [LBL_COGS]);
    expect(submitBtn().hasAttribute("disabled")).toBe(true);
    const { inventory } = fields();
    expect(inventory.value).toBe("");
    expect(inventory.getAttribute("aria-invalid")).toBe("true");
  });

  it("…y si esa cuenta DESAPARECE de la lista, también; al volver a ser elegible la alerta se retira sola", () => {
    const { refresh } = mountEdit();
    refresh(without(ITEM_ACCOUNTS, E_COSTO));
    expectAlertListing([LBL_COGS], [LBL_INV]);
    refresh(ITEM_ACCOUNTS);
    expectNoSavedAccountsAlert(submitBtn());
  });

  it("OTRAS cuentas que pasan a título o desaparecen NO activan la alerta", () => {
    const { refresh } = mountEdit();
    refresh(without(withTitle(ITEM_ACCOUNTS, A_INV_MP), A_CAJA));
    expectNoSavedAccountsAlert(submitBtn());
  });

  it("pasar el ítem a Servicio retira la alerta (los servicios no llevan cuentas), habilita guardar y envía null", async () => {
    mountEdit({ accountId: T_EXISTENCIAS.id, cogsAccountId: "no-existe" });
    expectAlertListing([LBL_INV, LBL_COGS]);
    fireEvent.click(typeButton("Servicio"));
    expect(savedAccountsAlerts()).toHaveLength(0);
    expect(accountComboboxes()).toHaveLength(0);
    expect(submitBtn().hasAttribute("disabled")).toBe(false);
    fireEvent.click(submitBtn());
    await waitFor(() => expect(updateInventoryItemAction).toHaveBeenCalledTimes(1));
    expect(updateInventoryItemAction.mock.calls[0][0]).toMatchObject({
      itemType: "SERVICE",
      accountId: null,
      cogsAccountId: null,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("InventoryItemForm — error de la acción y botón fiscal (guardas)", () => {
  it("si la acción falla muestra su error, no llama a onSuccess y el formulario conserva lo escrito", async () => {
    createInventoryItemAction.mockResolvedValue({ success: false, error: "El SKU ya existe." });
    mountNew();
    fireEvent.click(typeButton("Servicio"));
    fillBasics("SRV-001", "Asesoría");
    fireEvent.click(submitBtn());
    expect(await screen.findByText("El SKU ya existe.")).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(field("sku").value).toBe("SRV-001");
  });

  it("mientras la acción está en vuelo el botón queda deshabilitado, con aria-busy y «Creando...»", async () => {
    let release!: (value: unknown) => void;
    createInventoryItemAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    mountNew();
    fireEvent.click(typeButton("Servicio"));
    fillBasics();
    expect(submitBtn().getAttribute("aria-busy")).toBe("false");
    fireEvent.click(submitBtn());
    await waitFor(() => expect(submitBtn().textContent).toContain("Creando..."));
    expect(submitBtn().hasAttribute("disabled")).toBe(true);
    expect(submitBtn().getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      release({ success: true, data: "item-nuevo" });
    });
    await waitFor(() => expect(submitBtn().textContent).toBe("Crear producto"));
    expect(submitBtn().getAttribute("aria-busy")).toBe("false");
  });

  it("en edición el botón dice «Guardando...» mientras la acción responde", async () => {
    let release!: (value: unknown) => void;
    updateInventoryItemAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    mountEdit({ itemType: "SERVICE", minimumStock: null });
    fireEvent.click(submitBtn());
    await waitFor(() => expect(submitBtn().textContent).toContain("Guardando..."));
    expect(submitBtn().getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      release({ success: true, data: "item-1" });
    });
    await waitFor(() => expect(submitBtn().textContent).toBe("Guardar cambios"));
  });
});
