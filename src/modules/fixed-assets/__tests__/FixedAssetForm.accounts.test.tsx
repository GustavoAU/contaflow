// @vitest-environment jsdom
// src/modules/fixed-assets/__tests__/FixedAssetForm.accounts.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase.
//
// SPEC-012 · ENTREGA B2 · paso 1 (modo RED) — «Registrar activo fijo» (`FixedAssetForm`): los CUATRO
// selectores de cuenta pasan del <select> nativo con `register()` a `AccountCombobox` con `Controller`:
//   · Cuenta del activo (ASSET), Gasto depreciación (EXPENSE), Dep. acumulada (CONTRA_ASSET): OBLIGATORIOS;
//   · Cuenta origen adquisición (GL): OPCIONAL (`clearable`) y ofrece TODAS las cuentas (la página añade
//     Pasivo, respuesta de la contadora: un activo comprado a crédito se contrapone a una CxP).
//
// RN-19 / CA-20 (`findBestMatch` es privada: se prueba por render): el default de los tres obligatorios
// IGNORA los títulos. Un título del plan con más palabras clave que la cuenta real (p. ej. «PROPIEDAD
// PLANTA Y EQUIPO», título de 3 niveles) NO se autoselecciona; con un pool `[título, 1 movimiento]` el
// default es el movimiento; con solo títulos es «» y el aviso «Sin cuentas tipo …» cuenta solo cuentas de
// movimiento.
//
// Sin `required` nativo: el formulario valida con `isSelectableAccountId` al enviar y reutiliza su banner
// de error (decisión 2/3). Este formulario NO recibe valores iniciales de cuentas (solo defaults de
// `findBestMatch`), así que NO hay alerta de Q4 aquí (se declara en el reporte).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FixedAssetForm } from "../components/FixedAssetForm";
import {
  accessibleNames,
  accountComboboxes,
  accountErrorShown,
  clearButtonOf,
  clearField,
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
  visibleHeaderNames,
  type PlanAccount,
} from "@/__tests__/helpers/account-combobox-forms";

vi.mock("../actions/fixed-asset.actions", () => ({
  createFixedAssetAction: vi.fn(),
  getExpensesForAssetImportAction: vi.fn(),
}));

import {
  createFixedAssetAction,
  getExpensesForAssetImportAction,
} from "../actions/fixed-asset.actions";

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────
// Nombres de títulos en MAYÚSCULAS y distintos de los de las cuentas (el helper `headerEl` los busca
// por nombre). Los títulos llevan MÁS palabras clave de `findBestMatch` que la cuenta que debe ganar.

const T_ACTIVO = titleAcc("1", "ACTIVO", "ASSET");
const T_NOCORR = titleAcc("1.2", "NO CORRIENTE", "ASSET");
// «propiedad», «planta», «equipo» = 3 palabras clave (la cuenta de movimiento tiene 1).
const T_PPE = titleAcc("1.2.01", "PROPIEDAD PLANTA Y EQUIPO", "ASSET");
const T_EQUIPOS = titleAcc("1.2.01.01", "EQUIPOS", "ASSET");
const A_COMPUTO = moveAcc("1.2.01.01.001", "Equipos de Computación", "ASSET");
const A_VEHICULO = moveAcc("1.2.01.01.002", "Vehículos", "ASSET");
const A_BANCO = moveAcc("1.1.01.02.001", "Banco Mercantil", "ASSET");

// «depreci» + «amortiz» = 2 palabras clave (la cuenta de movimiento tiene 1).
const T_GASTOS = titleAcc("5", "GASTOS OPERATIVOS", "EXPENSE");
const T_GASTOS_DEP = titleAcc("5.1.02", "DEPRECIACION Y AMORTIZACION DEL EJERCICIO", "EXPENSE");
const E_ALQUILER = moveAcc("5.1.01.01.001", "Gasto Alquiler", "EXPENSE");
const E_DEPRECIACION = moveAcc("5.1.02.01.001", "Depreciación de Equipos", "EXPENSE");

