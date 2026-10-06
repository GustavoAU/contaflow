// @vitest-environment jsdom
// src/modules/cajachica/components/CajaCajaList.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase.
//
// SPEC-012 · ENTREGA B1 · paso 1 (modo RED) — «Cerrar caja chica» (`CloseCajaDialog`, un AlertDialog de
// Radix con step-up `useReverification`): el selector «Cuenta de retorno del efectivo (Activo)»
// (`returnAccountId`) pasa del <select> nativo a `AccountCombobox`.
//
// La cuenta de retorno es de tipo ASSET y DISTINTA de la cuenta de la caja (`caja.accountId`).
// RN-19: el aviso «No hay otra cuenta de tipo Activo…» y el `disabled` cuentan SOLO cuentas de
// movimiento.
//
// D3 (Esc dentro del AlertDialog): Radix cierra el diálogo con Esc ANTES de que el combobox vea la
// tecla. Con la lista del combobox abierta el PRIMER Escape cierra solo la lista y el diálogo sigue
// abierto; un SEGUNDO Escape (lista ya cerrada) cierra el diálogo. Se resuelve con `onEscapeKeyDown`
// del AlertDialogContent usando `isAccountComboboxOpen(event.target)`.
//
// `useReverification` se sustituye por el identity (como en FiscalYearCloseManager.a11y.test.tsx).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { CajaCajaList } from "./CajaCajaList";
import {
  PLAN,
  accessibleNames,
  accountComboboxes,
  expectAccountComboboxes,
  headerEl,
  listedOptionLabels,
  moveAcc,
  movementLabels,
  ofType,
  openList,
  pickByCode,
  press,
  pressEveryHeader,
  stubJsdomForListbox,
  titleAcc,
  typeInto,
  visibleHeaderNames,
  type PlanAccount,
} from "@/__tests__/helpers/account-combobox-forms";

