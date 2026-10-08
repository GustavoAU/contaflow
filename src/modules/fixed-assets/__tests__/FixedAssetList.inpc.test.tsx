// @vitest-environment jsdom
// src/modules/fixed-assets/__tests__/FixedAssetList.inpc.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase.
//
// SPEC-012 · ENTREGA B2 · paso 1 (modo RED) — SOLO el panel «Reajuste por Inflación INPC» de
// `FixedAssetList` (el archivo tiene ~900 líneas: no se prueba nada más): su selector «Cuenta
// Actualización de Patrimonio» (EQUITY, obligatorio) pasa del <select> nativo a `AccountCombobox`.
//
// Se conserva el gating actual: el botón «Generar Reajuste INPC» sigue DESHABILITADO mientras no haya
// cuenta (decisión 2); el selector nace vacío (sin autoselección). Los selectores de «Mes» (dos, el de
// depreciación y el del panel INPC) siguen siendo <select> nativos.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FixedAssetList } from "../components/FixedAssetList";
import {
  accountComboboxes,
  clearButtonOf,
  expectAccountComboboxes,
  labelOf,
  listedOptionLabels,
  moveAcc,
  movementLabels,
  ofType,
  openList,
  pickByCode,
  pressEveryHeader,
  stubJsdomForListbox,
  titleAcc,
  visibleHeaderNames,
  type PlanAccount,
} from "@/__tests__/helpers/account-combobox-forms";