// «acumul» + «depreci» + «amortiz» = 3 palabras clave (la cuenta de movimiento tiene 2).
const T_CONTRA = titleAcc("1.3", "ACTIVOS CONTRA", "CONTRA_ASSET");
const T_DEP_ACUM = titleAcc("1.3.01", "DEPRECIACION ACUMULADA Y AMORTIZACION", "CONTRA_ASSET");
const C_ACUMULADA = moveAcc("1.3.01.01.001", "Depreciación Acumulada Equipos", "CONTRA_ASSET");
const C_OTRA = moveAcc("1.3.01.01.002", "Provisión Otra", "CONTRA_ASSET");

const T_PASIVO = titleAcc("2", "PASIVO", "LIABILITY");
const T_EXIGIBLE = titleAcc("2.1", "EXIGIBLE", "LIABILITY");
const T_OBLIG = titleAcc("2.1.01", "OBLIGACIONES", "LIABILITY");
const T_PROVEEDORES = titleAcc("2.1.01.01", "PROVEEDORES", "LIABILITY");
const L_CXP = moveAcc("2.1.01.01.001", "Cuentas por Pagar Nacionales", "LIABILITY");

const T_PATRIMONIO = titleAcc("3", "PATRIMONIO", "EQUITY");
const T_CAPITAL = titleAcc("3.1.01.01", "CAPITAL", "EQUITY");
const Q_CAPITAL = moveAcc("3.1.01.01.001", "Capital Social", "EQUITY");

/** Lo que entrega la página: ASSET, EXPENSE, CONTRA_ASSET, REVENUE, EQUITY y (B2) LIABILITY. */
const ACCOUNTS: PlanAccount[] = [
  T_ACTIVO,
  A_BANCO,
  T_NOCORR,
  T_PPE,
  T_EQUIPOS,
  A_COMPUTO,
  A_VEHICULO,
  T_CONTRA,
  T_DEP_ACUM,
  C_ACUMULADA,
  C_OTRA,
  T_PASIVO,
  T_EXIGIBLE,
  T_OBLIG,
  T_PROVEEDORES,
  L_CXP,
  T_PATRIMONIO,
  T_CAPITAL,
  Q_CAPITAL,
  T_GASTOS,
  E_ALQUILER,
  T_GASTOS_DEP,
  E_DEPRECIACION,
];

const COMPANY_ID = "company-1";
const TITLE_NAMES = ACCOUNTS.filter((a) => !a.isPostable).map((a) => a.name);
/** Nombres de los títulos (de ESTE plan) que la lista abierta muestra como encabezado. */
const shownHeaders = () => visibleHeaderNames(TITLE_NAMES);
const ASSET_POOL = ofType(ACCOUNTS, "ASSET");
const EXPENSE_POOL = ofType(ACCOUNTS, "EXPENSE");
const CONTRA_POOL = ofType(ACCOUNTS, "CONTRA_ASSET");

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createFixedAssetAction).mockResolvedValue({ success: true, data: "asset-1" } as never);
  vi.mocked(getExpensesForAssetImportAction).mockResolvedValue({
    success: true,
    data: [],
  } as never);
});

afterEach(cleanup);

// ─── Helpers de render y de envío ────────────────────────────────────────────────────────────────

type Props = React.ComponentProps<typeof FixedAssetForm>;

function formElement(accounts: PlanAccount[], extra: Partial<Props> = {}) {
  return <FixedAssetForm companyId={COMPANY_ID} accounts={accounts} {...extra} />;
}

/** Los cuatro combobox por su etiqueta (falla con un mensaje claro si siguen siendo <select>). */
function fourComboboxes() {
  expectAccountComboboxes(4, "FixedAssetForm");
  return {
    asset: screen.getByLabelText(/Cuenta del activo/) as HTMLInputElement,
    expense: screen.getByLabelText(/Gasto depreciación/) as HTMLInputElement,
    contra: screen.getByLabelText(/Dep\. acumulada/) as HTMLInputElement,
    counterpart: screen.getByLabelText(/Cuenta origen adquisición/) as HTMLInputElement,
  };
}

