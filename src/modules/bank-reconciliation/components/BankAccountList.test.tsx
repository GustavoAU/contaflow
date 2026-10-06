// @vitest-environment jsdom
// src/modules/bank-reconciliation/components/BankAccountList.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase.
//
// SPEC-012 · ENTREGA B1 · paso 1 (modo RED) — «Nueva cuenta bancaria»: el selector «Cuenta contable»
// (`accountId`) pasa del <select> nativo a `AccountCombobox`.
//
// `chartAccounts` entrega TÍTULOS Y cuentas de movimiento de TODOS los tipos (la página ya no filtra
// `isPostable: true`; este formulario no filtra por tipo). Los tipos de props llevan `isPostable`.
// El `required` nativo desaparece: sin cuenta, el formulario muestra su error SIN llamar al servicio.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { BankAccountList } from "./BankAccountList";
import {
  MOVEMENTS,
  PLAN,
  TITLES,
  accessibleNames,
  accountErrorShown,
  expectAccountComboboxes,
  headerEl,
  listedOptionLabels,
  movementLabels,
  openList,
  pickByCode,
  pressEveryHeader,
  snapshotTexts,
  stubJsdomForListbox,
  typeInto,
  visibleHeaderNames,
  type PlanAccount,
} from "@/__tests__/helpers/account-combobox-forms";

const { createBankAccountAction } = vi.hoisted(() => ({ createBankAccountAction: vi.fn() }));

vi.mock("../actions/banking.actions", () => ({ createBankAccountAction }));

const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const CHART: PlanAccount[] = [...PLAN];
const BANCO_LABEL = "1.1.01.02.001 — Banco Mercantil";
const BANCO_ID = "m:1.1.01.02.001";

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  createBankAccountAction.mockResolvedValue({ success: true, data: { id: "ba-1" } });
});

afterEach(cleanup);

function renderList(chartAccounts: PlanAccount[] = CHART) {
  return render(
    <BankAccountList
      accounts={[]}
      chartAccounts={chartAccounts}
      companyId={COMPANY_ID}
      userId={USER_ID}
    />
  );
}

/** Abre el formulario en línea y devuelve el combobox de «Cuenta contable». */
function openForm(chartAccounts: PlanAccount[] = CHART): HTMLInputElement {
  renderList(chartAccounts);
  fireEvent.click(screen.getByRole("button", { name: /Nueva cuenta bancaria/ }));
  const [account] = expectAccountComboboxes(1, "Nueva cuenta bancaria");
  return account;
}

/** Rellena lo que NO es la cuenta contable (nombre y banco). */
function fillRest() {
  fireEvent.change(document.getElementById("ba-name") as HTMLInputElement, {
    target: { value: "Cuenta corriente operativa" },
  });
  fireEvent.change(document.getElementById("ba-bank") as HTMLSelectElement, {
    target: { value: "Banco Mercantil" },
  });
}

