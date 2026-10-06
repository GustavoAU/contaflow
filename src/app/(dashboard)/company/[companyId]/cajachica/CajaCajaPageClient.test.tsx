// @vitest-environment jsdom
// src/app/(dashboard)/company/[companyId]/cajachica/CajaCajaPageClient.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase.
//
// SPEC-012 · ENTREGA B1 · paso 1 (modo RED) — «Nueva Caja Chica» (`CreateCajaForm`): el selector
// «Cuenta contable (Activo)» (`accountId`) pasa del <select> nativo a `AccountCombobox`.
//
// `accounts` entrega títulos Y cuentas de movimiento de TODOS los tipos (la página de caja chica ya
// no pide `onlyPostable`); el formulario filtra por tipo ASSET como hoy. RN-19: el aviso «No hay
// cuentas de tipo Activo…» y el campo deshabilitado cuentan SOLO cuentas de movimiento.
// El `required` nativo desaparece: sin cuenta, el formulario muestra su error SIN llamar a la acción.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CajaCajaPageClient } from "./CajaCajaPageClient";
import {
  PLAN,
  accessibleNames,
  accountErrorShown,
  expectAccountComboboxes,
  headerEl,
  listedOptionLabels,
  moveAcc,
  movementLabels,
  ofType,
  openList,
  pickByCode,
  pressEveryHeader,
  snapshotTexts,
  stubJsdomForListbox,
  titleAcc,
  typeInto,
  visibleHeaderNames,
  type PlanAccount,
} from "@/__tests__/helpers/account-combobox-forms";

const actions = vi.hoisted(() => ({
  listCajasCajasAction: vi.fn(),
  createCajaCajaAction: vi.fn(),
  closeCajaCajaAction: vi.fn(),
  reopenCajaCajaAction: vi.fn(),
  assignCustodianAction: vi.fn(),
  listMovementsAction: vi.fn(),
  listDepositsAction: vi.fn(),
  listReimbursementsAction: vi.fn(),
  createDepositAction: vi.fn(),
  createMovementAction: vi.fn(),
  createReimbursementAction: vi.fn(),
  approveMovementAction: vi.fn(),
  voidMovementAction: vi.fn(),
  voidDepositAction: vi.fn(),
  postReimbursementAction: vi.fn(),
  voidReimbursementAction: vi.fn(),
  exportCajaCajaCSVAction: vi.fn(),
  exportCajaCajaPDFAction: vi.fn(),
}));

vi.mock("@/modules/cajachica/actions/cajachica.actions", () => actions);
vi.mock("@clerk/nextjs", () => ({ useReverification: (fn: unknown) => fn }));
vi.mock("@clerk/nextjs/errors", () => ({ isReverificationCancelledError: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));

const COMPANY_ID = "company-1";
const EMPLOYEES = [
  { id: "emp-1", name: "María Pérez", status: "ACTIVE" },
  { id: "emp-2", name: "José Gómez", status: "ACTIVE" },
];
const CAJA_P = "m:1.1.01.01.001";
const CAJA_P_LABEL = "1.1.01.01.001 — Caja Principal";
const ASSET_LABELS = movementLabels(ofType(PLAN, "ASSET"));
const ASSET_WARNING = /No hay cuentas de tipo Activo/;

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  actions.listCajasCajasAction.mockResolvedValue({ success: true, data: [] });
  actions.createCajaCajaAction.mockResolvedValue({ success: true, data: { id: "caja-1" } });
});

afterEach(cleanup);

/** Monta la página (admin), espera la carga inicial y abre «Nueva caja». */
async function openCreateForm(accounts: PlanAccount[] = [...PLAN]) {
  render(
    <CajaCajaPageClient companyId={COMPANY_ID} accounts={accounts} employees={EMPLOYEES} isAdmin />
  );
  await waitFor(() => expect(actions.listCajasCajasAction).toHaveBeenCalledTimes(1));
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /Nueva caja/ }));
  return expectAccountComboboxes(1, "Nueva Caja Chica")[0];
}

/** Rellena todo lo que NO es la cuenta contable (nombre, custodio y saldo máximo). */
function fillRest() {
  fireEvent.change(document.getElementById("caja-name") as HTMLInputElement, {
    target: { value: "Caja Chica Operativa" },
  });
  fireEvent.change(document.getElementById("caja-custodian") as HTMLSelectElement, {
    target: { value: "emp-2" },
  });
  fireEvent.change(document.getElementById("caja-max") as HTMLInputElement, {
    target: { value: "5000,00" },
  });
}