const actions = vi.hoisted(() => ({
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

vi.mock("../actions/cajachica.actions", () => actions);
vi.mock("@clerk/nextjs", () => ({ useReverification: (fn: unknown) => fn }));
vi.mock("@clerk/nextjs/errors", () => ({ isReverificationCancelledError: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));

const COMPANY_ID = "company-1";
/** La cuenta contable de la propia caja: NO puede ser la de retorno del efectivo. */
const OWN_ACCOUNT_ID = "m:1.1.01.01.001";
const OWN_LABEL = "1.1.01.01.001 — Caja Principal";
const BANCO = "1.1.01.02.001 — Banco Mercantil";
const RETURN_LABELS = movementLabels(ofType(PLAN, "ASSET")).filter((l) => l !== OWN_LABEL);
const RETURN_WARNING = /No hay otra cuenta de tipo Activo disponible/;

const CAJA = {
  id: "caja-1",
  name: "Caja Chica Operativa",
  accountId: OWN_ACCOUNT_ID,
  accountCode: "1.1.01.01.001",
  accountName: "Caja Principal",
  custodianId: "emp-1",
  custodianName: "María Pérez",
  currency: "VES",
  maxBalance: "5000.00",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  closedAt: null,
  totalDeposited: "1000.00",
  totalPendingMovements: "0.00",
  totalApprovedMovements: "200.00",
  availableBalance: "800.00",
  percentUsed: 20,
};

const onRefresh = vi.fn();

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  actions.closeCajaCajaAction.mockResolvedValue({ success: true, data: { id: "caja-1" } });
});

afterEach(cleanup);

/** Monta la lista (admin, caja ACTIVA) y abre el diálogo «Cerrar caja chica». */
function openCloseDialog(accounts: PlanAccount[] = [...PLAN]) {
  render(
    <CajaCajaList
      companyId={COMPANY_ID}
      cajas={[CAJA] as never}
      accounts={accounts}
      employees={[{ id: "emp-1", name: "María Pérez", status: "ACTIVE" }]}
      isAdmin
      onRefresh={onRefresh}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Cerrar caja" }));
  const dialog = screen.getByRole("alertdialog");
  return { dialog, account: expectAccountComboboxes(1, "Cerrar caja chica")[0] };
}

const confirmButton = () =>
  within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cerrar caja" });

const dialogIsOpen = () => screen.queryByRole("alertdialog") !== null;

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CloseCajaDialog — «Cuenta de retorno» es un AccountCombobox (SPEC-012 B1)", () => {
  it("dentro del diálogo hay UN <input role=combobox> y ningún <select> nativo", () => {
    const { dialog, account } = openCloseDialog();
    expect(account.tagName).toBe("INPUT");
    expect(dialog.contains(account)).toBe(true);
    expect(dialog.querySelectorAll("select")).toHaveLength(0);
  });

  it("conserva su etiqueta asociada (htmlFor=return-account-<id de la caja>) y un nombre accesible", () => {
    const { account } = openCloseDialog();
    expect(account.id).toBe(`return-account-${CAJA.id}`);
    expect(screen.getByLabelText("Cuenta de retorno del efectivo (Activo) *")).toBe(account);
    const names = accessibleNames();
    expect(names).toHaveLength(1);
    expect(names[0].trim()).not.toBe("");
  });

  it("empieza vacío, sin marcar como inválido y sin el `required` nativo", () => {
    const { account } = openCloseDialog();
    expect(account.value).toBe("");
    expect(account.required).toBe(false);
    expect(account.getAttribute("aria-invalid")).not.toBe("true");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CloseCajaDialog — qué se ofrece (ASSET y distinta de la cuenta de la caja)", () => {
  it("SOLO cuentas de movimiento de Activo, SIN la cuenta de la propia caja, con los títulos como encabezados", () => {
    const { account } = openCloseDialog();
    openList(account);
    expect(listedOptionLabels()).toEqual(RETURN_LABELS);
    expect(listedOptionLabels()).not.toContain(OWN_LABEL);
    expect(visibleHeaderNames()).toEqual(["ACTIVO", "CORRIENTE", "DISPONIBLE", "CAJAS", "BANCOS"]);
  });

  it("la cuenta de la propia caja no se puede elegir ni tecleando su código exacto", () => {
    const { account } = openCloseDialog();
    fireEvent.focus(account);
    typeInto(account, "110101001");
    expect(listedOptionLabels()).toEqual([]);
    press(account, "Enter");
    press(account, "Tab");
    expect(account.value).not.toBe(OWN_LABEL);
  });

  it("no se ofrecen cuentas de Pasivo, Patrimonio, Ingreso ni Gasto", () => {
    const { account } = openCloseDialog();
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
describe("CloseCajaDialog — los títulos no se pueden elegir", () => {
  it("clic sobre los encabezados no cambia el valor y «Cerrar caja» sigue deshabilitado", () => {
    const { account } = openCloseDialog();
    pressEveryHeader(account, ["ACTIVO", "CORRIENTE", "DISPONIBLE", "CAJAS", "BANCOS"]);
    fireEvent.blur(account);
    expect(account.value).toBe("");
    expect(confirmButton().hasAttribute("disabled")).toBe(true);
    expect(actions.closeCajaCajaAction).not.toHaveBeenCalled();
  });

  it("teclear el código del título BANCOS elige su única cuenta, nunca el título", async () => {
    const { account } = openCloseDialog();
    pickByCode(account, "1.1.01.02");
    expect(account.value).toBe(BANCO);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(actions.closeCajaCajaAction).toHaveBeenCalledTimes(1));
    expect(actions.closeCajaCajaAction.mock.calls[0][0].returnAccountId).toBe("m:1.1.01.02.001");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CloseCajaDialog — cerrar la caja (el payload NO cambia)", () => {
  it("elegir tecleando el código + Enter y confirmar: closeCajaCajaAction({ cajaCajaId, companyId, returnAccountId })", async () => {
    const { account } = openCloseDialog();
    pickByCode(account, "110102001");
    expect(account.value).toBe(BANCO);
    expect(confirmButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(actions.closeCajaCajaAction).toHaveBeenCalledTimes(1));
    expect(actions.closeCajaCajaAction).toHaveBeenCalledWith({
      cajaCajaId: CAJA.id,
      companyId: COMPANY_ID,
      returnAccountId: "m:1.1.01.02.001",
    });
  });

  it("éxito: el diálogo se cierra y se refresca la lista", async () => {
    const { account } = openCloseDialog();
    pickByCode(account, "110102001");
    fireEvent.click(confirmButton());
    await waitFor(() => expect(dialogIsOpen()).toBe(false));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("sin cuenta de retorno: «Cerrar caja» está deshabilitado y no llama a la acción", async () => {
    openCloseDialog();
    expect(confirmButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(confirmButton());
    await act(async () => {});
    expect(actions.closeCajaCajaAction).not.toHaveBeenCalled();
    expect(dialogIsOpen()).toBe(true);
  });

  it("fallo del servidor: el diálogo sigue abierto, muestra el error y conserva la cuenta elegida", async () => {
    actions.closeCajaCajaAction.mockResolvedValue({
      success: false,
      error: "La caja tiene gastos pendientes",
    });
    const { account } = openCloseDialog();
    pickByCode(account, "110102001");
    fireEvent.click(confirmButton());
    await screen.findByText("La caja tiene gastos pendientes");
    expect(dialogIsOpen()).toBe(true);
    expect(account.value).toBe(BANCO);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("Cancelar cierra el diálogo sin llamar a la acción", async () => {
    openCloseDialog();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancelar" })
    );
    await waitFor(() => expect(dialogIsOpen()).toBe(false));
    expect(actions.closeCajaCajaAction).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CloseCajaDialog — RN-19: el aviso «No hay otra cuenta de tipo Activo» cuenta solo cuentas de movimiento", () => {
  it("con otras cuentas de Activo de movimiento NO hay aviso y el campo está habilitado", () => {
    const { account } = openCloseDialog();
    expect(screen.queryByText(RETURN_WARNING)).toBeNull();
    expect(account.disabled).toBe(false);
  });

  it("si lo único que queda de movimiento es la cuenta de la propia caja (más títulos de Activo): aviso visible y campo deshabilitado", () => {
    const { account } = openCloseDialog([
      ...ofType(PLAN, "ASSET").filter((a) => !a.isPostable),
      PLAN.find((a) => a.id === OWN_ACCOUNT_ID)!,
    ]);
    expect(screen.getByText(RETURN_WARNING)).toBeTruthy();
    expect(account.disabled).toBe(true);
    fireEvent.click(account);
    expect(listedOptionLabels()).toEqual([]);
    expect(confirmButton().hasAttribute("disabled")).toBe(true);
  });

  it("con SOLO títulos de Activo: aviso visible y campo deshabilitado", () => {
    const { account } = openCloseDialog(ofType(PLAN, "ASSET").filter((a) => !a.isPostable));
    expect(screen.getByText(RETURN_WARNING)).toBeTruthy();
    expect(account.disabled).toBe(true);
  });

  it("un título de Activo que va PRIMERO en la lista no cuenta como cuenta disponible", () => {
    openCloseDialog([titleAcc("1", "ACTIVO", "ASSET")]);
    expect(screen.getByText(RETURN_WARNING)).toBeTruthy();
  });

  it("una sola cuenta de Activo distinta de la de la caja, entre muchos títulos, basta para quitar el aviso", () => {
    const { account } = openCloseDialog([
      ...ofType(PLAN, "ASSET").filter((a) => !a.isPostable),
      PLAN.find((a) => a.id === OWN_ACCOUNT_ID)!,
      moveAcc("1.1.01.02.009", "Banco Nuevo", "ASSET"),
    ]);
    expect(screen.queryByText(RETURN_WARNING)).toBeNull();
    expect(account.disabled).toBe(false);
    openList(account);
    expect(listedOptionLabels()).toEqual(["1.1.01.02.009 — Banco Nuevo"]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("CloseCajaDialog — D3: Esc con la lista del combobox abierta cierra SOLO la lista", () => {
  it("el PRIMER Escape (lista abierta) cierra la lista y el diálogo SIGUE abierto", () => {
    const { account } = openCloseDialog();
    openList(account);
    expect(screen.getByRole("listbox")).toBeTruthy();
    press(account, "Escape");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(dialogIsOpen()).toBe(true);
    expect(actions.closeCajaCajaAction).not.toHaveBeenCalled();
  });

  it("un SEGUNDO Escape (lista ya cerrada) cierra el diálogo", async () => {
    const { account } = openCloseDialog();
    openList(account);
    press(account, "Escape");
    expect(dialogIsOpen()).toBe(true);
    press(account, "Escape");
    await waitFor(() => expect(dialogIsOpen()).toBe(false));
  });

  it("con la lista cerrada desde el principio, el PRIMER Escape ya cierra el diálogo", async () => {
    const { account } = openCloseDialog();
    press(account, "Escape");
    await waitFor(() => expect(dialogIsOpen()).toBe(false));
  });

  it("con texto tecleado y resultados, el primer Escape cierra la lista (sin elegir nada) y el diálogo sigue abierto", () => {
    const { account } = openCloseDialog();
    fireEvent.focus(account);
    typeInto(account, "banco");
    expect(screen.getByRole("listbox")).toBeTruthy();
    press(account, "Escape");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(dialogIsOpen()).toBe(true);
    expect(account.value).toBe("");
  });

  it("con el aviso de «sin coincidencias» visible (aunque no haya listbox) el primer Escape también cierra solo el aviso", async () => {
    const { account } = openCloseDialog();
    fireEvent.focus(account);
    typeInto(account, "zzz");
    expect(document.body.textContent).toContain("No hay cuentas que coincidan");
    press(account, "Escape");
    expect(document.body.textContent).not.toContain("No hay cuentas que coincidan");
    expect(dialogIsOpen()).toBe(true);
    press(account, "Escape");
    await waitFor(() => expect(dialogIsOpen()).toBe(false));
  });

  it("un Escape cuyo destino NO es el combobox (p. ej. el botón Cancelar) cierra el diálogo aunque otra lista siga abierta", async () => {
    const { dialog, account } = openCloseDialog();
    openList(account);
    const cancel = within(dialog).getByRole("button", { name: "Cancelar" });
    press(cancel, "Escape");
    await waitFor(() => expect(dialogIsOpen()).toBe(false));
  });

  it("tras cerrar la lista con Escape se puede volver a abrir y elegir una cuenta sin que el diálogo se haya cerrado", async () => {
    const { account } = openCloseDialog();
    openList(account);
    press(account, "Escape");
    expect(dialogIsOpen()).toBe(true);
    pickByCode(account, "110102001");
    expect(account.value).toBe(BANCO);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(actions.closeCajaCajaAction).toHaveBeenCalledTimes(1));
  });

  it("solo hay un combobox de cuenta en el diálogo (el resto del documento queda oculto detrás del AlertDialog)", () => {
    openCloseDialog();
    expect(accountComboboxes()).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// L-2 (revisión de seguridad de la Entrega B1) — TDD SPEC, modo RED: la cuenta de retorno elegida se
// REVALIDA con la lista vigente.
//
// Hoy «Cerrar caja» solo mira `!returnAccountId`. Si tras un refresco de `accounts` la cuenta elegida
// deja de ser elegible (otro usuario la convirtió en título, ya no existe, o dejó de ser de Activo) el
// combobox se ve vacío e inválido pero el botón sigue activo y la liquidación iría a la cuenta vieja.
// Contrato: la guarda del envío Y el `disabled` usan `isSelectableAccountId(returnAccounts, id)`, con
// `returnAccounts` = las cuentas de tipo ASSET distintas de la cuenta de la caja (la lista del selector).
// Con la cuenta ya no elegible el botón queda DESHABILITADO y NO se llama a `closeCajaCajaAction`
// (el step-up `useReverification` está sustituido por el identity, así que es la misma acción).
//
// El refresco se simula con `rerender` sobre la MISMA instancia (el estado `returnAccountId` sobrevive;
// el diálogo sigue abierto) y con el MISMO arreglo `cajas`. Un botón deshabilitado no dispara `onClick`
// en React: la guarda dentro del manejador no se puede aislar del `disabled` en este componente.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
const BANCO_ACC = PLAN.find((a) => a.id === "m:1.1.01.02.001")!;
const CAJA_CHICA_ACC = PLAN.find((a) => a.id === "m:1.1.01.01.002")!;
const CAJAS = [CAJA] as never;
const EMPLOYEES = [{ id: "emp-1", name: "María Pérez", status: "ACTIVE" }];

/** La lista con `target` convertida en título (`isPostable: false`). */
const withTitle = (list: readonly PlanAccount[], target: PlanAccount): PlanAccount[] =>
  list.map((a) => (a.id === target.id ? { ...a, isPostable: false } : a));
/** La lista sin `target`. */
const without = (list: readonly PlanAccount[], target: PlanAccount): PlanAccount[] =>
  list.filter((a) => a.id !== target.id);
/** La lista con `target` reclasificada a otro tipo contable. */
const withType = (list: readonly PlanAccount[], target: PlanAccount, type: string): PlanAccount[] =>
  list.map((a) => (a.id === target.id ? { ...a, type } : a));

/**
 * Monta la lista, abre «Cerrar caja chica» y elige el Banco Mercantil tecleando su código: el botón
 * «Cerrar caja» queda habilitado (se comprueba). `refresh(lista)` = el padre entrega una lista nueva.
 */
function mountWithChosenReturnAccount() {
  const element = (accounts: PlanAccount[]) => (
    <CajaCajaList
      companyId={COMPANY_ID}
      cajas={CAJAS}
      accounts={accounts}
      employees={EMPLOYEES}
      isAdmin
      onRefresh={onRefresh}
    />
  );
  const utils = render(element([...PLAN]));
  fireEvent.click(screen.getByRole("button", { name: "Cerrar caja" }));
  const [account] = expectAccountComboboxes(1, "Cerrar caja chica");
  pickByCode(account, "110102001");
  expect(account.value).toBe(BANCO);
  expect(confirmButton().hasAttribute("disabled")).toBe(false); // precondición: así SÍ se podría cerrar
  return {
    account,
    refresh: (accounts: PlanAccount[]) => utils.rerender(element(accounts)),
  };
}

const OBSOLETE_RETURN_LISTS = [
  { when: "pasa a ser un TÍTULO", list: () => withTitle(PLAN, BANCO_ACC) },
  { when: "YA NO ESTÁ en la lista", list: () => without(PLAN, BANCO_ACC) },
  {
    when: "deja de ser de ACTIVO (ya no está en la lista del selector de retorno)",
    list: () => withType(PLAN, BANCO_ACC, "LIABILITY"),
  },
];

describe.each(OBSOLETE_RETURN_LISTS)(
  "CloseCajaDialog — L-2: la cuenta de retorno elegida $when tras refrescar la lista",
  ({ list }) => {
    it("el combobox queda vacío e inválido y «Cerrar caja» queda DESHABILITADO", () => {
      const { account, refresh } = mountWithChosenReturnAccount();
      refresh(list());
      expect(account.value).toBe("");
      expect(account.getAttribute("aria-invalid")).toBe("true");
      expect(confirmButton().hasAttribute("disabled")).toBe(true);
    });

    it("hacer clic en «Cerrar caja» NO llama a closeCajaCajaAction y el diálogo sigue abierto", async () => {
      const { refresh } = mountWithChosenReturnAccount();
      refresh(list());
      fireEvent.click(confirmButton());
      await act(async () => {});
      expect(actions.closeCajaCajaAction).not.toHaveBeenCalled();
      expect(dialogIsOpen()).toBe(true);
      expect(onRefresh).not.toHaveBeenCalled();
    });
  }
);

describe("CloseCajaDialog — L-2: la lista se queda sin NINGUNA cuenta de retorno elegible", () => {
  it("solo la cuenta de la propia caja y títulos de Activo: aviso, campo deshabilitado, «Cerrar caja» deshabilitado y sin llamada", async () => {
    const { account, refresh } = mountWithChosenReturnAccount();
    refresh([
      ...ofType(PLAN, "ASSET").filter((a) => !a.isPostable),
      PLAN.find((a) => a.id === OWN_ACCOUNT_ID)!,
    ]);
    expect(screen.getByText(RETURN_WARNING)).toBeTruthy();
    expect(account.disabled).toBe(true);
    expect(confirmButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(confirmButton());
    await act(async () => {});
    expect(actions.closeCajaCajaAction).not.toHaveBeenCalled();
  });

  it("lista vacía: «Cerrar caja» deshabilitado y sin llamada", async () => {
    const { refresh } = mountWithChosenReturnAccount();
    refresh([]);
    expect(confirmButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(confirmButton());
    await act(async () => {});
    expect(actions.closeCajaCajaAction).not.toHaveBeenCalled();
  });
});

describe("CloseCajaDialog — L-2: lo que NO debe cambiar (guardas verdes que matan mutantes)", () => {
  it("un refresco que deja la cuenta elegida igual (objetos y arreglo nuevos): «Cerrar caja» sigue habilitado y envía su id", async () => {
    const { refresh } = mountWithChosenReturnAccount();
    refresh(PLAN.map((a) => ({ ...a })));
    expect(confirmButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(actions.closeCajaCajaAction).toHaveBeenCalledTimes(1));
    expect(actions.closeCajaCajaAction).toHaveBeenCalledWith({
      cajaCajaId: CAJA.id,
      companyId: COMPANY_ID,
      returnAccountId: BANCO_ACC.id,
    });
  });

  it("OTRA cuenta que pasa a título, desaparece o cambia de tipo NO invalida la elegida", async () => {
    const { account, refresh } = mountWithChosenReturnAccount();
    const caja001 = PLAN.find((a) => a.id === OWN_ACCOUNT_ID)!;
    const ventas = PLAN.find((a) => a.code === "4.1.01.01.001")!;
    refresh(withType(without(withTitle(PLAN, CAJA_CHICA_ACC), caja001), ventas, "ASSET"));
    expect(account.value).toBe(BANCO);
    expect(account.getAttribute("aria-invalid")).not.toBe("true");
    expect(confirmButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(actions.closeCajaCajaAction).toHaveBeenCalledTimes(1));
    expect(actions.closeCajaCajaAction.mock.calls[0][0].returnAccountId).toBe(BANCO_ACC.id);
  });
});

describe("CloseCajaDialog — L-2: recuperación tras un refresco que dejó la cuenta obsoleta", () => {
  it("si la cuenta vuelve a ser elegible en el siguiente refresco, «Cerrar caja» se rehabilita solo", async () => {
    const { refresh } = mountWithChosenReturnAccount();
    refresh(withTitle(PLAN, BANCO_ACC));
    expect(confirmButton().hasAttribute("disabled")).toBe(true);
    refresh([...PLAN]);
    expect(confirmButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(actions.closeCajaCajaAction).toHaveBeenCalledTimes(1));
    expect(actions.closeCajaCajaAction.mock.calls[0][0].returnAccountId).toBe(BANCO_ACC.id);
  });

  it("elegir OTRA cuenta vigente rehabilita «Cerrar caja» y envía la nueva, nunca la vieja", async () => {
    const { account, refresh } = mountWithChosenReturnAccount();
    refresh(withTitle(PLAN, BANCO_ACC));
    expect(confirmButton().hasAttribute("disabled")).toBe(true);
    pickByCode(account, "110101002");
    expect(account.value).toBe("1.1.01.01.002 — Caja Chica");
    expect(confirmButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(actions.closeCajaCajaAction).toHaveBeenCalledTimes(1));
    expect(actions.closeCajaCajaAction.mock.calls[0][0].returnAccountId).toBe(CAJA_CHICA_ACC.id);
  });
});