function mount(accounts: PlanAccount[] = ACCOUNTS, extra: Partial<Props> = {}) {
  const utils = render(formElement(accounts, extra));
  return {
    ...utils,
    ...fourComboboxes(),
    refresh: (next: PlanAccount[]) => utils.rerender(formElement(next, extra)),
  };
}

const submitBtn = () => screen.getByRole("button", { name: /Registrar Activo|Guardando/ });
const dateInputs = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]'));

function fillBase() {
  fireEvent.change(screen.getByPlaceholderText("Ej: Vehículo Toyota Hilux 2026"), {
    target: { value: "Vehículo Hilux" },
  });
  fireEvent.change(dateInputs()[0]!, { target: { value: "2026-06-01" } });
  fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "25000.00" } });
  fireEvent.change(screen.getByPlaceholderText("Ej: 60"), { target: { value: "60" } });
}

/** Abre la sección legal y llena factura + RIF: así FC-03 (advertencia SENIAT) no se interpone. */
function fillLegalSeniat() {
  fireEvent.click(screen.getByRole("button", { name: /Datos Legales \/ SENIAT/ }));
  fireEvent.change(screen.getByPlaceholderText("Ej: 00-000123"), {
    target: { value: "00-000123" },
  });
  fireEvent.change(screen.getByPlaceholderText("Ej: J-12345678-9"), {
    target: { value: "J-12345678-9" },
  });
}

/** Deja correr las microtareas y los temporizadores pendientes (react-hook-form valida de forma asíncrona). */
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function submitValid() {
  fillBase();
  fillLegalSeniat();
  fireEvent.click(submitBtn());
  await waitFor(() => expect(createFixedAssetAction).toHaveBeenCalledTimes(1));
  return vi.mocked(createFixedAssetAction).mock.calls[0][0] as unknown as Record<string, unknown>;
}

/** Envía y comprueba que NO se llamó a la acción y que se avisó de la cuenta. */
async function submitBlocked() {
  fillBase();
  fillLegalSeniat();
  const before = snapshotTexts();
  fireEvent.click(submitBtn());
  await flush();
  expect(createFixedAssetAction).not.toHaveBeenCalled();
  expect(accountErrorShown(before), "falta el aviso de que falta la cuenta").toBe(true);
}

const asTitle = (a: PlanAccount): PlanAccount => ({ ...a, isPostable: false });
const withTitle = (list: readonly PlanAccount[], target: PlanAccount) =>
  list.map((a) => (a.id === target.id ? asTitle(a) : a));
