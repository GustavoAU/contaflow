// @vitest-environment jsdom
// src/modules/cajachica/components/CajaCajaDepositForm.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase.
//
// SPEC-012 · ENTREGA B1 · paso 1 (modo RED) — «Registrar depósito» (reposición de fondo): el selector
// «Cuenta origen (Banco/Caja general)» (`sourceAccountId`) pasa del <select> nativo a
// `AccountCombobox`.
//
// La cuenta origen es de tipo ASSET y DISTINTA de la cuenta de la propia caja (`cajaAccountId`).
// `accounts` entrega títulos Y cuentas de movimiento de todos los tipos. RN-19: `sourceOptions` y el
// `disabled` cuentan SOLO cuentas de movimiento. El `required` nativo desaparece: sin cuenta, el
// formulario muestra su error SIN llamar a la acción.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CajaCajaDepositForm } from "./CajaCajaDepositForm";
import {
  PLAN,
  accessibleNames,
  accountErrorShown,
  expectAccountComboboxes,
  headerEl,
  labelOf,
  listedOptionLabels,
  movementLabels,
  ofType,
  openList,
  pickByCode,
  pressEveryHeader,
  snapshotTexts,
  stubJsdomForListbox,
  typeInto,
  visibleHeaderNames,
  type PlanAccount,
} from "@/__tests__/helpers/account-combobox-forms";

const { createDepositAction } = vi.hoisted(() => ({ createDepositAction: vi.fn() }));

vi.mock("../actions/cajachica.actions", () => ({ createDepositAction }));

const COMPANY_ID = "company-1";
const CAJA_ID = "caja-1";
/** La cuenta contable de la propia caja chica: NO se puede elegir como origen del depósito. */
const OWN_ACCOUNT_ID = "m:1.1.01.01.001";
const OWN_LABEL = "1.1.01.01.001 — Caja Principal";
const BANCO = "1.1.01.02.001 — Banco Mercantil";
const CAJA_CHICA = "1.1.01.01.002 — Caja Chica";
/** ASSET sin la cuenta de la caja. */
const SOURCE_LABELS = movementLabels(ofType(PLAN, "ASSET")).filter((l) => l !== OWN_LABEL);

const onSuccess = vi.fn();
const onCancel = vi.fn();

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  createDepositAction.mockResolvedValue({ success: true, data: { id: "dep-1" } });
});

afterEach(cleanup);

function renderForm(accounts: PlanAccount[] = [...PLAN]) {
  render(
    <CajaCajaDepositForm
      companyId={COMPANY_ID}
      cajaCajaId={CAJA_ID}
      cajaAccountId={OWN_ACCOUNT_ID}
      currency="VES"
      accounts={accounts}
      onSuccess={onSuccess}
      onCancel={onCancel}
    />
  );
  return expectAccountComboboxes(1, "Registrar depósito")[0];
}

/** Rellena lo que NO es la cuenta origen: monto y descripción (fecha ya viene con hoy). */
function fillRest() {
  fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "1500,50" } });
  fireEvent.change(screen.getByPlaceholderText("Reposición de fondo fijo..."), {
    target: { value: "Reposición mensual" },
  });
}

