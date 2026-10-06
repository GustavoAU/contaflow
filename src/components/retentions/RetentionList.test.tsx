// @vitest-environment jsdom
// src/components/retentions/RetentionList.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase.
//
// SPEC-012 · ENTREGA B1 · paso 1 (modo RED) — «Enterar retención» (`EnterRetentionModal`, dentro de
// RetentionList): los dos selectores de cuenta (`liabilityAccountId` PASIVO y `bankAccountId`
// ACTIVO) pasan del <select> nativo a `AccountCombobox`.
//
// Cubre: dos <input role="combobox"> con etiqueta asociada; cada uno ofrece SOLO su tipo y muestra
// los títulos como encabezados NO elegibles; elegir tecleando el código + Enter; envío sin cuenta no
// llama a la acción; payload sin cambios; sin `required` nativo; RN-19 (sin cuentas de movimiento del
// tipo → campo deshabilitado y envío bloqueado).
//
// Las cuentas las carga `getAccountsForEnteramientoAction` (mock); el tipo `AccountOption` de esa
// acción lleva `isPostable` tras B1.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { RetentionList } from "./RetentionList";
import {
  PLAN,
  accessibleNames,
  accountErrorShown,
  expectAccountComboboxes,
  headerEl,
  labelOf,
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

const {
  enterRetentionAction,
  exportRetentionVoucherPDFAction,
  getAccountsForEnteramientoAction,
  toastSuccess,
  toastError,
} = vi.hoisted(() => ({
  enterRetentionAction: vi.fn(),
  exportRetentionVoucherPDFAction: vi.fn(),
  getAccountsForEnteramientoAction: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/modules/retentions/actions/retention.actions", () => ({
  enterRetentionAction,
  exportRetentionVoucherPDFAction,
  getAccountsForEnteramientoAction,
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
  Toaster: () => null,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────

const COMPANY_ID = "company-1";
const RETENTION = {
  id: "ret-1",
  providerName: "Proveedor Uno C.A.",
  providerRif: "J-12345678-9",
  invoiceNumber: "FAC-0001",
  invoiceDate: new Date("2026-09-15"),
  invoiceAmount: "1000.00",
  ivaRetention: "120.00",
  islrAmount: null,
  incesAmount: null,
  fatAmount: null,
  totalRetention: "120.00",
  voucherNumber: "20260900000001",
  islrVoucherNumber: null,
  type: "IVA",
  status: "PENDING",
  enteradoAt: null,
  createdAt: new Date("2026-09-16"),
};

/** Lo que devuelve la acción: solo ACTIVO y PASIVO (títulos Y cuentas de movimiento). */
const ENTERAMIENTO_ACCOUNTS: PlanAccount[] = ofType(PLAN, "ASSET", "LIABILITY");
const PASIVO_MOV = "2.1.01.01.001 — Retenciones por Pagar";
const PASIVO_ID = "m:2.1.01.01.001";
const BANCO_ID = "m:1.1.01.02.001";
const ASSET_LABELS = movementLabels(ofType(PLAN, "ASSET"));

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  getAccountsForEnteramientoAction.mockResolvedValue({
    success: true,
    data: ENTERAMIENTO_ACCOUNTS,
  });
  enterRetentionAction.mockResolvedValue({ success: true, data: undefined });
});

afterEach(cleanup);

// ─── Helpers de render ───────────────────────────────────────────────────────────────────────────

/** Abre el formulario «Enterar» y espera a que la acción de cuentas haya resuelto. */
async function openEnterForm(accounts: PlanAccount[] = ENTERAMIENTO_ACCOUNTS) {
  getAccountsForEnteramientoAction.mockResolvedValue({ success: true, data: accounts });
  render(<RetentionList companyId={COMPANY_ID} retentions={[RETENTION]} />);
  fireEvent.click(screen.getByRole("button", { name: "Enterar" }));
  await waitFor(() => expect(getAccountsForEnteramientoAction).toHaveBeenCalledWith(COMPANY_ID));
  await act(async () => {});
}

const submitButton = () => screen.getByRole("button", { name: /Confirmar Enteramiento/ });

function comboboxes() {
  const [liability, bank] = expectAccountComboboxes(2, "Enterar retención");
  return { liability, bank };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("RetentionList · Enterar — los dos selectores son AccountCombobox (SPEC-012 B1)", () => {
  it("no queda ningún <select> nativo para las cuentas: son dos <input role=combobox>", async () => {
    await openEnterForm();
    comboboxes();
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });

  it("D9: cada selector tiene su etiqueta asociada (htmlFor + id) y un nombre accesible distinto", async () => {
    await openEnterForm();
    const { liability, bank } = comboboxes();
    expect(screen.getByLabelText(/Cuenta Retenciones por Pagar/)).toBe(liability);
    expect(screen.getByLabelText(/Cuenta Banco \/ Caja/)).toBe(bank);
    const names = accessibleNames();
    expect(names).toHaveLength(2);
    expect(names.every((n) => n.trim() !== "")).toBe(true);
    expect(new Set(names).size).toBe(2);
  });

  it("el `required` nativo desaparece: la validación es del formulario (el combobox es un <input type=text>)", async () => {
    await openEnterForm();
    const { liability, bank } = comboboxes();
    expect(liability.required).toBe(false);
    expect(bank.required).toBe(false);
  });

  it("empiezan sin cuenta elegida y sin marcar como inválidos", async () => {
    await openEnterForm();
    const { liability, bank } = comboboxes();
    expect(liability.value).toBe("");
    expect(bank.value).toBe("");
    expect(liability.getAttribute("aria-invalid")).not.toBe("true");
    expect(bank.getAttribute("aria-invalid")).not.toBe("true");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("RetentionList · Enterar — qué ofrece cada selector (el filtro por tipo se mantiene)", () => {
  it("Pasivo: SOLO la cuenta de movimiento de tipo LIABILITY, bajo sus títulos como encabezados", async () => {
    await openEnterForm();
    const { liability } = comboboxes();
    openList(liability);
    expect(listedOptionLabels()).toEqual([PASIVO_MOV]);
    expect(visibleHeaderNames()).toEqual(["PASIVO", "EXIGIBLE", "OBLIGACIONES", "RETENCIONES"]);
  });

  it("Banco/Caja: SOLO cuentas de movimiento de tipo ASSET, con sus títulos como encabezados", async () => {
    await openEnterForm();
    const { bank } = comboboxes();
    openList(bank);
    expect(listedOptionLabels()).toEqual(ASSET_LABELS);
    expect(visibleHeaderNames()).toEqual(["ACTIVO", "CORRIENTE", "DISPONIBLE", "CAJAS", "BANCOS"]);
  });

  it("un gasto o un patrimonio que llegara en la lista no se ofrece en ninguno de los dos", async () => {
    await openEnterForm([...ENTERAMIENTO_ACCOUNTS, ...ofType(PLAN, "EXPENSE", "EQUITY")]);
    const { liability, bank } = comboboxes();
    for (const input of [liability, bank]) {
      openList(input);
      const offered = listedOptionLabels();
      expect(offered.join("|")).not.toContain("Gastos de Viaje");
      expect(offered.join("|")).not.toContain("Capital Social");
      expect(visibleHeaderNames()).not.toContain("GASTOS");
      expect(visibleHeaderNames()).not.toContain("PATRIMONIO");
      fireEvent.blur(input);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("RetentionList · Enterar — los títulos no se pueden elegir (CA-9 / RN-8)", () => {
  it("clic sobre cada encabezado del selector de Pasivo no cambia el valor y el envío sigue bloqueado", async () => {
    await openEnterForm();
    const { liability } = comboboxes();
    pressEveryHeader(liability, ["PASIVO", "EXIGIBLE", "OBLIGACIONES", "RETENCIONES"]);
    expect(liability.value).toBe("");
    fireEvent.blur(liability);
    expect(liability.value).toBe("");
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(enterRetentionAction).not.toHaveBeenCalled();
  });

  it("clic sobre cada encabezado del selector de Banco/Caja no cambia el valor", async () => {
    await openEnterForm();
    const { bank } = comboboxes();
    pressEveryHeader(bank, ["ACTIVO", "CORRIENTE", "DISPONIBLE", "CAJAS", "BANCOS"]);
    fireEvent.blur(bank);
    expect(bank.value).toBe("");
    expect(enterRetentionAction).not.toHaveBeenCalled();
  });

  it("teclear el código de un TÍTULO elige, con Enter, la cuenta de movimiento de abajo, nunca el título", async () => {
    await openEnterForm();
    const { liability } = comboboxes();
    // 2.1.01.01 = título RETENCIONES: tiene UNA sola cuenta de movimiento debajo.
    pickByCode(liability, "2.1.01.01");
    expect(liability.value).toBe(PASIVO_MOV);
  });

  it("ningún camino deja el id de un título en el payload", async () => {
    await openEnterForm();
    const { liability, bank } = comboboxes();
    pressEveryHeader(liability, ["PASIVO", "RETENCIONES"]);
    pickByCode(liability, "210101001");
    pressEveryHeader(bank, ["BANCOS", "CAJAS"]);
    pickByCode(bank, "110102001");
    fireEvent.click(submitButton());
    await waitFor(() => expect(enterRetentionAction).toHaveBeenCalledTimes(1));
    const payload = enterRetentionAction.mock.calls[0][0] as Record<string, unknown>;
    expect(String(payload.liabilityAccountId).startsWith("t:")).toBe(false);
    expect(String(payload.bankAccountId).startsWith("t:")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("RetentionList · Enterar — elegir y enviar (el payload NO cambia)", () => {
  it("elegir tecleando el código + Enter: muestra «código — nombre» en cada campo", async () => {
    await openEnterForm();
    const { liability, bank } = comboboxes();
    pickByCode(liability, "210101001");
    pickByCode(bank, "110102001");
    expect(liability.value).toBe(PASIVO_MOV);
    expect(bank.value).toBe("1.1.01.02.001 — Banco Mercantil");
  });

  it("los dos selectores son independientes: elegir uno no cambia el otro", async () => {
    await openEnterForm();
    const { liability, bank } = comboboxes();
    pickByCode(bank, "1.1.01.01.002");
    expect(bank.value).toBe("1.1.01.01.002 — Caja Chica");
    expect(liability.value).toBe("");
    pickByCode(liability, "2.1.01.01.001");
    expect(bank.value).toBe("1.1.01.01.002 — Caja Chica");
  });

  it("el envío llama enterRetentionAction con los MISMOS campos de antes y los ids de las dos cuentas", async () => {
    await openEnterForm();
    const { liability, bank } = comboboxes();
    pickByCode(liability, "210101001");
    pickByCode(bank, "110102001");
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, {
      target: { value: "2026-10-05" },
    });
    expect(submitButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(submitButton());
    await waitFor(() => expect(enterRetentionAction).toHaveBeenCalledTimes(1));
    const payload = enterRetentionAction.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "bankAccountId",
      "companyId",
      "enterDate",
      "liabilityAccountId",
      "retentionId",
    ]);
    expect(payload).toMatchObject({
      retentionId: RETENTION.id,
      companyId: COMPANY_ID,
      liabilityAccountId: PASIVO_ID,
      bankAccountId: BANCO_ID,
    });
    expect(payload.enterDate).toEqual(new Date("2026-10-05"));
  });

  it("éxito: avisa, cierra el formulario y la tarjeta pasa a «Enterada»", async () => {
    await openEnterForm();
    const { liability, bank } = comboboxes();
    pickByCode(liability, "210101001");
    pickByCode(bank, "110101001");
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Retención enterada correctamente")
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Confirmar Enteramiento/ })).toBeNull()
    );
    expect(screen.getByText("Enterada")).toBeTruthy();
  });

  it("fallo del servidor: toast con el error y el formulario conserva las cuentas elegidas", async () => {
    enterRetentionAction.mockResolvedValue({ success: false, error: "Período cerrado" });
    await openEnterForm();
    const { liability, bank } = comboboxes();
    pickByCode(liability, "210101001");
    pickByCode(bank, "110101001");
    fireEvent.click(submitButton());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Período cerrado"));
    const after = comboboxes();
    expect(after.liability.value).toBe(PASIVO_MOV);
    expect(after.bank.value).toBe("1.1.01.01.001 — Caja Principal");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("RetentionList · Enterar — sin cuenta no se llama a la acción (el `required` nativo ya no existe)", () => {
  it("sin ninguna cuenta: el envío queda bloqueado (botón deshabilitado o error visible) y no llama a la acción", async () => {
    await openEnterForm();
    const before = snapshotTexts();
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(enterRetentionAction).not.toHaveBeenCalled();
    expect(submitButton().hasAttribute("disabled") || accountErrorShown(before, toastError)).toBe(
      true
    );
  });

  it("solo el Pasivo elegido: no llama a la acción", async () => {
    await openEnterForm();
    const { liability } = comboboxes();
    pickByCode(liability, "210101001");
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(enterRetentionAction).not.toHaveBeenCalled();
  });

  it("solo el Banco elegido: no llama a la acción", async () => {
    await openEnterForm();
    const { bank } = comboboxes();
    pickByCode(bank, "110102001");
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(enterRetentionAction).not.toHaveBeenCalled();
  });

  it("enviar el formulario directamente (Enter con la lista cerrada) sin cuentas tampoco llama a la acción", async () => {
    await openEnterForm();
    const form = document.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);
    await act(async () => {});
    expect(enterRetentionAction).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("RetentionList · Enterar — RN-19: solo cuentas de movimiento cuentan", () => {
  it("Pasivo con SOLO títulos (ninguna cuenta de movimiento): el campo queda deshabilitado y no hay nada que elegir", async () => {
    const soloTitulosPasivo = [
      ...ofType(PLAN, "ASSET"),
      titleAcc("2", "PASIVO", "LIABILITY"),
      titleAcc("2.1", "EXIGIBLE", "LIABILITY"),
    ];
    await openEnterForm(soloTitulosPasivo);
    const { liability, bank } = comboboxes();
    expect(liability.disabled).toBe(true);
    expect(bank.disabled).toBe(false);
    fireEvent.click(liability);
    expect(listedOptionLabels()).toEqual([]);
  });

  it("con Pasivo solo-títulos aunque se elija el Banco, el envío no llama a la acción", async () => {
    await openEnterForm([
      ...ofType(PLAN, "ASSET"),
      titleAcc("2", "PASIVO", "LIABILITY"),
      titleAcc("2.1", "EXIGIBLE", "LIABILITY"),
    ]);
    const { bank } = comboboxes();
    pickByCode(bank, "110102001");
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(enterRetentionAction).not.toHaveBeenCalled();
  });

  it("Banco/Caja con solo títulos de Activo: campo deshabilitado", async () => {
    await openEnterForm([
      ...ofType(PLAN, "LIABILITY"),
      titleAcc("1", "ACTIVO", "ASSET"),
      titleAcc("1.1", "CORRIENTE", "ASSET"),
    ]);
    const { liability, bank } = comboboxes();
    expect(bank.disabled).toBe(true);
    expect(liability.disabled).toBe(false);
  });

  it("un título con código «mejor» que la cuenta real (va primero y coincide con lo tecleado) no se elige con Enter", async () => {
    const plan: PlanAccount[] = [
      titleAcc("2", "PASIVO", "LIABILITY"),
      titleAcc("2.1.01.01", "RETENCIONES", "LIABILITY"),
      moveAcc("2.1.01.01.001", "Retenciones por Pagar", "LIABILITY"),
      ...ofType(PLAN, "ASSET"),
    ];
    await openEnterForm(plan);
    const { liability } = comboboxes();
    pickByCode(liability, "2.1.01.01");
    expect(liability.value).toBe(labelOf(plan[2]));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("RetentionList · Enterar — filtrar y navegar (el selector es el buscable)", () => {
  it("teclear parte del nombre filtra: «mercantil» deja solo Banco Mercantil bajo sus encabezados", async () => {
    await openEnterForm();
    const { bank } = comboboxes();
    fireEvent.focus(bank);
    typeInto(bank, "mercantil");
    expect(listedOptionLabels()).toEqual(["1.1.01.02.001 — Banco Mercantil"]);
    expect(headerEl("BANCOS")).not.toBeNull();
    expect(headerEl("CAJAS")).toBeNull();
  });
});

describe("RetentionList · Enterar — mientras se cargan las cuentas (loading)", () => {
  it("los dos campos salen deshabilitados con «Cargando cuentas…» y se habilitan al llegar las cuentas", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((r) => {
      resolve = r;
    });
    getAccountsForEnteramientoAction.mockReturnValue(pending);
    render(<RetentionList companyId={COMPANY_ID} retentions={[RETENTION]} />);
    fireEvent.click(screen.getByRole("button", { name: "Enterar" }));
    await waitFor(() => expect(getAccountsForEnteramientoAction).toHaveBeenCalledWith(COMPANY_ID));

    const { liability, bank } = comboboxes();
    for (const field of [liability, bank]) {
      expect(field.disabled).toBe(true);
      expect(field.getAttribute("aria-busy")).toBe("true");
      expect(field.placeholder).toBe("Cargando cuentas…");
    }
    expect(screen.queryByText("No hay cuentas disponibles")).toBeNull();

    await act(async () => {
      resolve({ success: true, data: ENTERAMIENTO_ACCOUNTS });
    });
    for (const field of [comboboxes().liability, comboboxes().bank]) {
      expect(field.disabled).toBe(false);
      expect(field.getAttribute("aria-busy")).toBeNull();
    }
  });

  it("si la carga falla, termina el «Cargando…» y los campos quedan sin cuentas (no se quedan cargando para siempre)", async () => {
    getAccountsForEnteramientoAction.mockResolvedValue({ success: false, error: "Sin permiso" });
    render(<RetentionList companyId={COMPANY_ID} retentions={[RETENTION]} />);
    fireEvent.click(screen.getByRole("button", { name: "Enterar" }));
    await waitFor(() => expect(getAccountsForEnteramientoAction).toHaveBeenCalledWith(COMPANY_ID));
    await act(async () => {});

    const { liability, bank } = comboboxes();
    for (const field of [liability, bank]) {
      expect(field.getAttribute("aria-busy")).toBeNull();
      expect(field.placeholder).not.toBe("Cargando cuentas…");
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// L-2 (revisión de seguridad de la Entrega B1) — TDD SPEC, modo RED: las cuentas elegidas se REVALIDAN
// con las listas vigentes.
//
// Hoy el envío solo mira `!liabilityAccountId || !bankAccountId`. Si las cuentas cargadas se
// reemplazan (otro usuario convirtió la elegida en título, o ya no está en la lista) el combobox se ve
// vacío e inválido pero el botón sigue activo y `enterRetentionAction` recibe el id viejo.
// Contrato: la guarda del envío Y el `disabled` usan `isSelectableAccountId(liabilityAccounts, id)` y
// `isSelectableAccountId(bankAccounts, id)` (las listas por tipo que ve cada selector). Con una de las
// dos cuentas ya no elegible el botón queda DESHABILITADO y NO se llama a `enterRetentionAction`.
//
// CÓMO SE PROVOCA EL REFRESCO (decisión declarada en el reporte): dentro de RetentionList las cuentas
// se cargan UNA vez, en un `useEffect` que depende de `companyId`, y no hay otro refresco. La única
// forma de que `accounts` se reemplace con el formulario ya abierto es cambiar el prop `companyId` con
// `rerender`: el efecto vuelve a pedir las cuentas, el mock devuelve la lista nueva, y los estados
// `liabilityAccountId` / `bankAccountId` (que NO se reinician) quedan apuntando a cuentas de la lista
// anterior. Es indirecto (en producción Next remonta al cambiar de empresa) pero ejercita el MISMO
// camino de código —`setAccounts` con una lista que ya no contiene lo elegido— y, de paso, es el peor
// caso (ids de otra empresa viajando con el `companyId` nuevo).
//
// El envío se prueba de dos formas: con el clic en el botón (`disabled`) y con `fireEvent.submit(form)`,
// que se salta el `disabled` y por tanto aísla la guarda DENTRO de `handleSubmit`.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
const OTHER_COMPANY_ID = "company-2";
const BANCO_ACC = PLAN.find((a) => a.id === BANCO_ID)!;
const PASIVO_ACC = PLAN.find((a) => a.id === PASIVO_ID)!;
const CAJA_P_ACC = PLAN.find((a) => a.id === "m:1.1.01.01.001")!;
const CAJA_C_ACC = PLAN.find((a) => a.id === "m:1.1.01.01.002")!;

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
 * Abre «Enterar», elige Pasivo (Retenciones por Pagar) y Banco (Banco Mercantil) tecleando su código:
 * el envío queda habilitado (se comprueba). `refresh(lista)` = las cuentas se vuelven a cargar y la
 * acción devuelve `lista` (ver el comentario de arriba sobre cómo se provoca).
 */
async function mountWithChosenAccounts() {
  const utils = render(<RetentionList companyId={COMPANY_ID} retentions={[RETENTION]} />);
  fireEvent.click(screen.getByRole("button", { name: "Enterar" }));
  await waitFor(() => expect(getAccountsForEnteramientoAction).toHaveBeenCalledWith(COMPANY_ID));
  await act(async () => {});
  const { liability, bank } = comboboxes();
  pickByCode(liability, "210101001");
  pickByCode(bank, "110102001");
  expect(liability.value).toBe(PASIVO_MOV);
  expect(bank.value).toBe("1.1.01.02.001 — Banco Mercantil");
  expect(submitButton().hasAttribute("disabled")).toBe(false); // precondición: así SÍ se podría enviar
  // El efecto solo se repite si CAMBIA `companyId`: cada recarga alterna entre las dos empresas
  // (la 1.ª usa OTHER_COMPANY_ID, la 2.ª vuelve a COMPANY_ID, y así).
  let reloads = 0;
  return {
    liability,
    bank,
    refresh: async (accounts: PlanAccount[]) => {
      const companyId = reloads++ % 2 === 0 ? OTHER_COMPANY_ID : COMPANY_ID;
      getAccountsForEnteramientoAction.mockResolvedValue({ success: true, data: accounts });
      utils.rerender(<RetentionList companyId={companyId} retentions={[RETENTION]} />);
      await waitFor(() =>
        expect(getAccountsForEnteramientoAction).toHaveBeenLastCalledWith(companyId)
      );
      await act(async () => {}); // deja que `setAccounts` aplique la lista nueva
    },
  };
}

const submitForm = () => fireEvent.submit(document.querySelector("form") as HTMLFormElement);

const OBSOLETE_LIABILITY = [
  {
    when: "pasa a ser un TÍTULO",
    // `withTitle` deja el Pasivo sin cuentas de movimiento: el campo queda deshabilitado, aun así el id
    // viejo seguía en el estado.
    list: () => withTitle(ENTERAMIENTO_ACCOUNTS, PASIVO_ACC),
  },
  { when: "YA NO ESTÁ en la lista", list: () => without(ENTERAMIENTO_ACCOUNTS, PASIVO_ACC) },
  {
    when: "deja de ser de PASIVO (ya no está en la lista del selector)",
    list: () => withType(ENTERAMIENTO_ACCOUNTS, PASIVO_ACC, "EXPENSE"),
  },
];
const OBSOLETE_BANK = [
  { when: "pasa a ser un TÍTULO", list: () => withTitle(ENTERAMIENTO_ACCOUNTS, BANCO_ACC) },
  { when: "YA NO ESTÁ en la lista", list: () => without(ENTERAMIENTO_ACCOUNTS, BANCO_ACC) },
  {
    when: "deja de ser de ACTIVO (ya no está en la lista del selector)",
    list: () => withType(ENTERAMIENTO_ACCOUNTS, BANCO_ACC, "LIABILITY"),
  },
];

describe.each(OBSOLETE_LIABILITY)(
  "RetentionList · Enterar — L-2: la cuenta de Pasivo elegida $when tras recargar las cuentas",
  ({ list }) => {
    it("el combobox de Pasivo queda vacío e inválido y «Confirmar Enteramiento» queda DESHABILITADO", async () => {
      const { liability, bank, refresh } = await mountWithChosenAccounts();
      await refresh(list());
      expect(liability.value).toBe("");
      expect(liability.getAttribute("aria-invalid")).toBe("true");
      expect(bank.value).toBe("1.1.01.02.001 — Banco Mercantil"); // el Banco sigue vigente
      expect(submitButton().hasAttribute("disabled")).toBe(true);
    });

    it("ni el clic ni el envío del formulario llaman a enterRetentionAction", async () => {
      const { refresh } = await mountWithChosenAccounts();
      await refresh(list());
      fireEvent.click(submitButton());
      submitForm(); // se salta el `disabled`: aísla la guarda de `handleSubmit`
      await act(async () => {});
      expect(enterRetentionAction).not.toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();
    });
  }
);

describe.each(OBSOLETE_BANK)(
  "RetentionList · Enterar — L-2: la cuenta de Banco/Caja elegida $when tras recargar las cuentas",
  ({ list }) => {
    it("el combobox de Banco/Caja queda vacío e inválido y «Confirmar Enteramiento» queda DESHABILITADO", async () => {
      const { liability, bank, refresh } = await mountWithChosenAccounts();
      await refresh(list());
      expect(bank.value).toBe("");
      expect(bank.getAttribute("aria-invalid")).toBe("true");
      expect(liability.value).toBe(PASIVO_MOV); // el Pasivo sigue vigente
      expect(submitButton().hasAttribute("disabled")).toBe(true);
    });

    it("ni el clic ni el envío del formulario llaman a enterRetentionAction", async () => {
      const { refresh } = await mountWithChosenAccounts();
      await refresh(list());
      fireEvent.click(submitButton());
      submitForm();
      await act(async () => {});
      expect(enterRetentionAction).not.toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();
    });
  }
);

describe("RetentionList · Enterar — L-2: lo que NO debe cambiar (guardas verdes que matan mutantes)", () => {
  it("recargar las cuentas sin tocar las elegidas (objetos y arreglo nuevos): el envío sigue habilitado y lleva los mismos ids", async () => {
    const { refresh } = await mountWithChosenAccounts();
    await refresh(ENTERAMIENTO_ACCOUNTS.map((a) => ({ ...a })));
    expect(submitButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(submitButton());
    await waitFor(() => expect(enterRetentionAction).toHaveBeenCalledTimes(1));
    expect(enterRetentionAction.mock.calls[0][0]).toMatchObject({
      companyId: OTHER_COMPANY_ID,
      liabilityAccountId: PASIVO_ID,
      bankAccountId: BANCO_ID,
    });
  });

  it("OTRAS cuentas que pasan a título o desaparecen NO invalidan las elegidas", async () => {
    const { liability, bank, refresh } = await mountWithChosenAccounts();
    await refresh(without(withTitle(ENTERAMIENTO_ACCOUNTS, CAJA_P_ACC), CAJA_C_ACC));
    expect(liability.value).toBe(PASIVO_MOV);
    expect(bank.value).toBe("1.1.01.02.001 — Banco Mercantil");
    expect(submitButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(submitButton());
    await waitFor(() => expect(enterRetentionAction).toHaveBeenCalledTimes(1));
    expect(enterRetentionAction.mock.calls[0][0]).toMatchObject({
      liabilityAccountId: PASIVO_ID,
      bankAccountId: BANCO_ID,
    });
  });
});

describe("RetentionList · Enterar — L-2: recuperación tras recargar con una cuenta obsoleta", () => {
  it("si la cuenta vuelve a ser elegible en la siguiente recarga, el envío se rehabilita solo", async () => {
    const { refresh } = await mountWithChosenAccounts();
    await refresh(withTitle(ENTERAMIENTO_ACCOUNTS, BANCO_ACC));
    expect(submitButton().hasAttribute("disabled")).toBe(true);
    await refresh(ENTERAMIENTO_ACCOUNTS);
    expect(submitButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(submitButton());
    await waitFor(() => expect(enterRetentionAction).toHaveBeenCalledTimes(1));
    expect(enterRetentionAction.mock.calls[0][0]).toMatchObject({
      liabilityAccountId: PASIVO_ID,
      bankAccountId: BANCO_ID,
    });
  });

  it("elegir OTRA cuenta de Banco/Caja vigente rehabilita el envío y envía la nueva, nunca la vieja", async () => {
    const { bank, refresh } = await mountWithChosenAccounts();
    await refresh(withTitle(ENTERAMIENTO_ACCOUNTS, BANCO_ACC));
    expect(submitButton().hasAttribute("disabled")).toBe(true);
    pickByCode(bank, "110101001");
    expect(bank.value).toBe("1.1.01.01.001 — Caja Principal");
    expect(submitButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(submitButton());
    await waitFor(() => expect(enterRetentionAction).toHaveBeenCalledTimes(1));
    expect(enterRetentionAction.mock.calls[0][0]).toMatchObject({
      bankAccountId: CAJA_P_ACC.id,
      liabilityAccountId: PASIVO_ID,
    });
  });
});