const without = (list: readonly PlanAccount[], ...targets: PlanAccount[]) =>
  list.filter((a) => !targets.some((t) => t.id === a.id));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("FixedAssetForm — los cuatro selectores de cuenta son AccountCombobox (SPEC-012 B2)", () => {
  it("hay cuatro <input role=combobox>; los <select> nativos que quedan son SOLO moneda y método", () => {
    mount();
    expect(document.querySelectorAll("select")).toHaveLength(2);
    for (const select of document.querySelectorAll("select")) {
      expect(select.textContent).not.toMatch(/\d\.\d/); // ninguna opción «código — nombre»
    }
  });

  it("D9: cada uno tiene su etiqueta asociada (id + htmlFor) y un nombre accesible distinto", () => {
    const { asset, expense, contra, counterpart } = mount();
    expect(new Set([asset, expense, contra, counterpart]).size).toBe(4);
    const names = accessibleNames();
    expect(names).toHaveLength(4);
    expect(names.every((n) => n.trim() !== "")).toBe(true);
    expect(new Set(names).size).toBe(4);
  });

  it("el `required` nativo desaparece (cada formulario valida al enviar)", () => {
    mount();
    for (const input of accountComboboxes()) expect(input.required).toBe(false);
  });

  it("Cuenta del activo ofrece SOLO cuentas ASSET, con sus títulos como encabezados", () => {
    const { asset } = mount();
    openList(asset);
    expect(listedOptionLabels()).toEqual(movementLabels(ASSET_POOL));
    expect(shownHeaders()).toEqual([
      "ACTIVO",
      "NO CORRIENTE",
      "PROPIEDAD PLANTA Y EQUIPO",
      "EQUIPOS",
    ]);
  });

  it("Gasto depreciación ofrece SOLO cuentas EXPENSE, con sus títulos", () => {
    const { expense } = mount();
    openList(expense);
    expect(listedOptionLabels()).toEqual(movementLabels(EXPENSE_POOL));
    expect(shownHeaders()).toEqual([
      "GASTOS OPERATIVOS",
      "DEPRECIACION Y AMORTIZACION DEL EJERCICIO",
    ]);
  });

  it("Dep. acumulada ofrece SOLO cuentas CONTRA_ASSET, con sus títulos", () => {
    const { contra } = mount();
    openList(contra);
    expect(listedOptionLabels()).toEqual(movementLabels(CONTRA_POOL));
    expect(shownHeaders()).toEqual(["ACTIVOS CONTRA", "DEPRECIACION ACUMULADA Y AMORTIZACION"]);
  });

  it("Cuenta origen ofrece TODAS las cuentas de movimiento (también Pasivo) menos la cuenta del activo elegida", () => {
    const { counterpart } = mount();
    openList(counterpart);
    const expected = movementLabels(ACCOUNTS).filter((label) => label !== labelOf(A_COMPUTO));
    expect(listedOptionLabels().sort()).toEqual(expected.sort());
    expect(listedOptionLabels()).toContain(labelOf(L_CXP));
    expect(listedOptionLabels()).not.toContain(labelOf(A_COMPUTO));
    expect(shownHeaders()).toEqual(expect.arrayContaining(["PASIVO", "PROVEEDORES", "PATRIMONIO"]));
  });

  it("al cambiar la cuenta del activo, la anterior reaparece y la nueva desaparece de la contrapartida", () => {
    const { asset, counterpart } = mount();
    pickByCode(asset, A_VEHICULO.code);
    expect(asset.value).toBe(labelOf(A_VEHICULO));
    openList(counterpart);
    expect(listedOptionLabels()).toContain(labelOf(A_COMPUTO));
    expect(listedOptionLabels()).not.toContain(labelOf(A_VEHICULO));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("FixedAssetForm — defaults (`findBestMatch`) que IGNORAN los títulos (RN-19, CA-20)", () => {
  it("cada obligatorio arranca con la cuenta de MOVIMIENTO de mejor puntaje, no con el título que tiene más palabras clave", () => {
    const { asset, expense, contra, counterpart } = mount();
    expect(asset.value).toBe(labelOf(A_COMPUTO)); // el título «PROPIEDAD PLANTA Y EQUIPO» (3) no gana
    expect(expense.value).toBe(labelOf(E_DEPRECIACION)); // el título de depreciación y amortización (2) no gana
    expect(contra.value).toBe(labelOf(C_ACUMULADA)); // el título de depreciación acumulada (3) no gana
    for (const input of [asset, expense, contra]) {
      expect(input.getAttribute("aria-invalid")).not.toBe("true");
    }
    expect(counterpart.value).toBe(""); // la contrapartida nunca se autoselecciona
  });

  it("el payload lleva los ids de las cuentas de movimiento (nunca el de un título)", async () => {
    mount();
    const payload = await submitValid();
    expect(payload.assetAccountId).toBe(A_COMPUTO.id);
    expect(payload.depreciationAccountId).toBe(E_DEPRECIACION.id);
    expect(payload.accDepreciationAccountId).toBe(C_ACUMULADA.id);
    expect(payload.acquisitionCounterpartAccountId).toBeNull();
    for (const key of ["assetAccountId", "depreciationAccountId", "accDepreciationAccountId"]) {
      expect(String(payload[key]).startsWith("t:")).toBe(false);
    }
  });

  it("un título que va PRIMERO por código y tiene el mejor puntaje tampoco gana si el resto de la lista no puntúa", () => {
    const accounts = [T_PPE, A_BANCO, A_VEHICULO, ...without(ACCOUNTS, ...ASSET_POOL)];
    // A_BANCO (0 palabras clave) y A_VEHICULO (1): gana A_VEHICULO.
    const { asset } = mount(accounts);
    expect(asset.value).toBe(labelOf(A_VEHICULO));
  });

  it.each([
    {
      campo: "Cuenta del activo",
      titulo: T_PPE,
      unica: A_BANCO,
      lista: () => [...without(ACCOUNTS, ...ASSET_POOL), T_PPE, A_BANCO],
      pick: (c: ReturnType<typeof fourComboboxes>) => c.asset,
    },
    {
      campo: "Gasto depreciación",
      titulo: T_GASTOS_DEP,
      unica: E_ALQUILER,
      lista: () => [...without(ACCOUNTS, ...EXPENSE_POOL), T_GASTOS_DEP, E_ALQUILER],
      pick: (c: ReturnType<typeof fourComboboxes>) => c.expense,
    },
    {
      campo: "Dep. acumulada",
      titulo: T_DEP_ACUM,
      unica: C_OTRA,
      lista: () => [...without(ACCOUNTS, ...CONTRA_POOL), T_DEP_ACUM, C_OTRA],
      pick: (c: ReturnType<typeof fourComboboxes>) => c.contra,
    },
  ])(
    "$campo: con un pool [título de mejor puntaje, 1 cuenta de movimiento] el default es la cuenta de movimiento",
    ({ lista, unica, pick }) => {
      const mounted = mount(lista());
      expect(pick(mounted).value).toBe(labelOf(unica));
    }
  );

  it.each([
    {
      campo: "Cuenta del activo",
      aviso: /Sin cuentas tipo Activo/,
      lista: () => [...without(ACCOUNTS, ...ASSET_POOL), T_ACTIVO, T_PPE],
      etiqueta: /Cuenta del activo/,
    },
    {
      campo: "Gasto depreciación",
      aviso: /Sin cuentas tipo Gasto/,
      lista: () => [...without(ACCOUNTS, ...EXPENSE_POOL), T_GASTOS, T_GASTOS_DEP],
      etiqueta: /Gasto depreciación/,
    },
    {
      campo: "Dep. acumulada",
      aviso: /Sin cuentas tipo CONTRA_ASSET/,
      lista: () => [...without(ACCOUNTS, ...CONTRA_POOL), T_CONTRA, T_DEP_ACUM],
      etiqueta: /Dep\. acumulada/,
    },
  ])(
    "$campo con SOLO títulos: el aviso «Sin cuentas tipo …» aparece (los títulos no cuentan) y no hay selector utilizable",
    ({ lista, aviso, etiqueta }) => {
      render(formElement(lista()));
      expect(screen.getByText(aviso)).toBeTruthy();
      // El campo sin cuentas de movimiento no está (o está deshabilitado): quedan 3 utilizables.
      const field = screen.queryByLabelText(etiqueta) as HTMLInputElement | null;
      expect(field === null || field.disabled).toBe(true);
      expect(accountComboboxes().filter((input) => !input.disabled)).toHaveLength(3);
    }
  );

  it("con cuentas de movimiento de cada tipo NO hay ningún aviso «Sin cuentas tipo …»", () => {
    mount();
    expect(screen.queryByText(/Sin cuentas tipo/)).toBeNull();
  });

  it("sin ninguna cuenta del tipo (lista vacía) el aviso sigue apareciendo (comportamiento previo)", () => {
    render(formElement(without(ACCOUNTS, ...ASSET_POOL)));
    expect(screen.getByText(/Sin cuentas tipo Activo/)).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("FixedAssetForm — los títulos NO se pueden elegir (CA-9, CA-20)", () => {
  it("clic sobre los encabezados de Cuenta del activo no cambia la cuenta elegida", () => {
    const { asset } = mount();
    pressEveryHeader(asset, ["ACTIVO", "NO CORRIENTE", "PROPIEDAD PLANTA Y EQUIPO", "EQUIPOS"]);
    fireEvent.blur(asset);
    expect(asset.value).toBe(labelOf(A_COMPUTO));
  });

  it("clic sobre los encabezados de Gasto depreciación y Dep. acumulada no cambia las cuentas", () => {
    const { expense, contra } = mount();
    pressEveryHeader(expense, ["GASTOS OPERATIVOS", "DEPRECIACION Y AMORTIZACION DEL EJERCICIO"]);
    fireEvent.blur(expense);
    pressEveryHeader(contra, ["ACTIVOS CONTRA", "DEPRECIACION ACUMULADA Y AMORTIZACION"]);
    fireEvent.blur(contra);
    expect(expense.value).toBe(labelOf(E_DEPRECIACION));
    expect(contra.value).toBe(labelOf(C_ACUMULADA));
  });

  it("clic sobre los encabezados de la contrapartida (incluidos los de Pasivo) la deja vacía", () => {
    const { counterpart } = mount();
    pressEveryHeader(counterpart, [
      "ACTIVO",
      "PASIVO",
      "EXIGIBLE",
      "PROVEEDORES",
      "PATRIMONIO",
      "GASTOS OPERATIVOS",
    ]);
    fireEvent.blur(counterpart);
    expect(counterpart.value).toBe("");
    expect(clearButtonOf(counterpart)).toBeNull();
  });

  it("el id de un título jamás llega a la acción, pase lo que pase con los encabezados", async () => {
    const { asset, counterpart } = mount();
    pressEveryHeader(asset, ["PROPIEDAD PLANTA Y EQUIPO"]);
    fireEvent.blur(asset);
    pressEveryHeader(counterpart, ["PASIVO", "PROVEEDORES"]);
    fireEvent.blur(counterpart);
    const payload = await submitValid();
    for (const key of [
      "assetAccountId",
      "depreciationAccountId",
      "accDepreciationAccountId",
      "acquisitionCounterpartAccountId",
    ]) {
      expect(String(payload[key] ?? "").startsWith("t:")).toBe(false);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("FixedAssetForm — elegir cuentas y enviar", () => {
  it("elegir otra cuenta de activo tecleando el código + Enter cambia el payload", async () => {
    const { asset } = mount();
    pickByCode(asset, "120101002"); // código sin puntos: Vehículos
    expect(asset.value).toBe(labelOf(A_VEHICULO));
    const payload = await submitValid();
    expect(payload.assetAccountId).toBe(A_VEHICULO.id);
  });

  it("la contrapartida admite una cuenta de PASIVO (compra a crédito): viaja en el payload", async () => {
    const { counterpart } = mount();
    pickByCode(counterpart, L_CXP.code);
    expect(counterpart.value).toBe(labelOf(L_CXP));
    const payload = await submitValid();
    expect(payload.acquisitionCounterpartAccountId).toBe(L_CXP.id);
    expect(payload.assetAccountId).toBe(A_COMPUTO.id);
  });

  it("la contrapartida es OPCIONAL (clearable): sin valor no hay botón «Quitar la cuenta»; con valor sí, y quitarla envía null", async () => {
    const { counterpart } = mount();
    expect(clearButtonOf(counterpart)).toBeNull();
    pickByCode(counterpart, Q_CAPITAL.code);
    expect(clearButtonOf(counterpart)).not.toBeNull();
    clearField(counterpart);
    expect(counterpart.value).toBe("");
    expect(clearButtonOf(counterpart)).toBeNull();
    const payload = await submitValid();
    expect(payload.acquisitionCounterpartAccountId).toBeNull();
  });

  it("los tres obligatorios NO son clearable: ni con valor tienen «Quitar la cuenta»", () => {
    const { asset, expense, contra } = mount();
    for (const input of [asset, expense, contra]) {
      expect(input.value).not.toBe("");
      expect(clearButtonOf(input)).toBeNull();
    }
  });

  it("vaciar el TEXTO de un obligatorio y salir NO lo quita: se restaura la cuenta (RN-15)", () => {
    const { asset } = mount();
    fireEvent.focus(asset);
    fireEvent.change(asset, { target: { value: "" } });
    fireEvent.blur(asset);
    expect(asset.value).toBe(labelOf(A_COMPUTO));
  });

  it("el payload completo no cambia: mismas claves y valores que antes de migrar", async () => {
    const { counterpart } = mount();
    pickByCode(counterpart, L_CXP.code);
    const payload = await submitValid();
    expect(payload).toEqual({
      companyId: COMPANY_ID,
      name: "Vehículo Hilux",
      description: null,
      assetAccountId: A_COMPUTO.id,
      depreciationAccountId: E_DEPRECIACION.id,
      accDepreciationAccountId: C_ACUMULADA.id,
      acquisitionDate: new Date("2026-06-01"),
      acquisitionCost: "25000.00",
      acquisitionCurrency: "VES",
      bcvRateAtAcquisition: null,
      residualValue: "0",
      usefulLifeMonths: 60,
      depreciationMethod: "LINEA_RECTA",
      totalUnits: null,
      location: null,
      responsible: null,
      invoiceNumber: "00-000123",
      providerRif: "J-12345678-9",
      serialNumber: null,
      serviceStartDate: null,
      internalCode: null,
      acquisitionCounterpartAccountId: L_CXP.id,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("FixedAssetForm — sin cuenta elegible NO se envía (decisión 3: validación al enviar, sin `required` nativo)", () => {
  it("Cuenta del activo con SOLO títulos: el envío se bloquea y se avisa de la cuenta", async () => {
    render(formElement([...without(ACCOUNTS, ...ASSET_POOL), T_ACTIVO, T_PPE]));
    await submitBlocked();
  });

  it("Gasto depreciación con SOLO títulos: el envío se bloquea", async () => {
    render(formElement([...without(ACCOUNTS, ...EXPENSE_POOL), T_GASTOS, T_GASTOS_DEP]));
    await submitBlocked();
  });

  it("Dep. acumulada sin ninguna cuenta (el aviso ámbar): el envío se bloquea", async () => {
    render(formElement(without(ACCOUNTS, ...CONTRA_POOL)));
    await submitBlocked();
  });

  it("control: con las tres cuentas elegibles el envío SÍ llega a la acción", async () => {
    mount();
    await submitValid();
    expect(createFixedAssetAction).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// L-2 — la cuenta elegida (default u otra) se REVALIDA con las listas vigentes al enviar. El default se
// calcula una sola vez al montar (como `defaultValues` de react-hook-form); si luego la lista se refresca
// y esa cuenta pasa a ser título o desaparece, el combobox se ve vacío e inválido y el envío se bloquea.
describe("FixedAssetForm — L-2: una cuenta obsoleta tras refrescar la lista no se envía", () => {
  it.each([
    { cuando: "pasa a ser un TÍTULO", lista: () => withTitle(ACCOUNTS, A_COMPUTO) },
    { cuando: "YA NO ESTÁ en la lista", lista: () => without(ACCOUNTS, A_COMPUTO) },
  ])(
    "la cuenta del activo por defecto $cuando: combobox vacío e inválido y el envío se bloquea",
    async ({ lista }) => {
      const { asset, refresh } = mount();
      refresh(lista());
      expect(asset.value).toBe("");
      expect(asset.getAttribute("aria-invalid")).toBe("true");
      await submitBlocked();
    }
  );

  it("la cuenta de gasto por defecto pasa a ser título: el envío se bloquea", async () => {
    const { expense, refresh } = mount();
    refresh(withTitle(ACCOUNTS, E_DEPRECIACION));
    expect(expense.value).toBe("");
    expect(expense.getAttribute("aria-invalid")).toBe("true");
    await submitBlocked();
  });

  it("la cuenta de depreciación acumulada por defecto YA NO ESTÁ: el envío se bloquea", async () => {
    const { contra, refresh } = mount();
    refresh(without(ACCOUNTS, C_ACUMULADA));
    expect(contra.value).toBe("");
    await submitBlocked();
  });

  it("recuperación: elegir OTRA cuenta vigente desbloquea el envío y viaja la nueva, nunca la vieja", async () => {
    const { asset, refresh } = mount();
    refresh(withTitle(ACCOUNTS, A_COMPUTO));
    pickByCode(asset, A_VEHICULO.code);
    expect(asset.value).toBe(labelOf(A_VEHICULO));
    const payload = await submitValid();
    expect(payload.assetAccountId).toBe(A_VEHICULO.id);
  });

  it("un refresco que deja las cuentas elegidas igual (objetos nuevos) NO bloquea el envío", async () => {
    const { refresh } = mount();
    refresh(ACCOUNTS.map((a) => ({ ...a })));
    const payload = await submitValid();
    expect(payload.assetAccountId).toBe(A_COMPUTO.id);
  });

  it("OTRAS cuentas que pasan a título o desaparecen NO invalidan las elegidas", async () => {
    const { refresh } = mount();
    refresh(without(withTitle(ACCOUNTS, A_VEHICULO), C_OTRA, E_ALQUILER));
    const payload = await submitValid();
    expect(payload.assetAccountId).toBe(A_COMPUTO.id);
    expect(payload.depreciationAccountId).toBe(E_DEPRECIACION.id);
    expect(payload.accDepreciationAccountId).toBe(C_ACUMULADA.id);
  });

  // AMBIGÜEDAD declarada en el reporte: la contrapartida es OPCIONAL y el formulario no tiene un botón
  // que se deshabilite por validez. El contrato solo fija que el id obsoleto NUNCA llegue a la acción:
  // o el envío se bloquea, o se envía SIN contrapartida (null). Los dos finales son válidos.
  it.each([
    { cuando: "pasa a ser un TÍTULO", lista: () => withTitle(ACCOUNTS, L_CXP) },
    { cuando: "YA NO ESTÁ en la lista", lista: () => without(ACCOUNTS, L_CXP) },
  ])(
    "la contrapartida elegida $cuando: el id obsoleto nunca llega a la acción",
    async ({ lista }) => {
      const { counterpart, refresh } = mount();
      pickByCode(counterpart, L_CXP.code);
      expect(counterpart.value).toBe(labelOf(L_CXP));
      refresh(lista());
      fillBase();
      fillLegalSeniat();
      fireEvent.click(submitBtn());
      await flush();
      for (const call of vi.mocked(createFixedAssetAction).mock.calls) {
        const sent = (call[0] as { acquisitionCounterpartAccountId: string | null })
          .acquisitionCounterpartAccountId;
        expect(sent).not.toBe(L_CXP.id);
      }
    }
  );
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("FixedAssetForm — lo que NO cambia", () => {
  it("«Registrar Activo» sigue siendo type=submit con aria-busy=false en reposo", () => {
    mount();
    const btn = submitBtn();
    expect(btn.getAttribute("type")).toBe("submit");
    expect(btn.getAttribute("aria-busy")).toBe("false");
    expect(btn.hasAttribute("disabled")).toBe(false);
  });

  it("la lista de la contrapartida conserva TODAS las cuentas aunque cambie el método de depreciación", () => {
    const { counterpart } = mount();
    fireEvent.change(screen.getByDisplayValue("Línea Recta"), {
      target: { value: "SUMA_DIGITOS" },
    });
    openList(counterpart);
    expect(headerEl("PASIVO")).not.toBeNull();
    expect(listedOptionLabels()).toContain(labelOf(L_CXP));
  });
});