const createButton = () => screen.getByRole("button", { name: "Crear Caja Chica" });

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CreateCajaForm — «Cuenta contable (Activo)» es un AccountCombobox (SPEC-012 B1)", () => {
  it("es un <input role=combobox>; el custodio y la moneda siguen siendo <select> nativos", async () => {
    const account = await openCreateForm();
    expect(account.tagName).toBe("INPUT");
    expect(document.querySelectorAll("select")).toHaveLength(2);
  });

  it("conserva su etiqueta asociada (htmlFor=caja-account) y un nombre accesible", async () => {
    const account = await openCreateForm();
    expect(account.id).toBe("caja-account");
    expect(screen.getByLabelText("Cuenta contable (Activo) *")).toBe(account);
    const names = accessibleNames();
    expect(names).toHaveLength(1);
    expect(names[0].trim()).not.toBe("");
  });

  it("el `required` nativo desaparece (la validación es del formulario)", async () => {
    expect((await openCreateForm()).required).toBe(false);
  });

  it("empieza vacío y sin marcar como inválido", async () => {
    const account = await openCreateForm();
    expect(account.value).toBe("");
    expect(account.getAttribute("aria-invalid")).not.toBe("true");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CreateCajaForm — qué se ofrece (el filtro por tipo ASSET se mantiene)", () => {
  it("SOLO cuentas de movimiento de tipo Activo, con los títulos de Activo como encabezados", async () => {
    const account = await openCreateForm();
    openList(account);
    expect(listedOptionLabels()).toEqual(ASSET_LABELS);
    expect(visibleHeaderNames()).toEqual(["ACTIVO", "CORRIENTE", "DISPONIBLE", "CAJAS", "BANCOS"]);
  });

  it("no se ofrece ninguna cuenta de Pasivo, Patrimonio, Ingreso ni Gasto (ni sus títulos)", async () => {
    const account = await openCreateForm();
    openList(account);
    const joined = listedOptionLabels().join("|");
    for (const absent of ["Retenciones", "Capital", "Ventas", "Gastos", "Papelería"]) {
      expect(joined).not.toContain(absent);
    }
    for (const name of ["PASIVO", "PATRIMONIO", "INGRESOS", "GASTOS"]) {
      expect(headerEl(name)).toBeNull();
    }
  });

  it("se puede buscar por nombre: «chica» deja Caja Chica bajo CAJAS", async () => {
    const account = await openCreateForm();
    fireEvent.focus(account);
    typeInto(account, "chica");
    expect(listedOptionLabels()).toEqual(["1.1.01.01.002 — Caja Chica"]);
    expect(headerEl("CAJAS")).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CreateCajaForm — los títulos no se pueden elegir", () => {
  it("clic sobre los encabezados de Activo no cambia el valor", async () => {
    const account = await openCreateForm();
    pressEveryHeader(account, ["ACTIVO", "CORRIENTE", "DISPONIBLE", "CAJAS", "BANCOS"]);
    fireEvent.blur(account);
    expect(account.value).toBe("");
  });

  it("con solo títulos «intentados», crear la caja NO llama a la acción y avisa que falta la cuenta", async () => {
    const account = await openCreateForm();
    fillRest();
    pressEveryHeader(account, ["CAJAS", "ACTIVO"]);
    fireEvent.blur(account);
    const before = snapshotTexts();
    fireEvent.click(createButton());
    await act(async () => {});
    expect(actions.createCajaCajaAction).not.toHaveBeenCalled();
    expect(accountErrorShown(before)).toBe(true);
  });

  it("teclear el código de un título (BANCOS, con una sola cuenta debajo) elige la cuenta, nunca el título", async () => {
    const account = await openCreateForm();
    fillRest();
    pickByCode(account, "1.1.01.02");
    expect(account.value).toBe("1.1.01.02.001 — Banco Mercantil");
    fireEvent.click(createButton());
    await waitFor(() => expect(actions.createCajaCajaAction).toHaveBeenCalledTimes(1));
    expect(actions.createCajaCajaAction.mock.calls[0][0].accountId).toBe("m:1.1.01.02.001");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CreateCajaForm — crear (el payload NO cambia)", () => {
  it("elegir tecleando el código + Enter y crear: createCajaCajaAction con los mismos campos", async () => {
    const account = await openCreateForm();
    fillRest();
    pickByCode(account, "110101001");
    expect(account.value).toBe(CAJA_P_LABEL);
    fireEvent.click(createButton());
    await waitFor(() => expect(actions.createCajaCajaAction).toHaveBeenCalledTimes(1));
    expect(actions.createCajaCajaAction).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      name: "Caja Chica Operativa",
      accountId: CAJA_P,
      custodianId: "emp-2",
      currency: "VES",
      maxBalance: "5000.00",
    });
  });

  it("sin cuenta contable: NO llama a la acción y muestra su error (ya no hay `required` nativo que lo impida)", async () => {
    await openCreateForm();
    fillRest();
    const before = snapshotTexts();
    fireEvent.click(createButton());
    await act(async () => {});
    expect(actions.createCajaCajaAction).not.toHaveBeenCalled();
    expect(accountErrorShown(before)).toBe(true);
  });

  it("éxito: el formulario se cierra y la lista de cajas se vuelve a cargar", async () => {
    const account = await openCreateForm();
    fillRest();
    pickByCode(account, "110101001");
    fireEvent.click(createButton());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Crear Caja Chica" })).toBeNull()
    );
    await waitFor(() => expect(actions.listCajasCajasAction).toHaveBeenCalledTimes(2));
  });

  it("fallo del servidor: muestra el error y conserva la cuenta elegida", async () => {
    actions.createCajaCajaAction.mockResolvedValue({
      success: false,
      error: "Esa cuenta ya está en otra caja",
    });
    const account = await openCreateForm();
    fillRest();
    pickByCode(account, "110101001");
    fireEvent.click(createButton());
    await screen.findByText("Esa cuenta ya está en otra caja");
    expect(account.value).toBe(CAJA_P_LABEL);
  });

  it("Cancelar cierra el formulario sin llamar a la acción", async () => {
    await openCreateForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("button", { name: "Crear Caja Chica" })).toBeNull();
    expect(actions.createCajaCajaAction).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CreateCajaForm — RN-19: el aviso «No hay cuentas de tipo Activo» cuenta solo cuentas de movimiento", () => {
  it("con cuentas de Activo de movimiento NO hay aviso y el campo está habilitado", async () => {
    const account = await openCreateForm();
    expect(screen.queryByText(ASSET_WARNING)).toBeNull();
    expect(account.disabled).toBe(false);
  });

  it("con SOLO títulos de Activo (y cuentas de movimiento de otros tipos): aviso visible y campo deshabilitado", async () => {
    const account = await openCreateForm([
      ...ofType(PLAN, "ASSET").filter((a) => !a.isPostable),
      ...ofType(PLAN, "LIABILITY", "EXPENSE"),
    ]);
    expect(screen.getByText(ASSET_WARNING)).toBeTruthy();
    expect(account.disabled).toBe(true);
    fireEvent.click(account);
    expect(listedOptionLabels()).toEqual([]);
  });

  it("sin ninguna cuenta: aviso visible y campo deshabilitado", async () => {
    const account = await openCreateForm([]);
    expect(screen.getByText(ASSET_WARNING)).toBeTruthy();
    expect(account.disabled).toBe(true);
  });

  it("con solo títulos de Activo, aunque se rellene lo demás, crear NO llama a la acción", async () => {
    await openCreateForm(ofType(PLAN, "ASSET").filter((a) => !a.isPostable));
    fillRest();
    fireEvent.click(createButton());
    await act(async () => {});
    expect(actions.createCajaCajaAction).not.toHaveBeenCalled();
  });

  it("una sola cuenta de Activo de movimiento entre muchos títulos basta para quitar el aviso", async () => {
    const account = await openCreateForm([
      ...ofType(PLAN, "ASSET").filter((a) => !a.isPostable),
      moveAcc("1.1.01.01.009", "Caja Nueva", "ASSET"),
    ]);
    expect(screen.queryByText(ASSET_WARNING)).toBeNull();
    expect(account.disabled).toBe(false);
    openList(account);
    expect(listedOptionLabels()).toEqual(["1.1.01.01.009 — Caja Nueva"]);
    expect(visibleHeaderNames()).toContain("CAJAS");
  });

  it("un título de Activo que va PRIMERO en la lista no cuenta como cuenta disponible", async () => {
    await openCreateForm([titleAcc("1", "ACTIVO", "ASSET")]);
    expect(screen.getByText(ASSET_WARNING)).toBeTruthy();
  });
});