const submitButton = () => screen.getByRole("button", { name: "Registrar depósito" });

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CajaCajaDepositForm — «Cuenta origen» es un AccountCombobox (SPEC-012 B1)", () => {
  it("es un <input role=combobox> y ya no un <select> nativo (no hay ningún <select> en el formulario)", () => {
    const account = renderForm();
    expect(account.tagName).toBe("INPUT");
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });

  it("D9: la etiqueta «Cuenta origen…» queda asociada al campo y hay un nombre accesible", () => {
    const account = renderForm();
    expect(screen.getByLabelText(/Cuenta origen/)).toBe(account);
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
describe("CajaCajaDepositForm — qué se ofrece (ASSET y distinta de la cuenta de la caja)", () => {
  it("SOLO cuentas de movimiento de Activo, SIN la cuenta de la propia caja, con los títulos como encabezados", () => {
    const account = renderForm();
    openList(account);
    expect(listedOptionLabels()).toEqual(SOURCE_LABELS);
    expect(listedOptionLabels()).not.toContain(OWN_LABEL);
    expect(visibleHeaderNames()).toEqual(["ACTIVO", "CORRIENTE", "DISPONIBLE", "CAJAS", "BANCOS"]);
  });

  it("la cuenta de la propia caja no se puede elegir ni tecleando su código exacto", () => {
    const account = renderForm();
    fireEvent.focus(account);
    typeInto(account, "110101001");
    expect(listedOptionLabels()).toEqual([]);
    expect(document.body.textContent).toContain("No hay cuentas que coincidan");
    fireEvent.keyDown(account, { key: "Enter" });
    fireEvent.keyDown(account, { key: "Tab" });
    expect(account.value).not.toBe(OWN_LABEL);
  });

  it("no se ofrecen cuentas de Pasivo, Patrimonio, Ingreso ni Gasto", () => {
    const account = renderForm();
    openList(account);
    const joined = listedOptionLabels().join("|");
    for (const absent of ["Retenciones", "Capital", "Ventas", "Gastos", "Papelería"]) {
      expect(joined).not.toContain(absent);
    }
    for (const name of ["PASIVO", "PATRIMONIO", "INGRESOS", "GASTOS"]) {
      expect(headerEl(name)).toBeNull();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CajaCajaDepositForm — los títulos no se pueden elegir", () => {
  it("clic sobre los encabezados no cambia el valor", () => {
    const account = renderForm();
    pressEveryHeader(account, ["ACTIVO", "CORRIENTE", "DISPONIBLE", "CAJAS", "BANCOS"]);
    fireEvent.blur(account);
    expect(account.value).toBe("");
  });

  it("con solo títulos «intentados», registrar NO llama a la acción y avisa que falta la cuenta", async () => {
    const account = renderForm();
    fillRest();
    pressEveryHeader(account, ["BANCOS", "ACTIVO"]);
    fireEvent.blur(account);
    const before = snapshotTexts();
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(createDepositAction).not.toHaveBeenCalled();
    expect(accountErrorShown(before)).toBe(true);
  });

  it("teclear el código del título BANCOS elige su única cuenta (Banco Mercantil), nunca el título", async () => {
    const account = renderForm();
    fillRest();
    pickByCode(account, "1.1.01.02");
    expect(account.value).toBe(BANCO);
    fireEvent.click(submitButton());
    await waitFor(() => expect(createDepositAction).toHaveBeenCalledTimes(1));
    expect(createDepositAction.mock.calls[0][0].sourceAccountId).toBe("m:1.1.01.02.001");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CajaCajaDepositForm — registrar (el payload NO cambia)", () => {
  it("elegir tecleando el código + Enter y registrar: createDepositAction con los mismos campos", async () => {
    const account = renderForm();
    fillRest();
    pickByCode(account, "110102001");
    expect(account.value).toBe(BANCO);
    fireEvent.click(submitButton());
    await waitFor(() => expect(createDepositAction).toHaveBeenCalledTimes(1));
    expect(createDepositAction).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      cajaCajaId: CAJA_ID,
      sourceAccountId: "m:1.1.01.02.001",
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      amount: "1500.50",
      description: "Reposición mensual",
      supportingDocumentId: undefined,
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("sin cuenta origen: NO llama a la acción y muestra su error (ya no hay `required` nativo que lo impida)", async () => {
    renderForm();
    fillRest();
    const before = snapshotTexts();
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(createDepositAction).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(accountErrorShown(before)).toBe(true);
  });

  it("tras el error de «sin cuenta», elegir una cuenta y volver a registrar sí llama a la acción", async () => {
    const account = renderForm();
    fillRest();
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(createDepositAction).not.toHaveBeenCalled();
    pickByCode(account, "110101002");
    expect(account.value).toBe(CAJA_CHICA);
    fireEvent.click(submitButton());
    await waitFor(() => expect(createDepositAction).toHaveBeenCalledTimes(1));
  });

  it("fallo del servidor: muestra el error, no llama onSuccess y conserva la cuenta elegida", async () => {
    createDepositAction.mockResolvedValue({ success: false, error: "Período cerrado" });
    const account = renderForm();
    fillRest();
    pickByCode(account, "110102001");
    fireEvent.click(submitButton());
    await screen.findByText("Período cerrado");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(account.value).toBe(BANCO);
  });

  it("Cancelar llama onCancel", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CajaCajaDepositForm — RN-19: las opciones de origen cuentan solo cuentas de movimiento", () => {
  it("si lo único que queda de movimiento es la cuenta de la propia caja (más títulos), el campo está deshabilitado", () => {
    const account = renderForm([
      ...ofType(PLAN, "ASSET").filter((a) => !a.isPostable),
      PLAN.find((a) => a.id === OWN_ACCOUNT_ID)!,
    ]);
    expect(account.disabled).toBe(true);
    fireEvent.click(account);
    expect(listedOptionLabels()).toEqual([]);
  });

  it("con solo títulos de Activo el campo está deshabilitado y registrar no llama a la acción", async () => {
    const account = renderForm(ofType(PLAN, "ASSET").filter((a) => !a.isPostable));
    expect(account.disabled).toBe(true);
    fillRest();
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(createDepositAction).not.toHaveBeenCalled();
  });

  it("sin ninguna cuenta el campo está deshabilitado", () => {
    expect(renderForm([]).disabled).toBe(true);
  });

  it("una cuenta de Activo distinta de la de la caja basta para habilitarlo", () => {
    const account = renderForm([
      ...ofType(PLAN, "ASSET").filter((a) => !a.isPostable),
      PLAN.find((a) => a.id === OWN_ACCOUNT_ID)!,
      PLAN.find((a) => a.code === "1.1.01.02.001")!,
    ]);
    expect(account.disabled).toBe(false);
    openList(account);
    expect(listedOptionLabels()).toEqual([BANCO]);
    expect(labelOf(PLAN.find((a) => a.id === OWN_ACCOUNT_ID)!)).toBe(OWN_LABEL);
  });
});