const saveButton = () => screen.getByRole("button", { name: /Guardar cuenta/ });

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("BankAccountList — «Cuenta contable» es un AccountCombobox (SPEC-012 B1)", () => {
  it("es un <input role=combobox> y ya no un <select> nativo", () => {
    const account = openForm();
    expect(account.tagName).toBe("INPUT");
    // los selectores de Banco y Moneda SÍ siguen siendo nativos (no son cuentas del plan)
    expect(document.querySelectorAll("select")).toHaveLength(2);
  });

  it("conserva su etiqueta «Cuenta contable» asociada (htmlFor=ba-account) y un nombre accesible", () => {
    const account = openForm();
    expect(account.id).toBe("ba-account");
    expect(screen.getByLabelText("Cuenta contable")).toBe(account);
    const names = accessibleNames();
    expect(names).toHaveLength(1);
    expect(names[0].trim()).not.toBe("");
  });

  it("el `required` nativo desaparece (la validación es del formulario)", () => {
    expect(openForm().required).toBe(false);
  });

  it("empieza vacío y sin marcar como inválido", () => {
    const account = openForm();
    expect(account.value).toBe("");
    expect(account.getAttribute("aria-invalid")).not.toBe("true");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("BankAccountList — qué se ofrece", () => {
  it("ofrece TODAS las cuentas de movimiento (de cualquier tipo: este formulario no filtra por tipo) y los títulos como encabezados", () => {
    const account = openForm();
    openList(account);
    expect(listedOptionLabels()).toEqual(movementLabels(PLAN));
    expect(visibleHeaderNames()).toEqual(TITLES.map((t) => t.name));
  });

  it("buscar por nombre: «banco» deja Banco Mercantil bajo ACTIVO › CORRIENTE › DISPONIBLE › BANCOS", () => {
    const account = openForm();
    fireEvent.focus(account);
    typeInto(account, "banco");
    expect(listedOptionLabels()).toEqual([BANCO_LABEL]);
    expect(visibleHeaderNames()).toEqual(["ACTIVO", "CORRIENTE", "DISPONIBLE", "BANCOS"]);
  });

  it("un plan solo con títulos deja el campo deshabilitado (no hay nada que elegir)", () => {
    const account = openForm(TITLES);
    expect(account.disabled).toBe(true);
    fireEvent.click(account);
    expect(listedOptionLabels()).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("BankAccountList — los títulos no se pueden elegir", () => {
  it("clic sobre cada encabezado no cambia el valor del campo", () => {
    const account = openForm();
    pressEveryHeader(
      account,
      TITLES.map((t) => t.name)
    );
    fireEvent.blur(account);
    expect(account.value).toBe("");
  });

  it("tras pulsar títulos y enviar, el servicio NO se llama y se avisa que falta la cuenta", async () => {
    const account = openForm();
    fillRest();
    pressEveryHeader(account, ["BANCOS", "DISPONIBLE", "ACTIVO"]);
    fireEvent.blur(account);
    const before = snapshotTexts();
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(createBankAccountAction).not.toHaveBeenCalled();
    expect(accountErrorShown(before)).toBe(true);
  });

  it("teclear el código de un TÍTULO con un solo hijo elige al hijo, nunca el título", async () => {
    const account = openForm();
    fillRest();
    pickByCode(account, "1.1.01.02"); // título BANCOS → único hijo: Banco Mercantil
    expect(account.value).toBe(BANCO_LABEL);
    fireEvent.click(saveButton());
    await waitFor(() => expect(createBankAccountAction).toHaveBeenCalledTimes(1));
    expect(createBankAccountAction.mock.calls[0][0].accountId).toBe(BANCO_ID);
  });

  it("el id de un título jamás llega al servicio, pase lo que pase", async () => {
    const account = openForm();
    fillRest();
    pressEveryHeader(account, ["CAJAS", "ACTIVO"]);
    pickByCode(account, "110102001");
    fireEvent.click(saveButton());
    await waitFor(() => expect(createBankAccountAction).toHaveBeenCalledTimes(1));
    expect(String(createBankAccountAction.mock.calls[0][0].accountId).startsWith("t:")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("BankAccountList — enviar", () => {
  it("elegir tecleando el código + Enter y guardar: el payload NO cambia (mismos campos, ids de la cuenta)", async () => {
    const account = openForm();
    fillRest();
    pickByCode(account, "110102001");
    expect(account.value).toBe(BANCO_LABEL);
    fireEvent.click(saveButton());
    await waitFor(() => expect(createBankAccountAction).toHaveBeenCalledTimes(1));
    expect(createBankAccountAction).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      accountId: BANCO_ID,
      name: "Cuenta corriente operativa",
      bankName: "Banco Mercantil",
      currency: "VES",
      createdBy: USER_ID,
    });
  });

  it("sin cuenta contable: NO llama al servicio y muestra su error (ya no hay `required` nativo que lo impida)", async () => {
    openForm();
    fillRest();
    const before = snapshotTexts();
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(createBankAccountAction).not.toHaveBeenCalled();
    expect(accountErrorShown(before)).toBe(true);
  });

  it("tras el error de «sin cuenta», elegir una cuenta y volver a guardar sí llama al servicio", async () => {
    const account = openForm();
    fillRest();
    const before = snapshotTexts();
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(accountErrorShown(before)).toBe(true);
    pickByCode(account, "110102001");
    fireEvent.click(saveButton());
    await waitFor(() => expect(createBankAccountAction).toHaveBeenCalledTimes(1));
  });

  it("éxito: el formulario se cierra y vuelve el botón «Nueva cuenta bancaria»", async () => {
    const account = openForm();
    fillRest();
    pickByCode(account, "110101001");
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Guardar cuenta/ })).toBeNull()
    );
    expect(screen.getByRole("button", { name: /Nueva cuenta bancaria/ })).toBeTruthy();
  });

  it("fallo del servicio: muestra el error y conserva la cuenta elegida", async () => {
    createBankAccountAction.mockResolvedValue({ success: false, error: "Ya existe esa cuenta" });
    const account = openForm();
    fillRest();
    pickByCode(account, "110102001");
    fireEvent.click(saveButton());
    await screen.findByText("Ya existe esa cuenta");
    expect(account.value).toBe(BANCO_LABEL);
  });

  it("cancelar descarta la cuenta elegida: al reabrir el formulario el campo está vacío", () => {
    const account = openForm();
    pickByCode(account, "110102001");
    expect(account.value).toBe(BANCO_LABEL);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: /Nueva cuenta bancaria/ }));
    const [reopened] = expectAccountComboboxes(1, "Nueva cuenta bancaria (reabierto)");
    expect(reopened.value).toBe("");
  });

  it("los encabezados siguen sin ser opciones aunque el plan traiga solo UNA cuenta de movimiento", () => {
    const account = openForm([...TITLES.filter((t) => t.code.startsWith("1")), MOVEMENTS[0]]);
    openList(account);
    expect(listedOptionLabels()).toEqual([`${MOVEMENTS[0].code} — ${MOVEMENTS[0].name}`]);
    expect(headerEl("ACTIVO")).not.toBeNull();
  });
});
