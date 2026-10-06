// @vitest-environment jsdom
// src/modules/budgets/components/BudgetDetail.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase.
//
// SPEC-012 · ENTREGA B1 · paso 1 (modo RED) — «Nueva línea de presupuesto»: el selector de cuenta
// (`addAccountId`) pasa del <select> nativo a `AccountCombobox`.
//
// RN-19: `availableAccounts` (las cuentas que aún no están en el presupuesto) entrega al combobox
// títulos Y cuentas, pero el botón «Agregar cuenta» se desactiva cuando solo quedan TÍTULOS: contar
// títulos como disponibles dejaba abrir un formulario sin nada que elegir.
//
// El selector no tiene etiqueta visible hoy: se exige un nombre accesible no vacío (aria-label).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { BudgetDetail } from "./BudgetDetail";
import {
  MOVEMENTS,
  PLAN,
  TITLES,
  accessibleNames,
  expectAccountComboboxes,
  headerEl,
  labelOf,
  listedOptionLabels,
  movementLabels,
  openList,
  pickByCode,
  pressEveryHeader,
  stubJsdomForListbox,
  typeInto,
  visibleHeaderNames,
  type PlanAccount,
} from "@/__tests__/helpers/account-combobox-forms";

const {
  upsertBudgetLineAction,
  deleteBudgetLineAction,
  getBudgetVsActualAction,
  toastSuccess,
  toastError,
} = vi.hoisted(() => ({
  upsertBudgetLineAction: vi.fn(),
  deleteBudgetLineAction: vi.fn(),
  getBudgetVsActualAction: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../actions/budget.actions", () => ({
  upsertBudgetLineAction,
  deleteBudgetLineAction,
  getBudgetVsActualAction,
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
  Toaster: () => null,
}));

const COMPANY_ID = "company-1";
const CAJA_P = MOVEMENTS.find((a) => a.code === "1.1.01.01.001")!;
const CAJA_C = MOVEMENTS.find((a) => a.code === "1.1.01.01.002")!;

const lineOf = (a: PlanAccount) => ({
  id: `line-${a.id}`,
  budgetId: "budget-1",
  companyId: COMPANY_ID,
  accountId: a.id,
  amount: "1000.00",
  notes: null,
  account: { id: a.id, code: a.code, name: a.name, type: a.type },
});

function budgetWith(...used: PlanAccount[]) {
  return {
    id: "budget-1",
    companyId: COMPANY_ID,
    periodYear: 2026,
    name: "Presupuesto 2026",
    status: "DRAFT",
    createdBy: "user-1",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    lines: used.map(lineOf),
    totalAmount: "0.00",
  } as never;
}

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  upsertBudgetLineAction.mockImplementation(
    async (_companyId: string, _budgetId: string, input: { accountId: string; amount: string }) => {
      const account = PLAN.find((a) => a.id === input.accountId)!;
      return { success: true, data: { ...lineOf(account), amount: input.amount } };
    }
  );
});

afterEach(cleanup);

function renderDetail({
  accounts = PLAN as PlanAccount[],
  used = [] as PlanAccount[],
  canWrite = true,
  onBudgetUpdate = vi.fn<(updated: unknown) => void>(),
}: {
  accounts?: PlanAccount[];
  used?: PlanAccount[];
  canWrite?: boolean;
  onBudgetUpdate?: (updated: unknown) => void;
} = {}) {
  const utils = render(
    <BudgetDetail
      companyId={COMPANY_ID}
      budget={budgetWith(...used)}
      canWrite={canWrite}
      accounts={accounts}
      onBudgetUpdate={onBudgetUpdate}
    />
  );
  return { ...utils, onBudgetUpdate };
}

const addButton = () => screen.getByRole("button", { name: /Agregar cuenta/ });
const saveButton = () => screen.getByRole("button", { name: "Guardar" });
const amountInput = () => screen.getByLabelText("Importe anual en bolívares") as HTMLInputElement;

