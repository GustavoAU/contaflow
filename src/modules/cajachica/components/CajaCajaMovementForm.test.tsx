// @vitest-environment jsdom
// src/modules/cajachica/components/CajaCajaMovementForm.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase.
//
// SPEC-012 · ENTREGA B1 · paso 1 (modo RED) — «Registrar gasto» de caja chica: el selector «Cuenta de
// Gasto» (`expenseAccountId`) pasa del <select> nativo a `AccountCombobox`.
//
// `accounts` entrega títulos Y cuentas de movimiento de todos los tipos; el formulario filtra por tipo
// EXPENSE como hoy. RN-19: el aviso «No hay cuentas de tipo Gasto…» y el campo deshabilitado cuentan
// SOLO cuentas de movimiento. El `required` nativo desaparece: sin cuenta, el formulario muestra su
// error SIN llamar a la acción.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CajaCajaMovementForm } from "./CajaCajaMovementForm";
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

const { createMovementAction } = vi.hoisted(() => ({ createMovementAction: vi.fn() }));

vi.mock("../actions/cajachica.actions", () => ({ createMovementAction }));

const COMPANY_ID = "company-1";
const CAJA_ID = "caja-1";
const EXPENSE_LABELS = movementLabels(ofType(PLAN, "EXPENSE"));
const PAPELERIA = "5.1.01.01.001 — Papelería y Útiles";
const VIAJE = "5.1.01.01.002 — Gastos de Viaje";
const EXPENSE_WARNING = /No hay cuentas de tipo Gasto/;

const onSuccess = vi.fn();
const onCancel = vi.fn();

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  createMovementAction.mockResolvedValue({ success: true, data: { id: "mov-1" } });
});

afterEach(cleanup);

function renderForm(accounts: PlanAccount[] = [...PLAN]) {
  render(
    <CajaCajaMovementForm
      companyId={COMPANY_ID}
      cajaCajaId={CAJA_ID}
      accounts={accounts}
      onSuccess={onSuccess}
      onCancel={onCancel}
    />
  );
  return expectAccountComboboxes(1, "Registrar gasto")[0];
}

/** Rellena todo lo obligatorio que NO es la cuenta de gasto. */
function fillRest() {
  fireEvent.change(document.getElementById("movement-concept") as HTMLInputElement, {
    target: { value: "Café y taxi" },
  });
  fireEvent.change(document.getElementById("movement-amount") as HTMLInputElement, {
    target: { value: "25,50" },
  });
  fireEvent.change(document.getElementById("movement-support") as HTMLInputElement, {
    target: { value: "FAC-0099" },
  });
}