const actions = vi.hoisted(() => ({
  postMonthlyDepreciationAction: vi.fn(),
  catchUpAssetDepreciationAction: vi.fn(),
  catchUpAllAssetsDepreciationAction: vi.fn(),
  postFixedAssetINPCRestatementAction: vi.fn(),
  getFixedAssetGLReconciliationAction: vi.fn(),
  getFixedAssetINPCHistoryAction: vi.fn(),
  disposeFixedAssetAction: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../actions/fixed-asset.actions", () => ({
  postMonthlyDepreciationAction: actions.postMonthlyDepreciationAction,
  catchUpAssetDepreciationAction: actions.catchUpAssetDepreciationAction,
  catchUpAllAssetsDepreciationAction: actions.catchUpAllAssetsDepreciationAction,
  postFixedAssetINPCRestatementAction: actions.postFixedAssetINPCRestatementAction,
  getFixedAssetGLReconciliationAction: actions.getFixedAssetGLReconciliationAction,
  getFixedAssetINPCHistoryAction: actions.getFixedAssetINPCHistoryAction,
  disposeFixedAssetAction: actions.disposeFixedAssetAction,
}));
vi.mock("../components/DepreciationScheduleModal", () => ({
  DepreciationScheduleModal: function DepreciationScheduleModal() {
    return null;
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: actions.toastSuccess,
    error: actions.toastError,
    info: vi.fn(),
    warning: vi.fn(),
  },
  Toaster: () => null,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────

const T_PATRIMONIO = titleAcc("3", "PATRIMONIO", "EQUITY");
const T_CAPITALES = titleAcc("3.1", "CAPITALES", "EQUITY");
const T_REEXPRESION = titleAcc("3.1.02", "REEXPRESIONES", "EQUITY");
const T_APORTES = titleAcc("3.1.01.01", "APORTES", "EQUITY");
const Q_CAPITAL = moveAcc("3.1.01.01.001", "Capital Social", "EQUITY");
const Q_ACTUALIZACION = moveAcc("3.1.02.01.001", "Actualización de Patrimonio", "EQUITY");
const T_ACTIVO = titleAcc("1", "ACTIVO", "ASSET");
const A_BANCO = moveAcc("1.1.01.02.001", "Banco Mercantil", "ASSET");
const T_GASTOS = titleAcc("5", "EGRESOS", "EXPENSE");
const E_ALQUILER = moveAcc("5.1.01.01.001", "Gasto Alquiler", "EXPENSE");

/** Lo que entrega la página: ASSET, EXPENSE, CONTRA_ASSET, REVENUE, EQUITY y LIABILITY. */
const ACCOUNTS: PlanAccount[] = [
  T_ACTIVO,
  A_BANCO,
  T_PATRIMONIO,
  T_CAPITALES,
  T_APORTES,
  Q_CAPITAL,
  T_REEXPRESION,
  Q_ACTUALIZACION,
  T_GASTOS,
  E_ALQUILER,
];
const EQUITY = ofType(ACCOUNTS, "EQUITY");
const TITLE_NAMES = ACCOUNTS.filter((a) => !a.isPostable).map((a) => a.name);

const COMPANY_ID = "company-1";
const RATES = [{ year: 2026, month: 8, indexValue: "1500.123456" }];

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  actions.postFixedAssetINPCRestatementAction.mockResolvedValue({
    success: true,
    data: { processed: 2, skipped: 1, totalAdjustment: "1500.00" },
  });
});

afterEach(cleanup);

type Props = React.ComponentProps<typeof FixedAssetList>;

function element(accounts: PlanAccount[], inpcRates: Props["inpcRates"]) {
  return (
    <FixedAssetList
      assets={[]}
      companyId={COMPANY_ID}
      accounts={accounts}
      inpcRates={inpcRates}
      ivaDFAccountId={null}
      ivaCFAccountId={null}
    />
  );
}

function mount(accounts: PlanAccount[] = ACCOUNTS, inpcRates: Props["inpcRates"] = RATES) {
  const utils = render(element(accounts, inpcRates));
  return {
    ...utils,
    refresh: (next: PlanAccount[]) => utils.rerender(element(next, inpcRates)),
  };
}

/** El combobox de «Cuenta Actualización de Patrimonio» (falla con un mensaje claro si sigue siendo <select>). */
function patrimonio() {
  expectAccountComboboxes(1, "panel INPC");
  return screen.getByLabelText(/Cuenta Actualización de Patrimonio/) as HTMLInputElement;
}

const generateBtn = () => screen.getByRole("button", { name: /Generar Reajuste INPC|Calculando/ });
const nativeAccountOptions = () =>
  Array.from(document.querySelectorAll("option"))
    .map((o) => o.textContent ?? "")
    .filter((text) => / — /.test(text) && /\d/.test(text));
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
describe("FixedAssetList · panel INPC — el selector de Patrimonio es AccountCombobox (SPEC-012 B2)", () => {
  it("hay UN <input role=combobox>; los selectores de «Mes» (depreciación e INPC) siguen siendo <select> nativos", () => {
    mount();
    patrimonio();
    expect(document.querySelectorAll("select")).toHaveLength(2);
    expect(nativeAccountOptions()).toEqual([]);
  });

  it("D9: tiene su etiqueta asociada (id + htmlFor) y un nombre accesible", () => {
    mount();
    const input = patrimonio();
    expect(screen.getByLabelText(/Cuenta Actualización de Patrimonio/)).toBe(input);
    expect(input.id).not.toBe("");
  });

  it("ofrece SOLO cuentas de Patrimonio (EQUITY) con sus títulos como encabezados", () => {
    mount();
    openList(patrimonio());
    expect(listedOptionLabels()).toEqual(movementLabels(EQUITY));
    expect(visibleHeaderNames(TITLE_NAMES)).toEqual([
      "PATRIMONIO",
      "CAPITALES",
      "APORTES",
      "REEXPRESIONES",
    ]);
    expect(listedOptionLabels()).not.toContain(labelOf(A_BANCO));
    expect(listedOptionLabels()).not.toContain(labelOf(E_ALQUILER));
  });

  it("nace VACÍO (sin autoselección) y no es clearable: es obligatorio", () => {
    mount();
    const input = patrimonio();
    expect(input.value).toBe("");
    pickByCode(input, Q_ACTUALIZACION.code);
    expect(clearButtonOf(input)).toBeNull();
  });

  it("sin `required` nativo", () => {
    mount();
    expect(patrimonio().required).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("FixedAssetList · panel INPC — elegir la cuenta y generar el reajuste", () => {
  it("«Generar Reajuste INPC» sigue DESHABILITADO mientras no haya cuenta elegida", () => {
    mount();
    patrimonio();
    expect(generateBtn().hasAttribute("disabled")).toBe(true);
  });

  it("al elegir una cuenta (código + Enter) el botón se habilita y la acción recibe su id", async () => {
    mount();
    const input = patrimonio();
    pickByCode(input, "310201001");
    expect(input.value).toBe(labelOf(Q_ACTUALIZACION));
    expect(generateBtn().hasAttribute("disabled")).toBe(false);
    fireEvent.click(generateBtn());
    await waitFor(() =>
      expect(actions.postFixedAssetINPCRestatementAction).toHaveBeenCalledTimes(1)
    );
    expect(actions.postFixedAssetINPCRestatementAction).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      periodYear: 2026,
      periodMonth: 8,
      patrimonioAccountId: Q_ACTUALIZACION.id,
    });
    await waitFor(() => expect(screen.getByText(/2 ajustados · 1 omitidos/)).toBeTruthy());
  });

  it("clic sobre los encabezados de Patrimonio no elige nada: el botón sigue deshabilitado y la acción no se llama", async () => {
    mount();
    const input = patrimonio();
    pressEveryHeader(input, ["PATRIMONIO", "CAPITALES", "APORTES", "REEXPRESIONES"]);
    fireEvent.blur(input);
    expect(input.value).toBe("");
    expect(generateBtn().hasAttribute("disabled")).toBe(true);
    fireEvent.click(generateBtn());
    await flush();
    expect(actions.postFixedAssetINPCRestatementAction).not.toHaveBeenCalled();
  });

  it("el id de un título jamás llega a la acción", async () => {
    mount();
    const input = patrimonio();
    pressEveryHeader(input, ["PATRIMONIO", "REEXPRESIONES"]);
    fireEvent.blur(input);
    pickByCode(input, Q_CAPITAL.code);
    fireEvent.click(generateBtn());
    await waitFor(() =>
      expect(actions.postFixedAssetINPCRestatementAction).toHaveBeenCalledTimes(1)
    );
    const sent = actions.postFixedAssetINPCRestatementAction.mock.calls[0][0] as {
      patrimonioAccountId: string;
    };
    expect(sent.patrimonioAccountId).toBe(Q_CAPITAL.id);
    expect(sent.patrimonioAccountId.startsWith("t:")).toBe(false);
  });

  it("cambiar de cuenta antes de enviar manda la última elegida", async () => {
    mount();
    const input = patrimonio();
    pickByCode(input, Q_CAPITAL.code);
    pickByCode(input, Q_ACTUALIZACION.code);
    fireEvent.click(generateBtn());
    await waitFor(() =>
      expect(actions.postFixedAssetINPCRestatementAction).toHaveBeenCalledTimes(1)
    );
    expect(actions.postFixedAssetINPCRestatementAction.mock.calls[0][0]).toMatchObject({
      patrimonioAccountId: Q_ACTUALIZACION.id,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("FixedAssetList · panel INPC — RN-19 (solo títulos) y L-2 (cuenta obsoleta)", () => {
  it("con SOLO títulos de Patrimonio: el campo no es utilizable y el botón queda deshabilitado", async () => {
    mount(without(ACCOUNTS, Q_CAPITAL, Q_ACTUALIZACION));
    const inputs = accountComboboxes();
    expect(inputs.every((input) => input.disabled)).toBe(true);
    expect(nativeAccountOptions()).toEqual([]);
    expect(generateBtn().hasAttribute("disabled")).toBe(true);
    fireEvent.click(generateBtn());
    await flush();
    expect(actions.postFixedAssetINPCRestatementAction).not.toHaveBeenCalled();
  });

  it("sin ninguna cuenta de Patrimonio: tampoco hay selector utilizable ni botón habilitado", () => {
    mount(without(ACCOUNTS, ...EQUITY));
    expect(accountComboboxes().every((input) => input.disabled)).toBe(true);
    expect(generateBtn().hasAttribute("disabled")).toBe(true);
  });

  it.each([
    { cuando: "pasa a ser un TÍTULO", lista: () => withTitle(ACCOUNTS, Q_ACTUALIZACION) },
    { cuando: "YA NO ESTÁ en la lista", lista: () => without(ACCOUNTS, Q_ACTUALIZACION) },
  ])(
    "la cuenta elegida $cuando tras refrescar: campo vacío e inválido, botón deshabilitado y sin llamada",
    async ({ lista }) => {
      const { refresh } = mount();
      const input = patrimonio();
      pickByCode(input, Q_ACTUALIZACION.code);
      expect(generateBtn().hasAttribute("disabled")).toBe(false); // precondición: así SÍ se enviaría
      refresh(lista());
      expect(input.value).toBe("");
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(generateBtn().hasAttribute("disabled")).toBe(true);
      fireEvent.click(generateBtn());
      await flush();
      expect(actions.postFixedAssetINPCRestatementAction).not.toHaveBeenCalled();
    }
  );

  it("recuperación: elegir OTRA cuenta vigente rehabilita el botón y envía la nueva, nunca la vieja", async () => {
    const { refresh } = mount();
    const input = patrimonio();
    pickByCode(input, Q_ACTUALIZACION.code);
    refresh(withTitle(ACCOUNTS, Q_ACTUALIZACION));
    expect(generateBtn().hasAttribute("disabled")).toBe(true);
    pickByCode(input, Q_CAPITAL.code);
    expect(generateBtn().hasAttribute("disabled")).toBe(false);
    fireEvent.click(generateBtn());
    await waitFor(() =>
      expect(actions.postFixedAssetINPCRestatementAction).toHaveBeenCalledTimes(1)
    );
    expect(actions.postFixedAssetINPCRestatementAction.mock.calls[0][0]).toMatchObject({
      patrimonioAccountId: Q_CAPITAL.id,
    });
  });

  it("un refresco que deja la cuenta elegida igual (objetos nuevos) NO deshabilita el botón", () => {
    const { refresh } = mount();
    pickByCode(patrimonio(), Q_ACTUALIZACION.code);
    refresh(ACCOUNTS.map((a) => ({ ...a })));
    expect(generateBtn().hasAttribute("disabled")).toBe(false);
  });

  it("OTRAS cuentas que pasan a título o desaparecen NO invalidan la elegida", () => {
    const { refresh } = mount();
    pickByCode(patrimonio(), Q_ACTUALIZACION.code);
    refresh(withTitle(ACCOUNTS, Q_CAPITAL));
    expect(generateBtn().hasAttribute("disabled")).toBe(false);
    expect(patrimonio().value).toBe(labelOf(Q_ACTUALIZACION));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("FixedAssetList · panel INPC — lo que NO cambia (guardas verdes)", () => {
  it("sin tasas INPC el panel no tiene selector de cuenta y avisa cómo registrarlas", () => {
    mount(ACCOUNTS, []);
    expect(accountComboboxes()).toHaveLength(0);
    expect(screen.getByText(/primero registra las tasas del índice/)).toBeTruthy();
    expect(screen.getByText(/No hay tasas INPC registradas/)).toBeTruthy();
  });

  it("con tasas, el panel muestra el último índice disponible", () => {
    mount();
    expect(screen.getByText(/Último índice disponible: Agosto 2026/)).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Mutantes B2 (test-agent, paso 4): el botón fiscal debe declarar `aria-busy` (checklist pre-merge: guard
// doble-submit con `disabled={isPending}` + `aria-busy`). El mutante que lo quitaba sobrevivía.
describe("FixedAssetList · panel INPC — «Generar Reajuste INPC» declara aria-busy mientras corre (mutantes B2)", () => {
  it("en reposo aria-busy=false; mientras la acción corre aria-busy=true y deshabilitado; al terminar vuelve a false", async () => {
    let finish!: (value: unknown) => void;
    actions.postFixedAssetINPCRestatementAction.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    mount();
    pickByCode(patrimonio(), Q_ACTUALIZACION.code);
    expect(generateBtn().getAttribute("aria-busy")).toBe("false");
    expect(generateBtn().hasAttribute("disabled")).toBe(false);

    fireEvent.click(generateBtn());
    await waitFor(() => expect(generateBtn().getAttribute("aria-busy")).toBe("true"));
    expect(generateBtn().hasAttribute("disabled")).toBe(true);
    expect(actions.postFixedAssetINPCRestatementAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({ success: true, data: { processed: 0, skipped: 0, totalAdjustment: "0.00" } });
    });
    await waitFor(() => expect(generateBtn().getAttribute("aria-busy")).toBe("false"));
    expect(generateBtn().hasAttribute("disabled")).toBe(false);
  });
});
