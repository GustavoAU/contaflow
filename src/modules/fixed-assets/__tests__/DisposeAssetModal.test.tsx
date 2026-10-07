// @vitest-environment jsdom
// src/modules/fixed-assets/__tests__/DisposeAssetModal.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase.
//
// SPEC-012 · ENTREGA B2 · paso 1 (modo RED) — «Dar de baja activo» (`DisposeAssetModal`): los TRES
// selectores de cuenta, todos condicionales, pasan del <select> nativo a `AccountCombobox`:
//   · «Cuenta de cobro (Banco / CxC)» (ASSET) — venta con precio > 0;
//   · «Cuenta de ganancia en venta» / «Cuenta de pérdida en baja» (EXPENSE o REVENUE) — si hay
//     ganancia o pérdida sobre el valor en libros;
//   · «Cuenta gasto IVA reintegrado» (EXPENSE) — reintegro del Art. 66 LIVA (baja anticipada).
// Es un modal propio (sin Radix): NO maneja `Esc`, así que el `Esc` del combobox solo cierra su lista y el
// modal sigue abierto (no hace falta D3; se deja una guarda).
//
// Sin `required` nativo (no lo había en el modal: validaba en `validate()`): se conservan los mensajes
// existentes y `validate()` pasa a usar `isSelectableAccountId` con la lista de cada campo (L-2): una
// cuenta que ya no es elegible tras refrescar la lista NO se envía. Este modal no tiene valores guardados:
// no hay alerta de Q4.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DisposeAssetModal } from "../components/DisposeAssetModal";
import {
  accessibleNames,
  accountComboboxes,
  clearButtonOf,
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
  stubJsdomForListbox,
  titleAcc,
  visibleHeaderNames,
  type PlanAccount,
} from "@/__tests__/helpers/account-combobox-forms";

const { disposeFixedAssetAction, toastSuccess } = vi.hoisted(() => ({
  disposeFixedAssetAction: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("../actions/fixed-asset.actions", () => ({ disposeFixedAssetAction }));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: vi.fn() },
  Toaster: () => null,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────
// Nombres de títulos en MAYÚSCULAS, sin palabras en común entre sí ni con los de las cuentas.

const T_ACTIVO = titleAcc("1", "ACTIVO", "ASSET");
const T_CORRIENTE = titleAcc("1.1", "CORRIENTE", "ASSET");
const T_DISPONIBLE = titleAcc("1.1.01", "DISPONIBLE", "ASSET");
const T_BANCOS = titleAcc("1.1.01.02", "BANCOS", "ASSET");
const BANCO_M = moveAcc("1.1.01.02.001", "Banco Mercantil", "ASSET");
const BANCO_P = moveAcc("1.1.01.02.002", "Banco Provincial", "ASSET");

const T_PASIVO = titleAcc("2", "PASIVO", "LIABILITY");
const T_PROVEEDORES = titleAcc("2.1.01.01", "PROVEEDORES", "LIABILITY");
const CXP = moveAcc("2.1.01.01.001", "Cuentas por Pagar", "LIABILITY");

const T_INGRESOS = titleAcc("4", "INGRESOS", "REVENUE");
const T_NO_OPERATIVOS = titleAcc("4.2", "NO OPERATIVOS", "REVENUE");
const T_GANANCIAS = titleAcc("4.2.01", "GANANCIAS EXTRAORDINARIAS", "REVENUE");
const GANANCIA = moveAcc("4.2.01.01.001", "Ganancia en Venta de Activos", "REVENUE");

const T_EGRESOS = titleAcc("5", "EGRESOS", "EXPENSE");
const T_FUERA = titleAcc("5.2", "FUERA DE EXPLOTACION", "EXPENSE");
const T_PERDIDAS = titleAcc("5.2.01", "PERDIDAS EXTRAORDINARIAS", "EXPENSE");
const PERDIDA = moveAcc("5.2.01.01.001", "Pérdida en Baja de Activos", "EXPENSE");
const GASTO_IVA = moveAcc("5.2.01.01.002", "Gasto IVA Reintegrado", "EXPENSE");

/** Lo que entrega la página: ASSET, EXPENSE, CONTRA_ASSET, REVENUE, EQUITY y LIABILITY (títulos Y movimiento). */
const ACCOUNTS: PlanAccount[] = [
  T_ACTIVO,
  T_CORRIENTE,
  T_DISPONIBLE,
  T_BANCOS,
  BANCO_M,
  BANCO_P,
  T_PASIVO,
  T_PROVEEDORES,
  CXP,
  T_INGRESOS,
  T_NO_OPERATIVOS,
  T_GANANCIAS,
  GANANCIA,
  T_EGRESOS,
  T_FUERA,
  T_PERDIDAS,
  PERDIDA,
  GASTO_IVA,
];
const TITLE_NAMES = ACCOUNTS.filter((a) => !a.isPostable).map((a) => a.name);
const shownHeaders = () => visibleHeaderNames(TITLE_NAMES);

const COMPANY_ID = "company-1";
const IVA_CF_ID = "iva-cf-account";
const IVA_DF_ID = "iva-df-account";

/** Costo 10.000, depreciación 4.000 → valor en libros 6.000. Adquirido en 2019: no aplica el Art. 66. */
const OLD_ASSET = {
  id: "asset-1",
  name: "Camioneta Hilux",
  acquisitionDate: "2019-01-15T00:00:00.000Z",
  acquisitionCost: "10000.00",
  accumulatedDepreciation: "4000.00",
  bookValue: "6000.00",
};
/** Adquirido hace ~40 días: baja anticipada (< 36 meses) → reintegro del Art. 66 si hay cuenta IVA CF. */
const RECENT_ASSET = {
  ...OLD_ASSET,
  acquisitionDate: new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString(),
};
/** Totalmente depreciado: valor en libros 0 → sin ganancia ni pérdida. */
const FULLY_DEPRECIATED = { ...OLD_ASSET, accumulatedDepreciation: "10000.00", bookValue: "0.00" };

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  disposeFixedAssetAction.mockResolvedValue({ success: true, data: undefined });
});