const submitButton = () => screen.getByRole("button", { name: "Registrar gasto" });

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CajaCajaMovementForm — «Cuenta de Gasto» es un AccountCombobox (SPEC-012 B1)", () => {
  it("es un <input role=combobox>; la moneda sigue siendo un <select> nativo", () => {
    const account = renderForm();
    expect(account.tagName).toBe("INPUT");
    expect(document.querySelectorAll("select")).toHaveLength(1);
  });

  it("conserva su etiqueta asociada (htmlFor=movement-expense-account) y un nombre accesible", () => {
    const account = renderForm();
    expect(account.id).toBe("movement-expense-account");
    expect(screen.getByLabelText("Cuenta de Gasto *")).toBe(account);
    const names = accessibleNames();
    expect(names).toHaveLength(1);
    expect(names[0].trim()).not.toBe("");
  });

  it("el `required` nativo desaparece (la validación es del formulario)", () => {
    expect(renderForm().required).toBe(false);
  });

  it("empieza vacío y sin marcar como inválido", () => {
    const account = renderForm();
    expect(account.value).toBe("");
    expect(account.getAttribute("aria-invalid")).not.toBe("true");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CajaCajaMovementForm — qué se ofrece (el filtro por tipo EXPENSE se mantiene)", () => {
  it("SOLO cuentas de movimiento de Gasto, con los títulos de Gasto como encabezados", () => {
    const account = renderForm();
    openList(account);
    expect(listedOptionLabels()).toEqual(EXPENSE_LABELS);
    expect(visibleHeaderNames()).toEqual(["GASTOS", "ADMINISTRATIVOS", "GENERALES", "OFICINA"]);
  });

  it("no se ofrece ninguna cuenta de Activo, Pasivo, Patrimonio ni Ingreso (ni sus títulos)", () => {
    const account = renderForm();
    openList(account);
    const joined = listedOptionLabels().join("|");
    for (const absent of ["Caja", "Banco", "Retenciones", "Capital", "Ventas"]) {
      expect(joined).not.toContain(absent);
    }
    for (const name of ["ACTIVO", "PASIVO", "PATRIMONIO", "INGRESOS"]) {
      expect(headerEl(name)).toBeNull();
    }
  });

  it("se puede buscar por nombre: «viaje» deja Gastos de Viaje bajo OFICINA", () => {
    const account = renderForm();
    fireEvent.focus(account);
    typeInto(account, "viaje");
    expect(listedOptionLabels()).toEqual([VIAJE]);
    expect(headerEl("OFICINA")).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CajaCajaMovementForm — los títulos no se pueden elegir", () => {
  it("clic sobre los encabezados no cambia el valor", () => {
    const account = renderForm();
    pressEveryHeader(account, ["GASTOS", "ADMINISTRATIVOS", "GENERALES", "OFICINA"]);
    fireEvent.blur(account);
    expect(account.value).toBe("");
  });

  it("con solo títulos «intentados», registrar NO llama a la acción y avisa que falta la cuenta", async () => {
    const account = renderForm();
    fillRest();
    pressEveryHeader(account, ["OFICINA", "GASTOS"]);
    fireEvent.blur(account);
    const before = snapshotTexts();
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(createMovementAction).not.toHaveBeenCalled();
    expect(accountErrorShown(before)).toBe(true);
  });

  it("teclear el código del título OFICINA elige su PRIMERA cuenta (la activa), nunca el título", async () => {
    const account = renderForm();
    fillRest();
    pickByCode(account, "5.1.01.01");
    expect(account.value).toBe(PAPELERIA);
    fireEvent.click(submitButton());
    await waitFor(() => expect(createMovementAction).toHaveBeenCalledTimes(1));
    expect(createMovementAction.mock.calls[0][0].expenseAccountId).toBe("m:5.1.01.01.001");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CajaCajaMovementForm — registrar (el payload NO cambia)", () => {
  it("elegir tecleando el código + Enter y registrar: createMovementAction con los mismos campos", async () => {
    const account = renderForm();
    fillRest();
    pickByCode(account, "510101002");
    expect(account.value).toBe(VIAJE);
    fireEvent.click(submitButton());
    await waitFor(() => expect(createMovementAction).toHaveBeenCalledTimes(1));
    expect(createMovementAction).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      cajaCajaId: CAJA_ID,
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      concept: "Café y taxi",
      description: undefined,
      expenseAccountId: "m:5.1.01.01.002",
      amount: "25.50",
      currency: "VES",
      supportingDocumentId: "FAC-0099",
      providerRif: undefined,
      notes: undefined,
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("sin cuenta de gasto: NO llama a la acción y muestra su error (ya no hay `required` nativo que lo impida)", async () => {
    renderForm();
    fillRest();
    const before = snapshotTexts();
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(createMovementAction).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(accountErrorShown(before)).toBe(true);
  });

  it("tras el error de «sin cuenta», elegir una cuenta y volver a registrar sí llama a la acción", async () => {
    const account = renderForm();
    fillRest();
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(createMovementAction).not.toHaveBeenCalled();
    pickByCode(account, "510101001");
    fireEvent.click(submitButton());
    await waitFor(() => expect(createMovementAction).toHaveBeenCalledTimes(1));
  });

  it("fallo del servidor: muestra el error, no llama onSuccess y conserva la cuenta elegida", async () => {
    createMovementAction.mockResolvedValue({ success: false, error: "Excede el saldo máximo" });
    const account = renderForm();
    fillRest();
    pickByCode(account, "510101001");
    fireEvent.click(submitButton());
    await screen.findByText("Excede el saldo máximo");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(account.value).toBe(PAPELERIA);
  });

  it("Cancelar llama onCancel", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CajaCajaMovementForm — RN-19: el aviso «No hay cuentas de tipo Gasto» cuenta solo cuentas de movimiento", () => {
  it("con cuentas de Gasto de movimiento NO hay aviso y el campo está habilitado", () => {
    const account = renderForm();
    expect(screen.queryByText(EXPENSE_WARNING)).toBeNull();
    expect(account.disabled).toBe(false);
  });

  it("con SOLO títulos de Gasto (y cuentas de movimiento de otros tipos): aviso visible y campo deshabilitado", () => {
    const account = renderForm([
      ...ofType(PLAN, "EXPENSE").filter((a) => !a.isPostable),
      ...ofType(PLAN, "ASSET", "LIABILITY"),
    ]);
    expect(screen.getByText(EXPENSE_WARNING)).toBeTruthy();
    expect(account.disabled).toBe(true);
    fireEvent.click(account);
    expect(listedOptionLabels()).toEqual([]);
  });

  it("sin ninguna cuenta: aviso visible y campo deshabilitado", () => {
    const account = renderForm([]);
    expect(screen.getByText(EXPENSE_WARNING)).toBeTruthy();
    expect(account.disabled).toBe(true);
  });

  it("con solo títulos de Gasto, aunque se rellene lo demás, registrar NO llama a la acción", async () => {
    renderForm(ofType(PLAN, "EXPENSE").filter((a) => !a.isPostable));
    fillRest();
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(createMovementAction).not.toHaveBeenCalled();
  });

  it("un solo título de Gasto en la lista (el primero por código) no cuenta como cuenta disponible", () => {
    renderForm([titleAcc("5", "GASTOS", "EXPENSE")]);
    expect(screen.getByText(EXPENSE_WARNING)).toBeTruthy();
  });

  it("una sola cuenta de movimiento de Gasto entre muchos títulos basta para quitar el aviso", () => {
    const account = renderForm([
      ...ofType(PLAN, "EXPENSE").filter((a) => !a.isPostable),
      moveAcc("5.1.01.01.009", "Gastos Varios", "EXPENSE"),
    ]);
    expect(screen.queryByText(EXPENSE_WARNING)).toBeNull();
    expect(account.disabled).toBe(false);
    openList(account);
    expect(listedOptionLabels()).toEqual(["5.1.01.01.009 — Gastos Varios"]);
  });
});
