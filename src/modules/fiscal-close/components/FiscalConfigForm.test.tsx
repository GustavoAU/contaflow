// @vitest-environment jsdom
// src/modules/fiscal-close/components/FiscalConfigForm.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase.
//
// SPEC-012 · ENTREGA B2 · paso 1 (modo RED) — «Configuración contable» del cierre de ejercicio
// (`FiscalConfigForm`): los DOS selectores de cuenta de Patrimonio (OBLIGATORIOS) pasan del `Select` de
// Radix (`button role=combobox`) a `AccountCombobox` (`input role=combobox`): se filtran por la etiqueta.
//
// Q4 (alerta de configuración guardada): si `currentResultAccountId` / `currentRetainedEarningsAccountId`
// apuntan a un TÍTULO o a una cuenta que ya no está en `equityAccounts`, el formulario muestra
// `SavedAccountsAlert` desde el primer render, DESHABILITA «Guardar configuración» (con
// `aria-describedby` hacia la alerta) y el `submit` retorna SIN llamar a la acción. Al reemplazar la
// cuenta la alerta desaparece y se puede guardar. El combobox sigue vacío con `aria-invalid` (D1).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FiscalConfigForm } from "./FiscalConfigForm";
import {
  accessibleNames,
  accountComboboxes,
  clearButtonOf,
  expectAccountComboboxes,
  expectAlertListing,
  expectBlockedByAlert,
  expectNoSavedAccountsAlert,
  fieldLabelOf,
  labelOf,
  listedOptionLabels,
  moveAcc,
  movementLabels,
  openList,
  pickByCode,
  pressEveryHeader,
  savedAccountsAlerts,
  stubJsdomForListbox,
  titleAcc,
  visibleHeaderNames,
  type PlanAccount,
} from "@/__tests__/helpers/account-combobox-forms";