afterEach(cleanup);

// ─── Helpers de render y de interacción ──────────────────────────────────────────────────────────

type Props = React.ComponentProps<typeof DisposeAssetModal>;
type Opts = { asset?: Props["asset"]; accounts?: PlanAccount[]; ivaCF?: string | null };

function element(
  onClose: () => void,
  { asset = OLD_ASSET, accounts = ACCOUNTS, ivaCF = null }: Opts
) {
  return (
    <DisposeAssetModal
      asset={asset}
      companyId={COMPANY_ID}
      accounts={accounts}
      ivaDFAccountId={IVA_DF_ID}
      ivaCFAccountId={ivaCF}
      onClose={onClose}
    />
  );
}

function mount(opts: Opts = {}) {
  const onClose = vi.fn();
  const utils = render(element(onClose, opts));
  return {
    ...utils,
    onClose,
    refresh: (next: Opts) => utils.rerender(element(onClose, { ...opts, ...next })),
  };
}

const confirmBtn = () => screen.getByRole("button", { name: /Confirmar baja|Procesando/ });
const setReason = (reason: string) =>
  fireEvent.change(document.querySelector("select") as HTMLSelectElement, {
    target: { value: reason },
  });
const setProceeds = (amount: string) =>
  fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: amount } });

const cobro = () => screen.getByLabelText(/Cuenta de cobro/) as HTMLInputElement;
const gananciaOPerdida = () =>
  screen.getByLabelText(/Cuenta de (ganancia en venta|pérdida en baja)/) as HTMLInputElement;
const art66 = () => screen.getByLabelText(/Cuenta gasto IVA reintegrado/) as HTMLInputElement;
const queryCobro = () => screen.queryByLabelText(/Cuenta de cobro/) as HTMLInputElement | null;
const queryArt66 = () =>
  screen.queryByLabelText(/Cuenta gasto IVA reintegrado/) as HTMLInputElement | null;

/** Opciones «código — nombre» de un <select> nativo: tras migrar no debe quedar ninguna. */
const nativeAccountOptions = () =>
  Array.from(document.querySelectorAll("option"))
    .map((o) => o.textContent ?? "")
    .filter((text) => / — /.test(text) && /\d/.test(text));

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const ERR_COBRO = "Selecciona la cuenta bancaria o CxC donde se recibió el cobro.";
const ERR_GANANCIA = "Selecciona la cuenta de ingreso por ganancia en venta.";
const ERR_PERDIDA = "Selecciona la cuenta de pérdida en baja de activo.";
const ERR_ART66 = "Selecciona la cuenta de gasto para el reintegro IVA Art. 66 LIVA.";