/** Abre «Agregar cuenta» y devuelve el combobox. */
function openAddForm(options?: Parameters<typeof renderDetail>[0]) {
  const utils = renderDetail(options);
  fireEvent.click(addButton());
  const [account] = expectAccountComboboxes(1, "Nueva línea de presupuesto");
  return { ...utils, account };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("BudgetDetail — el selector de cuenta es un AccountCombobox (SPEC-012 B1)", () => {
  it("«Agregar cuenta» abre un <input role=combobox>, ya no un <select> nativo", () => {
    const { account } = openAddForm();
    expect(account.tagName).toBe("INPUT");
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });

  it("D9: el selector tiene un nombre accesible (antes no tenía etiqueta)", () => {
    openAddForm();
    const names = accessibleNames();
    expect(names).toHaveLength(1);
    expect(names[0].trim()).not.toBe("");
  });

  it("empieza vacío y sin marcar como inválido", () => {
    const { account } = openAddForm();
    expect(account.value).toBe("");
    expect(account.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("sin permiso de escritura no hay formulario ni botón", () => {
    renderDetail({ canWrite: false });
    expect(screen.queryByRole("button", { name: /Agregar cuenta/ })).toBeNull();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("BudgetDetail — qué ofrece el selector", () => {
  it("todas las cuentas de movimiento y los títulos como encabezados", () => {
    const { account } = openAddForm();
    openList(account);
    expect(listedOptionLabels()).toEqual(movementLabels(PLAN));
    expect(visibleHeaderNames()).toEqual(TITLES.map((t) => t.name));
  });

  it("NO ofrece las cuentas que ya están en el presupuesto (ni siquiera tecleando su código)", () => {
    const { account } = openAddForm({ used: [CAJA_P] });
    openList(account);
    const offered = listedOptionLabels();
    expect(offered).not.toContain(labelOf(CAJA_P));
    expect(offered).toContain(labelOf(CAJA_C));
    expect(offered).toHaveLength(movementLabels(PLAN).length - 1);

    typeInto(account, "110101001");
    expect(listedOptionLabels()).toEqual([]);
    expect(document.body.textContent).toContain("No hay cuentas que coincidan");
  });

  it("al ofrecer solo lo disponible, los títulos de las cuentas ya usadas siguen como encabezados de sus hermanas", () => {
    const { account } = openAddForm({ used: [CAJA_P] });
    openList(account);
    expect(headerEl("CAJAS")).not.toBeNull(); // CAJAS sigue teniendo a Caja Chica debajo
  });

  it("si se usan TODAS las cuentas de un grupo, buscar por el nombre de su título (CAJAS) no ofrece nada de ese grupo", () => {
    const { account } = openAddForm({ used: [CAJA_P, CAJA_C] });
    fireEvent.focus(account);
    typeInto(account, "cajas");
    expect(listedOptionLabels()).toEqual([]);
    expect(document.body.textContent).toContain("No hay cuentas que coincidan");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("BudgetDetail — los títulos no se pueden elegir", () => {
  it("clic sobre los encabezados no cambia el valor y «Guardar» sigue deshabilitado aunque haya importe", () => {
    const { account } = openAddForm();
    pressEveryHeader(
      account,
      TITLES.map((t) => t.name)
    );
    fireEvent.blur(account);
    expect(account.value).toBe("");
    fireEvent.change(amountInput(), { target: { value: "1500,50" } });
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    expect(upsertBudgetLineAction).not.toHaveBeenCalled();
  });

  it("pulsar «Guardar» con solo un título «intentado» y un importe NO llama a la acción", async () => {
    const { account } = openAddForm();
    pressEveryHeader(account, ["CAJAS", "ACTIVO"]);
    fireEvent.blur(account);
    fireEvent.change(amountInput(), { target: { value: "1500,50" } });
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(upsertBudgetLineAction).not.toHaveBeenCalled();
  });

  it("teclear el código de un título con varias hijas: Enter elige la primera hija (la activa), jamás el título", () => {
    const { account } = openAddForm();
    pickByCode(account, "1.1.01.01"); // título CAJAS: hijas 001 y 002 → la primera es la activa
    expect(account.value).toBe(labelOf(CAJA_P));
    expect(account.value).not.toContain("CAJAS");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("BudgetDetail — guardar la línea (el payload NO cambia)", () => {
  it("elegir tecleando el código + Enter, importe y Guardar: upsertBudgetLineAction(companyId, budgetId, { accountId, amount, notes })", async () => {
    const { account } = openAddForm();
    pickByCode(account, "110102001");
    expect(account.value).toBe("1.1.01.02.001 — Banco Mercantil");
    fireEvent.change(amountInput(), { target: { value: "1500,50" } });
    fireEvent.change(screen.getByPlaceholderText("Notas (opcional)"), {
      target: { value: "Cuota anual" },
    });
    fireEvent.click(saveButton());
    await waitFor(() => expect(upsertBudgetLineAction).toHaveBeenCalledTimes(1));
    expect(upsertBudgetLineAction).toHaveBeenCalledWith(COMPANY_ID, "budget-1", {
      accountId: "m:1.1.01.02.001",
      amount: "1500.50",
      notes: "Cuota anual",
    });
  });

  it("sin notas, `notes` va undefined (como hoy)", async () => {
    const { account } = openAddForm();
    pickByCode(account, "110101001");
    fireEvent.change(amountInput(), { target: { value: "20.000,00" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(upsertBudgetLineAction).toHaveBeenCalledTimes(1));
    const input = upsertBudgetLineAction.mock.calls[0][2];
    expect(input.accountId).toBe("m:1.1.01.01.001");
    expect(input.amount).toBe("20000.00");
    expect(input.notes).toBeUndefined();
  });

  it("sin cuenta elegida «Guardar» está deshabilitado y no llama a la acción aunque haya importe", () => {
    openAddForm();
    fireEvent.change(amountInput(), { target: { value: "1500,50" } });
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(saveButton());
    expect(upsertBudgetLineAction).not.toHaveBeenCalled();
  });

  it("con cuenta pero sin importe «Guardar» sigue deshabilitado", () => {
    const { account } = openAddForm();
    pickByCode(account, "110102001");
    expect(saveButton().hasAttribute("disabled")).toBe(true);
  });

  it("éxito: toast, la línea aparece en la tabla, el formulario se cierra y avisa al padre", async () => {
    const { account, onBudgetUpdate } = openAddForm();
    pickByCode(account, "110102001");
    fireEvent.change(amountInput(), { target: { value: "1500,50" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Línea guardada"));
    expect(onBudgetUpdate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("1.1.01.02.001")).toBeTruthy();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  it("fallo del servidor: toast con el error y el formulario conserva la cuenta elegida", async () => {
    upsertBudgetLineAction.mockResolvedValue({ success: false, error: "Presupuesto cerrado" });
    const { account } = openAddForm();
    pickByCode(account, "110102001");
    fireEvent.change(amountInput(), { target: { value: "10,00" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Presupuesto cerrado"));
    expect(expectAccountComboboxes(1, "tras el error")[0].value).toBe(
      "1.1.01.02.001 — Banco Mercantil"
    );
  });

  it("cancelar descarta la cuenta elegida: al reabrir el formulario el campo está vacío", () => {
    const { account } = openAddForm();
    pickByCode(account, "110102001");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(addButton());
    expect(expectAccountComboboxes(1, "reabierto")[0].value).toBe("");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("BudgetDetail — RN-19: «Agregar cuenta» cuenta SOLO cuentas de movimiento", () => {
  it("con cuentas de movimiento disponibles el botón está habilitado", () => {
    renderDetail();
    expect(addButton().hasAttribute("disabled")).toBe(false);
  });

  it("si todas las cuentas de movimiento ya están en el presupuesto y solo quedan TÍTULOS, el botón está deshabilitado", () => {
    renderDetail({ used: [...MOVEMENTS] });
    expect(addButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(addButton());
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  it("un plan con solo títulos (ninguna cuenta de movimiento) deja el botón deshabilitado", () => {
    renderDetail({ accounts: [...TITLES] });
    expect(addButton().hasAttribute("disabled")).toBe(true);
  });

  it("una sola cuenta de movimiento disponible entre muchos títulos basta para habilitarlo", () => {
    renderDetail({ used: MOVEMENTS.filter((a) => a.id !== CAJA_C.id) });
    expect(addButton().hasAttribute("disabled")).toBe(false);
  });

  it("sin cuentas en la lista el botón está deshabilitado", () => {
    renderDetail({ accounts: [] });
    expect(addButton().hasAttribute("disabled")).toBe(true);
  });

  it("al guardar la ÚLTIMA cuenta de movimiento disponible el botón vuelve a deshabilitarse (quedan solo títulos)", async () => {
    const { account } = openAddForm({ used: MOVEMENTS.filter((a) => a.id !== CAJA_C.id) });
    pickByCode(account, "110101002");
    fireEvent.change(amountInput(), { target: { value: "5,00" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Línea guardada"));
    await waitFor(() => expect(addButton().hasAttribute("disabled")).toBe(true));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// L-2 (revisión de seguridad de la Entrega B1) — TDD SPEC, modo RED: la cuenta elegida se REVALIDA con
// la lista vigente.
//
// Hoy «Guardar» solo mira `!addAccountId`. Si tras un refresco de `accounts` la cuenta elegida deja de
// ser elegible (otro usuario la convirtió en título, es decir `isPostable: false`, o ya no está en la
// lista) el combobox se ve vacío e inválido pero «Guardar» sigue activo y envía el id viejo.
// Contrato: la guarda del envío Y el `disabled` del botón usan `isSelectableAccountId(accounts, id)`
// (de `@/lib/account-search`): con la cuenta ya no elegible el botón queda DESHABILITADO y NO se llama
// a `upsertBudgetLineAction`.
//
// El refresco se simula con `rerender` sobre la MISMA instancia (así el estado `addAccountId` sobrevive)
// y con el MISMO objeto `budget` (otro objeto reiniciaría las líneas por el efecto de `budget.lines`).
// Un botón deshabilitado no dispara `onClick` en React: por eso «no se llama a la acción» y «deshabilitado»
// se afirman por separado pero la guarda dentro del manejador no se puede aislar del `disabled` aquí.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
const BANCO = PLAN.find((a) => a.code === "1.1.01.02.001")!;
const asTitle = (a: PlanAccount): PlanAccount => ({ ...a, isPostable: false });
/** La lista con `target` convertida en título (`isPostable: false`). */
const withTitle = (list: readonly PlanAccount[], target: PlanAccount): PlanAccount[] =>
  list.map((a) => (a.id === target.id ? asTitle(a) : a));
/** La lista sin `target`. */
const without = (list: readonly PlanAccount[], target: PlanAccount): PlanAccount[] =>
  list.filter((a) => a.id !== target.id);

/**
 * Monta el detalle, abre «Agregar cuenta», elige BANCO tecleando su código y completa el importe:
 * «Guardar» queda habilitado (se comprueba). `refresh(lista)` = el padre entrega una lista nueva.
 */
function mountWithChosenAccount() {
  const budget = budgetWith();
  const onBudgetUpdate = vi.fn();
  const element = (accounts: PlanAccount[]) => (
    <BudgetDetail
      companyId={COMPANY_ID}
      budget={budget}
      canWrite
      accounts={accounts}
      onBudgetUpdate={onBudgetUpdate}
    />
  );
  const utils = render(element([...PLAN]));
  fireEvent.click(addButton());
  const [account] = expectAccountComboboxes(1, "Nueva línea de presupuesto");
  pickByCode(account, "110102001");
  expect(account.value).toBe(labelOf(BANCO));
  fireEvent.change(amountInput(), { target: { value: "1500,50" } });
  expect(saveButton().hasAttribute("disabled")).toBe(false); // precondición: así SÍ se podría guardar
  return {
    account,
    refresh: (accounts: PlanAccount[]) => utils.rerender(element(accounts)),
  };
}

const OBSOLETE_LISTS = [
  { when: "pasa a ser un TÍTULO", list: () => withTitle(PLAN, BANCO) },
  { when: "YA NO ESTÁ en la lista", list: () => without(PLAN, BANCO) },
];

describe.each(OBSOLETE_LISTS)(
  "BudgetDetail — L-2: la cuenta elegida $when tras refrescar la lista",
  ({ list }) => {
    it("el combobox queda vacío e inválido y «Guardar» queda DESHABILITADO", () => {
      const { account, refresh } = mountWithChosenAccount();
      refresh(list());
      expect(account.value).toBe("");
      expect(account.getAttribute("aria-invalid")).toBe("true");
      expect(saveButton().hasAttribute("disabled")).toBe(true);
    });

    it("hacer clic en «Guardar» NO llama a upsertBudgetLineAction ni avisa de éxito", async () => {
      const { refresh } = mountWithChosenAccount();
      refresh(list());
      fireEvent.click(saveButton());
      await act(async () => {});
      expect(upsertBudgetLineAction).not.toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();
    });
  }
);

describe("BudgetDetail — L-2: la lista se queda sin NINGUNA cuenta de movimiento", () => {
  it("con solo títulos «Guardar» queda deshabilitado (el campo también) y no se llama a la acción", async () => {
    const { account, refresh } = mountWithChosenAccount();
    refresh([...TITLES]);
    expect(account.disabled).toBe(true);
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(upsertBudgetLineAction).not.toHaveBeenCalled();
  });

  it("con la lista vacía «Guardar» queda deshabilitado y no se llama a la acción", async () => {
    const { refresh } = mountWithChosenAccount();
    refresh([]);
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(saveButton());
    await act(async () => {});
    expect(upsertBudgetLineAction).not.toHaveBeenCalled();
  });
});

describe("BudgetDetail — L-2: lo que NO debe cambiar (guardas verdes que matan mutantes)", () => {
  it("un refresco que deja la cuenta elegida igual (objetos y arreglo nuevos): «Guardar» sigue habilitado y envía su id", async () => {
    const { refresh } = mountWithChosenAccount();
    refresh(PLAN.map((a) => ({ ...a })));
    expect(saveButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(upsertBudgetLineAction).toHaveBeenCalledTimes(1));
    expect(upsertBudgetLineAction.mock.calls[0][2].accountId).toBe(BANCO.id);
  });

  it("OTRA cuenta que pasa a título o desaparece NO invalida la elegida: «Guardar» sigue habilitado", async () => {
    const { account, refresh } = mountWithChosenAccount();
    refresh(without(withTitle(PLAN, CAJA_C), CAJA_P));
    expect(account.value).toBe(labelOf(BANCO));
    expect(account.getAttribute("aria-invalid")).not.toBe("true");
    expect(saveButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(upsertBudgetLineAction).toHaveBeenCalledTimes(1));
    expect(upsertBudgetLineAction.mock.calls[0][2].accountId).toBe(BANCO.id);
  });
});

describe("BudgetDetail — L-2: recuperación tras un refresco que dejó la cuenta obsoleta", () => {
  it("si la cuenta vuelve a ser elegible en el siguiente refresco, «Guardar» se rehabilita solo", async () => {
    const { refresh } = mountWithChosenAccount();
    refresh(withTitle(PLAN, BANCO));
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    refresh([...PLAN]);
    expect(saveButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(upsertBudgetLineAction).toHaveBeenCalledTimes(1));
    expect(upsertBudgetLineAction.mock.calls[0][2].accountId).toBe(BANCO.id);
  });

  it("elegir OTRA cuenta vigente rehabilita «Guardar» y envía la nueva, nunca la vieja", async () => {
    const { account, refresh } = mountWithChosenAccount();
    refresh(withTitle(PLAN, BANCO));
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    pickByCode(account, "110101001");
    expect(account.value).toBe(labelOf(CAJA_P));
    expect(saveButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(upsertBudgetLineAction).toHaveBeenCalledTimes(1));
    expect(upsertBudgetLineAction.mock.calls[0][2].accountId).toBe(CAJA_P.id);
  });
});