const { updateFiscalConfigAction, toastSuccess, toastError } = vi.hoisted(() => ({
  updateFiscalConfigAction: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../actions/fiscal-close.actions", () => ({ updateFiscalConfigAction }));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
  Toaster: () => null,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────

const T_PATRIMONIO = titleAcc("3", "PATRIMONIO", "EQUITY");
const T_CAPITALES = titleAcc("3.1", "CAPITALES", "EQUITY");
const T_APORTES = titleAcc("3.1.01", "APORTES", "EQUITY");
const T_CAPITAL = titleAcc("3.1.01.01", "CAPITAL", "EQUITY");
const Q_CAPITAL = moveAcc("3.1.01.01.001", "Capital Social", "EQUITY");
const Q_RESERVA = moveAcc("3.1.01.01.002", "Reserva Legal", "EQUITY");
const T_RESULTADOS = titleAcc("3.2", "RESULTADOS", "EQUITY");
const T_EJERCICIOS = titleAcc("3.2.01", "EJERCICIOS", "EQUITY");
const T_UTILIDADES = titleAcc("3.2.01.01", "UTILIDADES", "EQUITY");
const Q_RESULTADO = moveAcc("3.2.01.01.001", "Resultado del Ejercicio", "EQUITY");
const Q_RETENIDAS = moveAcc("3.2.01.01.002", "Utilidades Retenidas", "EQUITY");

/** Lo que entrega la página: las cuentas de Patrimonio (títulos Y cuentas de movimiento). */
const EQUITY: PlanAccount[] = [
  T_PATRIMONIO,
  T_CAPITALES,
  T_APORTES,
  T_CAPITAL,
  Q_CAPITAL,
  Q_RESERVA,
  T_RESULTADOS,
  T_EJERCICIOS,
  T_UTILIDADES,
  Q_RESULTADO,
  Q_RETENIDAS,
];
const TITLE_NAMES = EQUITY.filter((a) => !a.isPostable).map((a) => a.name);
const ASSET_BANCO = moveAcc("1.1.01.02.001", "Banco Mercantil", "ASSET"); // NO es de Patrimonio

const COMPANY_ID = "company-1";
const RESULT_LABEL = "Cuenta Resultado del Ejercicio";
const RETAINED_LABEL = "Cuenta Utilidades Retenidas / Pérdidas Acumuladas";
const TOAST_BOTH = "Selecciona ambas cuentas antes de guardar.";

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  updateFiscalConfigAction.mockResolvedValue({ success: true, data: undefined });
});

afterEach(cleanup);

// ─── Helpers de render ───────────────────────────────────────────────────────────────────────────

type Current = { result: string | null; retained: string | null };
const NONE: Current = { result: null, retained: null };
const VALID: Current = { result: Q_RESULTADO.id, retained: Q_RETENIDAS.id };

function element(accounts: PlanAccount[], current: Current) {
  return (
    <FiscalConfigForm
      companyId={COMPANY_ID}
      equityAccounts={accounts}
      currentResultAccountId={current.result}
      currentRetainedEarningsAccountId={current.retained}
    />
  );
}

function mount(current: Current = NONE, accounts: PlanAccount[] = EQUITY) {
  const utils = render(element(accounts, current));
  return {
    ...utils,
    refresh: (next: PlanAccount[], nextCurrent: Current = current) =>
      utils.rerender(element(next, nextCurrent)),
  };
}

/** Los dos combobox por su etiqueta (falla con un mensaje claro si siguen siendo `Select` de Radix). */
function fields() {
  expectAccountComboboxes(2, "FiscalConfigForm");
  return {
    result: screen.getByLabelText(RESULT_LABEL) as HTMLInputElement,
    retained: screen.getByLabelText(/Utilidades Retenidas/) as HTMLInputElement,
  };
}

const saveBtn = () => screen.getByRole("button", { name: /Guardar configuración|Guardando/ });
const form = () => document.querySelector("form") as HTMLFormElement;
const radixTriggers = () => document.querySelectorAll('button[role="combobox"]');
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const asTitle = (a: PlanAccount): PlanAccount => ({ ...a, isPostable: false });
const withTitle = (list: readonly PlanAccount[], target: PlanAccount) =>
  list.map((a) => (a.id === target.id ? asTitle(a) : a));
const without = (list: readonly PlanAccount[], ...targets: PlanAccount[]) =>
  list.filter((a) => !targets.some((t) => t.id === a.id));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("FiscalConfigForm — los dos selectores son AccountCombobox, no `Select` de Radix (SPEC-012 B2)", () => {
  it("hay dos <input role=combobox> y ningún disparador de Radix (button role=combobox)", () => {
    mount();
    fields();
    expect(radixTriggers()).toHaveLength(0);
    expect(screen.queryAllByRole("combobox").every((el) => el.tagName === "INPUT")).toBe(true);
  });

  it("D9: cada uno tiene su etiqueta asociada y se conservan los id existentes", () => {
    mount();
    const { result, retained } = fields();
    expect(result.id).toBe("resultAccount");
    expect(retained.id).toBe("retainedEarningsAccount");
    const names = accessibleNames();
    expect(names).toHaveLength(2);
    expect(names.every((n) => n.trim() !== "")).toBe(true);
    expect(new Set(names).size).toBe(2);
  });

  it("los dos ofrecen las cuentas de Patrimonio con sus títulos como encabezados", () => {
    mount();
    const { result, retained } = fields();
    openList(result);
    expect(listedOptionLabels()).toEqual(movementLabels(EQUITY));
    expect(visibleHeaderNames(TITLE_NAMES)).toEqual(TITLE_NAMES);
    fireEvent.blur(result);
    openList(retained);
    expect(listedOptionLabels()).toEqual(movementLabels(EQUITY));
    expect(visibleHeaderNames(TITLE_NAMES)).toEqual(TITLE_NAMES);
  });

  it("nacen VACÍOS sin configuración previa y NO son clearable (los dos son obligatorios)", () => {
    mount();
    const { result, retained } = fields();
    expect(result.value).toBe("");
    expect(retained.value).toBe("");
    pickByCode(result, Q_RESULTADO.code);
    pickByCode(retained, Q_RETENIDAS.code);
    expect(clearButtonOf(result)).toBeNull();
    expect(clearButtonOf(retained)).toBeNull();
  });

  it("sin `required` nativo (el formulario valida al enviar)", () => {
    mount();
    for (const input of accountComboboxes()) expect(input.required).toBe(false);
  });

  it("con la configuración vigente los campos muestran «código — nombre» y no hay alerta", () => {
    mount(VALID);
    const { result, retained } = fields();
    expect(result.value).toBe(labelOf(Q_RESULTADO));
    expect(retained.value).toBe(labelOf(Q_RETENIDAS));
    expect(result.getAttribute("aria-invalid")).not.toBe("true");
    expectNoSavedAccountsAlert(saveBtn());
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("FiscalConfigForm — los títulos NO se pueden elegir (CA-9)", () => {
  it("clic sobre los encabezados no cambia nada: los campos siguen vacíos y guardar avisa", async () => {
    mount();
    const { result, retained } = fields();
    pressEveryHeader(result, TITLE_NAMES);
    fireEvent.blur(result);
    pressEveryHeader(retained, TITLE_NAMES);
    fireEvent.blur(retained);
    expect(result.value).toBe("");
    expect(retained.value).toBe("");
    fireEvent.click(saveBtn());
    await flush();
    expect(updateFiscalConfigAction).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(TOAST_BOTH);
  });

  it("clic sobre los encabezados no cambia una cuenta ya elegida", () => {
    mount(VALID);
    const { result } = fields();
    pressEveryHeader(result, ["PATRIMONIO", "CAPITAL", "UTILIDADES"]);
    fireEvent.blur(result);
    expect(result.value).toBe(labelOf(Q_RESULTADO));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("FiscalConfigForm — elegir y guardar (el payload NO cambia)", () => {
  it("sin ninguna cuenta: «Selecciona ambas cuentas antes de guardar.» y la acción no se llama (guarda verde)", async () => {
    mount();
    fireEvent.click(saveBtn());
    await flush();
    expect(toastError).toHaveBeenCalledWith(TOAST_BOTH);
    expect(updateFiscalConfigAction).not.toHaveBeenCalled();
  });

  it("con UNA sola cuenta elegida tampoco guarda", async () => {
    mount();
    const { result } = fields();
    pickByCode(result, Q_RESULTADO.code);
    fireEvent.click(saveBtn());
    await flush();
    expect(toastError).toHaveBeenCalledWith(TOAST_BOTH);
    expect(updateFiscalConfigAction).not.toHaveBeenCalled();
  });

  it("elegir las dos tecleando el código + Enter y guardar envía EXACTAMENTE { companyId, resultAccountId, retainedEarningsAccountId }", async () => {
    mount();
    const { result, retained } = fields();
    pickByCode(result, "320101001");
    pickByCode(retained, Q_RETENIDAS.code);
    expect(result.value).toBe(labelOf(Q_RESULTADO));
    fireEvent.click(saveBtn());
    await waitFor(() => expect(updateFiscalConfigAction).toHaveBeenCalledTimes(1));
    expect(updateFiscalConfigAction).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      resultAccountId: Q_RESULTADO.id,
      retainedEarningsAccountId: Q_RETENIDAS.id,
    });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Configuración contable guardada.")
    );
  });

  it("la configuración vigente se guarda tal cual, sin tocar nada", async () => {
    mount(VALID);
    fireEvent.click(saveBtn());
    await waitFor(() => expect(updateFiscalConfigAction).toHaveBeenCalledTimes(1));
    expect(updateFiscalConfigAction).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      resultAccountId: Q_RESULTADO.id,
      retainedEarningsAccountId: Q_RETENIDAS.id,
    });
  });

  it("cambiar la cuenta de resultado antes de guardar envía la nueva", async () => {
    mount(VALID);
    const { result } = fields();
    pickByCode(result, Q_CAPITAL.code);
    fireEvent.click(saveBtn());
    await waitFor(() => expect(updateFiscalConfigAction).toHaveBeenCalledTimes(1));
    expect(updateFiscalConfigAction.mock.calls[0][0]).toMatchObject({
      resultAccountId: Q_CAPITAL.id,
      retainedEarningsAccountId: Q_RETENIDAS.id,
    });
  });

  it("si la acción falla muestra su error y no el mensaje de éxito", async () => {
    updateFiscalConfigAction.mockResolvedValue({ success: false, error: "Período cerrado" });
    mount(VALID);
    fireEvent.click(saveBtn());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Período cerrado"));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("mientras la acción está en vuelo el botón dice «Guardando...» y está deshabilitado (guarda verde)", async () => {
    let release!: (value: unknown) => void;
    updateFiscalConfigAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    mount(VALID);
    fireEvent.click(saveBtn());
    await waitFor(() => expect(saveBtn().textContent).toContain("Guardando..."));
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
    release({ success: true, data: undefined });
    await waitFor(() => expect(saveBtn().textContent).toContain("Guardar configuración"));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("FiscalConfigForm — RN-19: una lista de SOLO títulos no ofrece nada", () => {
  it("con SOLO títulos los dos campos no son utilizables, no queda ningún disparador de Radix y guardar avisa", async () => {
    mount(
      NONE,
      EQUITY.filter((a) => !a.isPostable)
    );
    expect(radixTriggers()).toHaveLength(0);
    const inputs = accountComboboxes();
    expect(inputs.every((input) => input.disabled)).toBe(true);
    fireEvent.click(saveBtn());
    await flush();
    expect(updateFiscalConfigAction).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(TOAST_BOTH);
  });

  it("con UNA cuenta de movimiento entre muchos títulos, esa sí se ofrece (y nada más)", () => {
    mount(NONE, [...EQUITY.filter((a) => !a.isPostable), Q_CAPITAL]);
    const { result } = fields();
    expect(result.disabled).toBe(false);
    openList(result);
    expect(listedOptionLabels()).toEqual([labelOf(Q_CAPITAL)]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Q4 — la configuración guardada apunta a un título o a una cuenta que no existe.
describe("FiscalConfigForm — Q4: alerta que BLOQUEA el guardado (valor guardado no elegible)", () => {
  it("una cuenta de TÍTULO guardada: alerta desde el primer render que lista SOLO ese campo", () => {
    mount({ result: T_CAPITAL.id, retained: Q_RETENIDAS.id });
    const { result, retained } = fields();
    expect(fieldLabelOf(result)).toBe(RESULT_LABEL);
    expect(fieldLabelOf(retained)).toBe(RETAINED_LABEL);
    expectAlertListing([RESULT_LABEL], [RETAINED_LABEL]);
  });

  it("el campo del título queda VACÍO e inválido; el otro conserva su cuenta y no es inválido", () => {
    mount({ result: T_CAPITAL.id, retained: Q_RETENIDAS.id });
    const { result, retained } = fields();
    expect(result.value).toBe("");
    expect(result.getAttribute("aria-invalid")).toBe("true");
    expect(retained.value).toBe(labelOf(Q_RETENIDAS));
    expect(retained.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("«Guardar configuración» queda DESHABILITADO y su descripción accesible apunta a la alerta", () => {
    mount({ result: T_CAPITAL.id, retained: Q_RETENIDAS.id });
    expectBlockedByAlert(saveBtn(), RESULT_LABEL);
  });

  it("el `submit` retorna SIN llamar a la acción (defensa en profundidad: el botón deshabilitado no es la única barrera)", async () => {
    mount({ result: T_CAPITAL.id, retained: Q_RETENIDAS.id });
    fireEvent.submit(form());
    await flush();
    expect(updateFiscalConfigAction).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("hacer clic en el botón deshabilitado tampoco llama a la acción", async () => {
    mount({ result: T_CAPITAL.id, retained: Q_RETENIDAS.id });
    fireEvent.click(saveBtn());
    await flush();
    expect(updateFiscalConfigAction).not.toHaveBeenCalled();
  });

  it("una cuenta que YA NO EXISTE (id ausente de la lista): misma alerta", () => {
    mount({ result: Q_RESULTADO.id, retained: "id-de-una-cuenta-eliminada" });
    expectAlertListing([RETAINED_LABEL], [RESULT_LABEL]);
    const { retained } = fields();
    expect(retained.value).toBe("");
    expect(retained.getAttribute("aria-invalid")).toBe("true");
    expectBlockedByAlert(saveBtn(), RETAINED_LABEL);
  });

  it("una cuenta válida del plan pero que NO es de Patrimonio (no está en SU lista) también es un problema", () => {
    mount({ result: ASSET_BANCO.id, retained: Q_RETENIDAS.id });
    expectAlertListing([RESULT_LABEL], [RETAINED_LABEL]);
  });

  it("las DOS cuentas con problema: la alerta lista ambos rótulos", () => {
    mount({ result: T_CAPITAL.id, retained: T_UTILIDADES.id });
    expectAlertListing([RESULT_LABEL, RETAINED_LABEL]);
    expect(savedAccountsAlerts()).toHaveLength(1);
  });

  it("reemplazar la cuenta del título por una de movimiento hace DESAPARECER la alerta y habilita guardar", async () => {
    mount({ result: T_CAPITAL.id, retained: Q_RETENIDAS.id });
    const { result } = fields();
    pickByCode(result, Q_RESULTADO.code);
    expect(result.value).toBe(labelOf(Q_RESULTADO));
    expect(result.getAttribute("aria-invalid")).not.toBe("true");
    expectNoSavedAccountsAlert(saveBtn());
    fireEvent.click(saveBtn());
    await waitFor(() => expect(updateFiscalConfigAction).toHaveBeenCalledTimes(1));
    expect(updateFiscalConfigAction).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      resultAccountId: Q_RESULTADO.id,
      retainedEarningsAccountId: Q_RETENIDAS.id,
    });
  });

  it("con dos problemas, arreglar UNO deja la alerta con el otro (y el botón sigue bloqueado)", () => {
    mount({ result: T_CAPITAL.id, retained: T_UTILIDADES.id });
    const { result } = fields();
    pickByCode(result, Q_CAPITAL.code);
    expectAlertListing([RETAINED_LABEL], [RESULT_LABEL]);
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
  });

  it("con dos problemas, arreglar LOS DOS retira la alerta y se puede guardar", async () => {
    mount({ result: T_CAPITAL.id, retained: "no-existe" });
    const { result, retained } = fields();
    pickByCode(result, Q_CAPITAL.code);
    pickByCode(retained, Q_RESERVA.code);
    expectNoSavedAccountsAlert(saveBtn());
    fireEvent.click(saveBtn());
    await waitFor(() => expect(updateFiscalConfigAction).toHaveBeenCalledTimes(1));
    expect(updateFiscalConfigAction.mock.calls[0][0]).toMatchObject({
      resultAccountId: Q_CAPITAL.id,
      retainedEarningsAccountId: Q_RESERVA.id,
    });
  });

  it("clic sobre los encabezados NO arregla el problema: la alerta sigue y el botón también bloqueado", () => {
    mount({ result: T_CAPITAL.id, retained: Q_RETENIDAS.id });
    const { result } = fields();
    pressEveryHeader(result, TITLE_NAMES);
    fireEvent.blur(result);
    expect(result.value).toBe("");
    expectAlertListing([RESULT_LABEL]);
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
  });

  it("sin valores guardados (null) NO hay alerta: «sin configurar» no es un problema", () => {
    mount(NONE);
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("la alerta usa los valores ACTUALES: si tras refrescar la lista una cuenta elegida pasa a ser título, aparece", () => {
    const { refresh } = mount(VALID);
    expectNoSavedAccountsAlert(saveBtn());
    refresh(withTitle(EQUITY, Q_RESULTADO));
    expectAlertListing([RESULT_LABEL], [RETAINED_LABEL]);
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
    const { result } = fields();
    expect(result.value).toBe("");
    expect(result.getAttribute("aria-invalid")).toBe("true");
  });

  it("…y si esa cuenta DESAPARECE de la lista, también; al volver a ser elegible la alerta se retira sola", () => {
    const { refresh } = mount(VALID);
    refresh(without(EQUITY, Q_RETENIDAS));
    expectAlertListing([RETAINED_LABEL], [RESULT_LABEL]);
    refresh(EQUITY);
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("una cuenta elegida por el usuario que luego se vuelve obsoleta también bloquea (no solo la inicial)", async () => {
    const { refresh } = mount(NONE);
    const { result, retained } = fields();
    pickByCode(result, Q_RESULTADO.code);
    pickByCode(retained, Q_RETENIDAS.code);
    expectNoSavedAccountsAlert(saveBtn());
    refresh(withTitle(EQUITY, Q_RETENIDAS));
    expectAlertListing([RETAINED_LABEL], [RESULT_LABEL]);
    fireEvent.submit(form());
    await flush();
    expect(updateFiscalConfigAction).not.toHaveBeenCalled();
  });

  it("un refresco que deja todo igual (objetos nuevos) NO muestra la alerta", () => {
    const { refresh } = mount(VALID);
    refresh(EQUITY.map((a) => ({ ...a })));
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("OTRAS cuentas que pasan a título o desaparecen NO activan la alerta", () => {
    const { refresh } = mount(VALID);
    refresh(without(withTitle(EQUITY, Q_CAPITAL), Q_RESERVA));
    expectNoSavedAccountsAlert(saveBtn());
  });
});