async function confirmBlocked(message: string) {
  fireEvent.click(confirmBtn());
  await flush();
  expect(disposeFixedAssetAction).not.toHaveBeenCalled();
  expect(screen.getByText(message)).toBeTruthy();
}

async function confirmOk() {
  fireEvent.click(confirmBtn());
  await waitFor(() => expect(disposeFixedAssetAction).toHaveBeenCalledTimes(1));
  return disposeFixedAssetAction.mock.calls[0][0] as Record<string, unknown>;
}

const asTitle = (a: PlanAccount): PlanAccount => ({ ...a, isPostable: false });
const withTitle = (list: readonly PlanAccount[], target: PlanAccount) =>
  list.map((a) => (a.id === target.id ? asTitle(a) : a));
const without = (list: readonly PlanAccount[], ...targets: PlanAccount[]) =>
  list.filter((a) => !targets.some((t) => t.id === a.id));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("DisposeAssetModal — los selectores de cuenta son AccountCombobox y aparecen SOLO cuando hacen falta (SPEC-012 B2)", () => {
  it("baja por obsolescencia con valor en libros > 0 (pérdida): UN combobox, «Cuenta de pérdida en baja»; el motivo sigue siendo el único <select>", () => {
    mount();
    expectAccountComboboxes(1, "DisposeAssetModal (pérdida)");
    expect(gananciaOPerdida().getAttribute("role")).toBe("combobox");
    expect(document.querySelectorAll("select")).toHaveLength(1);
    expect(queryCobro()).toBeNull();
    expect(queryArt66()).toBeNull();
  });

  it("valor en libros 0 (sin ganancia ni pérdida): ningún selector de cuenta", () => {
    mount({ asset: FULLY_DEPRECIATED });
    expect(accountComboboxes()).toHaveLength(0);
    expect(screen.queryByLabelText(/Cuenta de (ganancia|pérdida)/)).toBeNull();
  });

  it("venta con precio 0: sigue habiendo pérdida → un combobox (sin cuenta de cobro)", () => {
    mount();
    setReason("SALE");
    expectAccountComboboxes(1, "venta con precio 0");
    expect(queryCobro()).toBeNull();
  });

  it("venta con precio > valor en libros (ganancia): cuenta de cobro + cuenta de ganancia", () => {
    mount();
    setReason("SALE");
    setProceeds("8000");
    expectAccountComboboxes(2, "venta con ganancia");
    expect(cobro()).not.toBe(gananciaOPerdida());
    expect(screen.getByLabelText(/Cuenta de ganancia en venta/)).toBe(gananciaOPerdida());
  });

  it("venta con precio < valor en libros: cuenta de cobro + cuenta de PÉRDIDA", () => {
    mount();
    setReason("SALE");
    setProceeds("3000");
    expectAccountComboboxes(2, "venta con pérdida");
    expect(screen.getByLabelText(/Cuenta de pérdida en baja/)).toBe(gananciaOPerdida());
  });

  it("venta exactamente al valor en libros: SOLO la cuenta de cobro (no hay ganancia ni pérdida)", () => {
    mount();
    setReason("SALE");
    setProceeds("6000");
    expectAccountComboboxes(1, "venta al valor en libros");
    expect(cobro()).toBeTruthy();
    expect(screen.queryByLabelText(/Cuenta de (ganancia|pérdida)/)).toBeNull();
  });

  it("baja anticipada con IVA CF configurado (Art. 66): aparece «Cuenta gasto IVA reintegrado»", () => {
    mount({ asset: RECENT_ASSET, ivaCF: IVA_CF_ID });
    expectAccountComboboxes(2, "pérdida + Art. 66");
    expect(art66()).not.toBe(gananciaOPerdida());
  });

  it("desmarcar el reintegro del Art. 66 retira su selector; volver a marcarlo lo trae de vuelta", () => {
    mount({ asset: RECENT_ASSET, ivaCF: IVA_CF_ID });
    const checkbox = screen.getByRole("checkbox", { name: /Reintegrar IVA Crédito Fiscal/ });
    fireEvent.click(checkbox);
    expect(queryArt66()).toBeNull();
    expectAccountComboboxes(1, "sin Art. 66");
    fireEvent.click(checkbox);
    expectAccountComboboxes(2, "con Art. 66 otra vez");
  });

  it("venta con ganancia + Art. 66: los TRES selectores a la vez, cada uno con su nombre accesible distinto", () => {
    mount({ asset: RECENT_ASSET, ivaCF: IVA_CF_ID });
    setReason("SALE");
    setProceeds("8000");
    expectAccountComboboxes(3, "venta con ganancia + Art. 66");
    const names = accessibleNames();
    expect(names).toHaveLength(3);
    expect(names.every((n) => n.trim() !== "")).toBe(true);
    expect(new Set(names).size).toBe(3);
    expect(new Set([cobro(), gananciaOPerdida(), art66()]).size).toBe(3);
  });

  it("el `required` nativo no existe en ninguno (el modal valida al confirmar)", () => {
    mount({ asset: RECENT_ASSET, ivaCF: IVA_CF_ID });
    setReason("SALE");
    setProceeds("8000");
    for (const input of expectAccountComboboxes(3, "los tres")) expect(input.required).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("DisposeAssetModal — cada selector ofrece SOLO su tipo, con los títulos como encabezados", () => {
  it("cuenta de cobro: solo ASSET", () => {
    mount();
    setReason("SALE");
    setProceeds("8000");
    openList(cobro());
    expect(listedOptionLabels()).toEqual(movementLabels(ofType(ACCOUNTS, "ASSET")));
    expect(shownHeaders()).toEqual(["ACTIVO", "CORRIENTE", "DISPONIBLE", "BANCOS"]);
  });

  it("cuenta de ganancia/pérdida: EXPENSE y REVENUE (en orden de código), nunca ASSET ni LIABILITY", () => {
    mount();
    openList(gananciaOPerdida());
    expect(listedOptionLabels()).toEqual([labelOf(GANANCIA), labelOf(PERDIDA), labelOf(GASTO_IVA)]);
    expect(shownHeaders()).toEqual([
      "INGRESOS",
      "NO OPERATIVOS",
      "GANANCIAS EXTRAORDINARIAS",
      "EGRESOS",
      "FUERA DE EXPLOTACION",
      "PERDIDAS EXTRAORDINARIAS",
    ]);
  });

  it("cuenta de gasto del Art. 66: solo EXPENSE (ni siquiera REVENUE)", () => {
    mount({ asset: RECENT_ASSET, ivaCF: IVA_CF_ID });
    openList(art66());
    expect(listedOptionLabels()).toEqual([labelOf(PERDIDA), labelOf(GASTO_IVA)]);
    expect(shownHeaders()).toEqual(["EGRESOS", "FUERA DE EXPLOTACION", "PERDIDAS EXTRAORDINARIAS"]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("DisposeAssetModal — los títulos NO se pueden elegir (CA-9)", () => {
  it("clic sobre los encabezados de la cuenta de ganancia/pérdida la deja vacía y «Confirmar baja» sigue bloqueado con el mensaje de siempre", async () => {
    mount();
    const input = gananciaOPerdida();
    pressEveryHeader(input, ["INGRESOS", "EGRESOS", "PERDIDAS EXTRAORDINARIAS"]);
    fireEvent.blur(input);
    expect(input.value).toBe("");
    await confirmBlocked(ERR_PERDIDA);
  });

  it("clic sobre los encabezados de la cuenta de cobro la deja vacía (venta con ganancia)", async () => {
    mount();
    setReason("SALE");
    setProceeds("8000");
    pressEveryHeader(cobro(), ["ACTIVO", "BANCOS"]);
    fireEvent.blur(cobro());
    expect(cobro().value).toBe("");
    await confirmBlocked(ERR_COBRO);
  });

  it("clic sobre los encabezados de la cuenta del Art. 66 la deja vacía", () => {
    mount({ asset: RECENT_ASSET, ivaCF: IVA_CF_ID });
    pressEveryHeader(art66(), ["EGRESOS", "FUERA DE EXPLOTACION"]);
    fireEvent.blur(art66());
    expect(art66().value).toBe("");
  });

  it("los selectores NO son clearable: son obligatorios cuando aparecen (sin «Quitar la cuenta»)", () => {
    mount();
    pickByCode(gananciaOPerdida(), PERDIDA.code);
    expect(clearButtonOf(gananciaOPerdida())).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("DisposeAssetModal — elegir cuentas y confirmar (el payload NO cambia)", () => {
  it("pérdida por obsolescencia: elegir la cuenta tecleando el código + Enter y confirmar", async () => {
    const { onClose } = mount();
    pickByCode(gananciaOPerdida(), "520101001");
    expect(gananciaOPerdida().value).toBe(labelOf(PERDIDA));
    const payload = await confirmOk();
    expect(payload).toEqual({
      assetId: "asset-1",
      companyId: COMPANY_ID,
      reason: "OBSOLETE",
      disposalDate: expect.any(Date),
      saleProceeds: "0.00",
      proceedsAccountId: null,
      gainLossAccountId: PERDIDA.id,
      notes: null,
      applyIva: false,
      ivaDFAccountId: null,
      applyArt66: false,
      art66ExpenseAccountId: null,
      ivaCFAccountId: null,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith('"Camioneta Hilux" dado de baja correctamente.');
  });

  it("venta con ganancia: cuenta de cobro + cuenta de ganancia viajan en el payload", async () => {
    mount();
    setReason("SALE");
    setProceeds("8000");
    pickByCode(cobro(), BANCO_P.code);
    pickByCode(gananciaOPerdida(), GANANCIA.code);
    const payload = await confirmOk();
    expect(payload).toMatchObject({
      reason: "SALE",
      saleProceeds: "8000.00",
      proceedsAccountId: BANCO_P.id,
      gainLossAccountId: GANANCIA.id,
      applyArt66: false,
    });
  });

  it("baja anticipada: cuenta de pérdida + cuenta de gasto del Art. 66 (con ivaCFAccountId)", async () => {
    mount({ asset: RECENT_ASSET, ivaCF: IVA_CF_ID });
    pickByCode(gananciaOPerdida(), PERDIDA.code);
    pickByCode(art66(), GASTO_IVA.code);
    const payload = await confirmOk();
    expect(payload).toMatchObject({
      gainLossAccountId: PERDIDA.id,
      applyArt66: true,
      art66ExpenseAccountId: GASTO_IVA.id,
      ivaCFAccountId: IVA_CF_ID,
    });
  });

  it("ninguno de los ids enviados es el de un título, hagan lo que hagan con los encabezados", async () => {
    mount();
    setReason("SALE");
    setProceeds("8000");
    pressEveryHeader(cobro(), ["ACTIVO", "BANCOS"]);
    fireEvent.blur(cobro());
    pickByCode(cobro(), BANCO_M.code);
    pressEveryHeader(gananciaOPerdida(), ["INGRESOS", "GANANCIAS EXTRAORDINARIAS"]);
    fireEvent.blur(gananciaOPerdida());
    pickByCode(gananciaOPerdida(), GANANCIA.code);
    const payload = await confirmOk();
    expect(String(payload.proceedsAccountId).startsWith("t:")).toBe(false);
    expect(String(payload.gainLossAccountId).startsWith("t:")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("DisposeAssetModal — sin cuenta elegida NO se confirma (mensajes existentes, guardas verdes)", () => {
  it("pérdida sin cuenta: «Selecciona la cuenta de pérdida en baja de activo.» y la acción no se llama", async () => {
    mount();
    await confirmBlocked(ERR_PERDIDA);
  });

  it("venta con ganancia sin cuenta de cobro: se pide primero la cuenta de cobro", async () => {
    mount();
    setReason("SALE");
    setProceeds("8000");
    await confirmBlocked(ERR_COBRO);
  });

  it("venta con ganancia con cobro elegido pero sin cuenta de ganancia: «Selecciona la cuenta de ingreso por ganancia en venta.»", async () => {
    mount();
    setReason("SALE");
    setProceeds("8000");
    pickByCode(cobro(), BANCO_M.code);
    await confirmBlocked(ERR_GANANCIA);
  });

  it("Art. 66 sin cuenta de gasto (pérdida ya elegida): el mensaje del Art. 66", async () => {
    mount({ asset: RECENT_ASSET, ivaCF: IVA_CF_ID });
    pickByCode(gananciaOPerdida(), PERDIDA.code);
    await confirmBlocked(ERR_ART66);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("DisposeAssetModal — RN-19: una lista de SOLO títulos no ofrece nada y no deja confirmar", () => {
  it("cuenta de cobro con SOLO títulos ASSET: campo deshabilitado y la confirmación se bloquea", async () => {
    mount({ accounts: without(ACCOUNTS, BANCO_M, BANCO_P) });
    setReason("SALE");
    setProceeds("8000");
    const input = queryCobro();
    expect(input === null || input.disabled).toBe(true);
    expect(nativeAccountOptions()).toEqual([]); // los títulos no se ofrecen en ningún <select>
    await confirmBlocked(ERR_COBRO);
  });

  it("cuenta de pérdida con SOLO títulos EXPENSE/REVENUE: campo deshabilitado y la confirmación se bloquea", async () => {
    mount({ accounts: without(ACCOUNTS, GANANCIA, PERDIDA, GASTO_IVA) });
    const input = screen.queryByLabelText(/Cuenta de pérdida en baja/) as HTMLInputElement | null;
    expect(input === null || input.disabled).toBe(true);
    expect(nativeAccountOptions()).toEqual([]);
    await confirmBlocked(ERR_PERDIDA);
  });

  it("Art. 66 con SOLO títulos EXPENSE (queda REVENUE): el selector del Art. 66 no es utilizable aunque REVENUE sí alimente el de pérdida", async () => {
    mount({
      asset: RECENT_ASSET,
      ivaCF: IVA_CF_ID,
      accounts: without(ACCOUNTS, PERDIDA, GASTO_IVA),
    });
    const input = queryArt66();
    expect(input === null || input.disabled).toBe(true);
    const loss = gananciaOPerdida();
    expect(loss.disabled).toBe(false);
    pickByCode(loss, GANANCIA.code);
    await confirmBlocked(ERR_ART66);
  });

  it("un solo título + una cuenta de movimiento: la cuenta se puede elegir y el título no", () => {
    mount({ accounts: [T_EGRESOS, T_FUERA, T_PERDIDAS, PERDIDA] });
    openList(gananciaOPerdida());
    expect(listedOptionLabels()).toEqual([labelOf(PERDIDA)]);
    expect(headerEl("PERDIDAS EXTRAORDINARIAS")).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// L-2 — las cuentas elegidas se REVALIDAN con las listas vigentes al confirmar. Si tras refrescar la lista
// la cuenta elegida pasa a ser título o desaparece, el combobox se ve vacío e inválido y NO se envía.
describe("DisposeAssetModal — L-2: una cuenta obsoleta tras refrescar la lista no se envía", () => {
  it.each([
    { cuando: "pasa a ser un TÍTULO", lista: () => withTitle(ACCOUNTS, PERDIDA) },
    { cuando: "YA NO ESTÁ en la lista", lista: () => without(ACCOUNTS, PERDIDA) },
  ])(
    "la cuenta de pérdida elegida $cuando: combobox vacío e inválido y la baja no se envía",
    async ({ lista }) => {
      const { refresh } = mount();
      pickByCode(gananciaOPerdida(), PERDIDA.code);
      refresh({ accounts: lista() });
      expect(gananciaOPerdida().value).toBe("");
      expect(gananciaOPerdida().getAttribute("aria-invalid")).toBe("true");
      await confirmBlocked(ERR_PERDIDA);
    }
  );

  it("la cuenta de cobro elegida pasa a ser título: no se envía", async () => {
    const { refresh } = mount();
    setReason("SALE");
    setProceeds("8000");
    pickByCode(cobro(), BANCO_M.code);
    pickByCode(gananciaOPerdida(), GANANCIA.code);
    refresh({ accounts: withTitle(ACCOUNTS, BANCO_M) });
    expect(cobro().value).toBe("");
    expect(cobro().getAttribute("aria-invalid")).toBe("true");
    await confirmBlocked(ERR_COBRO);
  });

  it("la cuenta del Art. 66 elegida desaparece de la lista: no se envía", async () => {
    const { refresh } = mount({ asset: RECENT_ASSET, ivaCF: IVA_CF_ID });
    pickByCode(gananciaOPerdida(), PERDIDA.code);
    pickByCode(art66(), GASTO_IVA.code);
    refresh({ accounts: without(ACCOUNTS, GASTO_IVA) });
    expect(art66().value).toBe("");
    await confirmBlocked(ERR_ART66);
  });

  it("recuperación: elegir OTRA cuenta vigente permite confirmar y viaja la nueva, nunca la vieja", async () => {
    const { refresh } = mount();
    pickByCode(gananciaOPerdida(), PERDIDA.code);
    refresh({ accounts: withTitle(ACCOUNTS, PERDIDA) });
    pickByCode(gananciaOPerdida(), GASTO_IVA.code);
    const payload = await confirmOk();
    expect(payload.gainLossAccountId).toBe(GASTO_IVA.id);
  });

  it("un refresco que deja las cuentas elegidas igual (objetos nuevos) NO bloquea la baja", async () => {
    const { refresh } = mount();
    pickByCode(gananciaOPerdida(), PERDIDA.code);
    refresh({ accounts: ACCOUNTS.map((a) => ({ ...a })) });
    const payload = await confirmOk();
    expect(payload.gainLossAccountId).toBe(PERDIDA.id);
  });

  it("OTRAS cuentas que pasan a título o desaparecen NO invalidan la elegida", async () => {
    const { refresh } = mount();
    pickByCode(gananciaOPerdida(), PERDIDA.code);
    refresh({ accounts: without(withTitle(ACCOUNTS, GASTO_IVA), GANANCIA) });
    const payload = await confirmOk();
    expect(payload.gainLossAccountId).toBe(PERDIDA.id);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("DisposeAssetModal — Esc y cierre (es un modal propio, sin Radix)", () => {
  it("Esc con la lista del combobox abierta cierra SOLO la lista: el modal sigue abierto y onClose no se llama", () => {
    const { onClose } = mount();
    const input = gananciaOPerdida();
    openList(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByText("Dar de baja activo")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("«Cancelar» y la «×» siguen cerrando el modal", () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("«Confirmar baja» sigue con aria-busy=false y habilitado en reposo", () => {
    mount();
    expect(confirmBtn().getAttribute("aria-busy")).toBe("false");
    expect(confirmBtn().hasAttribute("disabled")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// SPEC-012 · B2 · paso 4 (cobertura): defensa en profundidad del payload. Una cuenta que ya no es elegible
// (título o ausente de la lista VIGENTE) NUNCA viaja, ni siquiera cuando `validate()` no la exige: el payload
// manda `null`. Se llega a ese estado cambiando de motivo/precio (el selector deja de ser obligatorio y se
// desmonta) y refrescando después la lista de cuentas.
describe("DisposeAssetModal — una cuenta obsoleta que `validate()` no exige viaja null (defensa en profundidad)", () => {
  it.each([
    { cuando: "pasa a ser un TÍTULO", lista: () => withTitle(ACCOUNTS, BANCO_M) },
    { cuando: "YA NO ESTÁ en la lista", lista: () => without(ACCOUNTS, BANCO_M) },
  ])(
    "la cuenta de cobro elegida en la venta y luego obsoleta ($cuando), con el motivo ya cambiado a obsolescencia: proceedsAccountId viaja null",
    async ({ lista }) => {
      const { refresh } = mount();
      setReason("SALE");
      setProceeds("8000");
      pickByCode(cobro(), BANCO_M.code);
      pickByCode(gananciaOPerdida(), GANANCIA.code);
      setReason("OBSOLETE"); // sin venta ya no se pide cuenta de cobro: el selector se desmonta
      expect(queryCobro()).toBeNull();
      refresh({ accounts: lista() });
      const payload = await confirmOk();
      expect(payload.proceedsAccountId).toBeNull();
      expect(payload.saleProceeds).toBe("0.00");
      expect(payload.gainLossAccountId).toBe(GANANCIA.id); // la otra cuenta sigue vigente y viaja
    }
  );

  it.each([
    { cuando: "pasa a ser un TÍTULO", lista: () => withTitle(ACCOUNTS, PERDIDA) },
    { cuando: "YA NO ESTÁ en la lista", lista: () => without(ACCOUNTS, PERDIDA) },
  ])(
    "la cuenta de pérdida elegida y luego obsoleta ($cuando), con la venta ya al valor en libros (sin ganancia ni pérdida): gainLossAccountId viaja null",
    async ({ lista }) => {
      const { refresh } = mount();
      pickByCode(gananciaOPerdida(), PERDIDA.code);
      setReason("SALE");
      setProceeds("6000"); // = valor en libros: ni ganancia ni pérdida, el selector se desmonta
      pickByCode(cobro(), BANCO_M.code);
      expect(screen.queryByLabelText(/Cuenta de (ganancia en venta|pérdida en baja)/)).toBeNull();
      refresh({ accounts: lista() });
      const payload = await confirmOk();
      expect(payload.gainLossAccountId).toBeNull();
      expect(payload.proceedsAccountId).toBe(BANCO_M.id); // la otra cuenta sigue vigente y viaja
      expect(payload.saleProceeds).toBe("6000.00");
    }
  );

  it("las dos a la vez: cobro y pérdida obsoletas, ninguna exigida ⇒ las dos viajan null y la baja se envía", async () => {
    const { refresh } = mount();
    setReason("SALE");
    setProceeds("8000");
    pickByCode(cobro(), BANCO_M.code);
    pickByCode(gananciaOPerdida(), GANANCIA.code);
    setProceeds("6000"); // sin ganancia: el selector de ganancia/pérdida se desmonta, el de cobro sigue
    expect(cobro().value).toBe(labelOf(BANCO_M));
    setReason("OBSOLETE");
    // OBSOLETE con valor en libros 6000 ⇒ pérdida: el selector reaparece con la cuenta de ganancia ya elegida
    refresh({ accounts: withTitle(withTitle(ACCOUNTS, BANCO_M), GANANCIA) });
    expect(gananciaOPerdida().value).toBe(""); // la elegida ahora es un título: inválido
    await confirmBlocked(ERR_PERDIDA); // aquí SÍ se exige (hay pérdida): no se envía
    pickByCode(gananciaOPerdida(), PERDIDA.code);
    const payload = await confirmOk();
    expect(payload.proceedsAccountId).toBeNull();
    expect(payload.gainLossAccountId).toBe(PERDIDA.id);
  });

  it("control: con las cuentas vigentes el cobro y la ganancia viajan con su id (no se anulan de más)", async () => {
    mount();
    setReason("SALE");
    setProceeds("8000");
    pickByCode(cobro(), BANCO_M.code);
    pickByCode(gananciaOPerdida(), GANANCIA.code);
    const payload = await confirmOk();
    expect(payload.proceedsAccountId).toBe(BANCO_M.id);
    expect(payload.gainLossAccountId).toBe(GANANCIA.id);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// A11y de las ayudas: cada selector se describe con SU texto de ayuda (`aria-describedby` → id del párrafo).
describe("DisposeAssetModal — cada selector queda descrito por su texto de ayuda", () => {
  const describedBy = (el: HTMLElement) =>
    (el.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();

  it("cuenta de cobro: «Cuenta donde se recibirá el dinero…»", () => {
    mount();
    setReason("SALE");
    setProceeds("8000");
    expect(describedBy(cobro())).toBe(
      "Cuenta donde se recibirá el dinero o se registra la CxC del comprador."
    );
  });

  it("ganancia: «Tipo REVENUE…»; pérdida: «Tipo EXPENSE…»", () => {
    mount();
    expect(describedBy(gananciaOPerdida())).toBe(
      "Tipo EXPENSE — pérdida por baja o venta bajo valor en libros."
    );
    setReason("SALE");
    setProceeds("8000");
    expect(describedBy(gananciaOPerdida())).toBe(
      "Tipo REVENUE — ingreso por venta sobre el valor en libros."
    );
  });

  it("gasto del Art. 66: «Tipo EXPENSE — el monto reintegrado…»", () => {
    mount({ asset: RECENT_ASSET, ivaCF: IVA_CF_ID });
    expect(describedBy(art66())).toBe(
      "Tipo EXPENSE — el monto reintegrado se cargará como gasto del período."
    );
  });

  it("los tres ids de ayuda son distintos entre sí (no se pisan)", () => {
    mount({ asset: RECENT_ASSET, ivaCF: IVA_CF_ID });
    setReason("SALE");
    setProceeds("8000");
    const ids = [cobro(), gananciaOPerdida(), art66()].map((el) =>
      el.getAttribute("aria-describedby")
    );
    expect(ids.every((id) => id && document.getElementById(id))).toBe(true);
    expect(new Set(ids).size).toBe(3);
  });
});
