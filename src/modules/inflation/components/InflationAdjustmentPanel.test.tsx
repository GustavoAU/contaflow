// @vitest-environment jsdom
// src/modules/inflation/components/InflationAdjustmentPanel.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase.
//
// SPEC-012 · ENTREGA B1 · paso 1 (modo RED) — «Ejecutar Ajuste por Inflación»: los dos selectores de
// cuenta pasan del <select> nativo a `AccountCombobox`:
//   · `adjustmentAccountId` (Patrimonio, OBLIGATORIO) con autoselección de la primera cuenta;
//   · `repomoAccountId` (Ingreso/Gasto, OPCIONAL: «Sin REPOMO» = "" → se envía `undefined`), con la
//     prop `clearable` (botón «Quitar la cuenta»).
//
// RN-19 (defecto latente que B1 activaría): hoy la autoselección es `equityAccounts[0]` /
// `repomoAccounts[0]`. Con títulos en la lista y el orden por código, el primero sería un TÍTULO. El
// default NUNCA es un título aunque vaya primero; con solo títulos el default es "" (botón «Vista
// Previa» deshabilitado). El aviso «No hay cuentas de Ingreso/Gasto…» cuenta solo cuentas de movimiento.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { InflationAdjustmentPanel } from "./InflationAdjustmentPanel";
import {
  PLAN,
  accessibleNames,
  accountComboboxes,
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

const { previewInflationAdjustmentAction, runInflationAdjustmentAction } = vi.hoisted(() => ({
  previewInflationAdjustmentAction: vi.fn(),
  runInflationAdjustmentAction: vi.fn(),
}));

vi.mock("../actions/inpc.actions", () => ({
  previewInflationAdjustmentAction,
  runInflationAdjustmentAction,
}));

const COMPANY_ID = "company-1";

/** Lo que entrega la página: PATRIMONIO y INGRESO/GASTO, con títulos y cuentas de movimiento. */
const EQUITY: PlanAccount[] = ofType(PLAN, "EQUITY");
const REPOMO: PlanAccount[] = ofType(PLAN, "REVENUE", "EXPENSE");
const CAPITAL = PLAN.find((a) => a.code === "3.1.01.01.001")!;
const RESERVA = PLAN.find((a) => a.code === "3.1.01.01.002")!;
const VENTAS = PLAN.find((a) => a.code === "4.1.01.01.001")!;
const VIAJE = PLAN.find((a) => a.code === "5.1.01.01.002")!;

const REPOMO_WARNING = /No hay cuentas de Ingreso\/Gasto disponibles para registrar el REPOMO/;

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  previewInflationAdjustmentAction.mockResolvedValue({
    success: true,
    data: { rows: [], repomo: null },
  });
});

afterEach(cleanup);

function renderPanel(
  equityAccounts: PlanAccount[] = EQUITY,
  repomoAccounts: PlanAccount[] = REPOMO
) {
  return render(
    <InflationAdjustmentPanel
      companyId={COMPANY_ID}
      equityAccounts={equityAccounts}
      repomoAccounts={repomoAccounts}
      inflationBaseYear={2024}
      inflationBaseMonth={1}
    />
  );
}

/** Los dos AccountCombobox: [Cuenta actualizadora (Patrimonio), Cuenta REPOMO]. */
function panelComboboxes(expected = 2) {
  return expectAccountComboboxes(expected, "Panel de ajuste por inflación");
}

const previewButton = () => screen.getByRole("button", { name: /Vista Previa|Calculando/ });
const clearButtons = () => screen.queryAllByRole("button", { name: "Quitar la cuenta" });

/** Pulsa el botón «Quitar la cuenta» (el único del panel: el de REPOMO). */
function clickClear() {
  const buttons = clearButtons();
  if (buttons.length !== 1) {
    throw new Error(`se esperaba UN botón «Quitar la cuenta» (REPOMO) y hay ${buttons.length}`);
  }
  fireEvent.click(buttons[0]);
}

async function clickPreview() {
  fireEvent.click(previewButton());
  await waitFor(() => expect(previewInflationAdjustmentAction).toHaveBeenCalledTimes(1));
  return previewInflationAdjustmentAction.mock.calls[0][0] as {
    companyId: string;
    adjustmentAccountId: string;
    repomoAccountId?: string;
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("InflationAdjustmentPanel — los dos selectores son AccountCombobox (SPEC-012 B1)", () => {
  it("hay dos <input role=combobox> (Patrimonio y REPOMO); el selector de mes SÍ sigue siendo nativo", () => {
    renderPanel();
    panelComboboxes(2);
    expect(document.querySelectorAll("select")).toHaveLength(1); // «Mes a ajustar»
  });

  it("D9: cada uno tiene su etiqueta asociada y un nombre accesible distinto", () => {
    renderPanel();
    const [equity, repomo] = panelComboboxes(2);
    expect(screen.getByLabelText(/Cuenta actualizadora/)).toBe(equity);
    expect(screen.getByLabelText(/Cuenta REPOMO/)).toBe(repomo);
    const names = accessibleNames();
    expect(names).toHaveLength(2);
    expect(names.every((n) => n.trim() !== "")).toBe(true);
    expect(new Set(names).size).toBe(2);
  });

  it("Patrimonio ofrece SOLO las cuentas de Patrimonio (con sus títulos como encabezados)", () => {
    renderPanel();
    const [equity] = panelComboboxes(2);
    openList(equity);
    expect(listedOptionLabels()).toEqual(movementLabels(EQUITY));
    expect(visibleHeaderNames()).toEqual(["PATRIMONIO", "CAPITALES", "APORTES", "CAPITAL"]);
  });

  it("REPOMO ofrece SOLO cuentas de Ingreso y Gasto (con sus títulos como encabezados)", () => {
    renderPanel();
    const [, repomo] = panelComboboxes(2);
    openList(repomo);
    expect(listedOptionLabels()).toEqual(movementLabels(REPOMO));
    expect(visibleHeaderNames()).toContain("INGRESOS");
    expect(visibleHeaderNames()).toContain("GASTOS");
    expect(visibleHeaderNames()).not.toContain("PATRIMONIO");
  });

  it("el `required` nativo no existe en ninguno de los dos", () => {
    renderPanel();
    for (const input of panelComboboxes(2)) expect(input.required).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("InflationAdjustmentPanel — autoselección que IGNORA los títulos (RN-19, CA-20)", () => {
  it("Patrimonio: el default es la primera CUENTA DE MOVIMIENTO, no el título «3» que va primero por código", () => {
    renderPanel();
    const [equity] = panelComboboxes(2);
    expect(equity.value).toBe(labelOf(CAPITAL));
    expect(equity.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("Patrimonio: el payload de «Vista Previa» lleva el id de esa cuenta, nunca el de un título", async () => {
    renderPanel();
    const payload = await clickPreview();
    expect(payload.adjustmentAccountId).toBe(CAPITAL.id);
    expect(payload.adjustmentAccountId.startsWith("t:")).toBe(false);
  });

  it("Patrimonio: un título con un nombre/código «mejor» al INICIO de la lista (varios títulos antes de la primera cuenta) tampoco se autoselecciona", () => {
    const equity = [
      titleAcc("3", "PATRIMONIO", "EQUITY"),
      titleAcc("3.1", "CAPITALES", "EQUITY"),
      titleAcc("3.1.01", "APORTES", "EQUITY"),
      titleAcc("3.1.01.01", "CAPITAL", "EQUITY"),
      titleAcc("3.1.01.02", "RESERVAS", "EQUITY"),
      moveAcc("3.1.01.02.001", "Reserva Legal", "EQUITY"),
      moveAcc("3.1.01.02.002", "Reserva Estatutaria", "EQUITY"),
    ];
    renderPanel(equity);
    const [input] = panelComboboxes(2);
    expect(input.value).toBe("3.1.01.02.001 — Reserva Legal");
  });

  it("Patrimonio con SOLO títulos: el default es «» (campo vacío y deshabilitado) y «Vista Previa» no se puede pulsar", async () => {
    renderPanel(ofType(PLAN, "EQUITY").filter((a) => !a.isPostable));
    const [equity] = panelComboboxes(2);
    expect(equity.value).toBe("");
    expect(equity.disabled).toBe(true);
    expect(previewButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(previewButton());
    await act(async () => {});
    expect(previewInflationAdjustmentAction).not.toHaveBeenCalled();
  });

  it("Patrimonio sin ninguna cuenta: «Vista Previa» deshabilitado y la acción no se llama", async () => {
    renderPanel([]);
    expect(previewButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(previewButton());
    await act(async () => {});
    expect(previewInflationAdjustmentAction).not.toHaveBeenCalled();
  });

  it("REPOMO: el default es la primera CUENTA DE MOVIMIENTO de la lista, no el título «4»", () => {
    renderPanel();
    const [, repomo] = panelComboboxes(2);
    expect(repomo.value).toBe(labelOf(VENTAS));
  });

  it("REPOMO: el payload lleva ese default (id de la cuenta, nunca de un título)", async () => {
    renderPanel();
    const payload = await clickPreview();
    expect(payload.repomoAccountId).toBe(VENTAS.id);
  });

  it("REPOMO con SOLO títulos: el default es «» y se envía `undefined`", async () => {
    renderPanel(
      EQUITY,
      REPOMO.filter((a) => !a.isPostable)
    );
    const payload = await clickPreview();
    expect(payload.repomoAccountId).toBeUndefined();
    expect(payload.adjustmentAccountId).toBe(CAPITAL.id);
  });

  it("la lista de REPOMO empieza con un título: se salta y se elige la primera cuenta de movimiento (aunque sea de otro grupo)", () => {
    const repomo = [
      titleAcc("5", "GASTOS", "EXPENSE"),
      titleAcc("5.1", "ADMINISTRATIVOS", "EXPENSE"),
      moveAcc("5.1.01.01.001", "Papelería y Útiles", "EXPENSE"),
    ];
    renderPanel(EQUITY, repomo);
    const [, input] = panelComboboxes(2);
    expect(input.value).toBe("5.1.01.01.001 — Papelería y Útiles");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("InflationAdjustmentPanel — los títulos no se pueden elegir", () => {
  it("clic sobre los encabezados de Patrimonio no cambia la cuenta elegida", () => {
    renderPanel();
    const [equity] = panelComboboxes(2);
    pressEveryHeader(equity, ["PATRIMONIO", "CAPITALES", "APORTES", "CAPITAL"]);
    fireEvent.blur(equity);
    expect(equity.value).toBe(labelOf(CAPITAL));
  });

  it("clic sobre los encabezados de REPOMO no cambia la cuenta elegida", () => {
    renderPanel();
    const [, repomo] = panelComboboxes(2);
    pressEveryHeader(repomo, [
      "INGRESOS",
      "OPERATIVOS",
      "VENTAS",
      "PRODUCTOS",
      "GASTOS",
      "OFICINA",
    ]);
    fireEvent.blur(repomo);
    expect(repomo.value).toBe(labelOf(VENTAS));
  });

  it("elegir otra cuenta de Patrimonio tecleando el código + Enter cambia el payload", async () => {
    renderPanel();
    const [equity] = panelComboboxes(2);
    pickByCode(equity, "310101002");
    expect(equity.value).toBe(labelOf(RESERVA));
    const payload = await clickPreview();
    expect(payload.adjustmentAccountId).toBe(RESERVA.id);
  });

  it("elegir otra cuenta de REPOMO tecleando el código + Enter cambia el payload", async () => {
    renderPanel();
    const [, repomo] = panelComboboxes(2);
    pickByCode(repomo, "5.1.01.01.002");
    expect(repomo.value).toBe(labelOf(VIAJE));
    const payload = await clickPreview();
    expect(payload.repomoAccountId).toBe(VIAJE.id);
  });

  it("el id de un título jamás llega a la acción, pase lo que pase con los encabezados", async () => {
    renderPanel();
    const [equity, repomo] = panelComboboxes(2);
    pressEveryHeader(equity, ["PATRIMONIO", "CAPITAL"]);
    fireEvent.blur(equity);
    pressEveryHeader(repomo, ["INGRESOS", "VENTAS"]);
    fireEvent.blur(repomo);
    const payload = await clickPreview();
    expect(payload.adjustmentAccountId.startsWith("t:")).toBe(false);
    expect(String(payload.repomoAccountId).startsWith("t:")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("InflationAdjustmentPanel — REPOMO opcional con `clearable` (D2, «— Sin REPOMO —»)", () => {
  it("con el default elegido hay UN botón «Quitar la cuenta» (el de REPOMO); Patrimonio es obligatorio y no lo tiene", () => {
    renderPanel();
    panelComboboxes(2);
    expect(clearButtons()).toHaveLength(1);
  });

  it("al quitar la cuenta REPOMO el campo queda vacío, el botón desaparece y se envía `repomoAccountId` undefined", async () => {
    renderPanel();
    const [equity, repomo] = panelComboboxes(2);
    clickClear();
    expect(repomo.value).toBe("");
    expect(clearButtons()).toHaveLength(0);
    expect(equity.value).toBe(labelOf(CAPITAL)); // la de Patrimonio no se toca
    const payload = await clickPreview();
    expect(payload.repomoAccountId).toBeUndefined();
    expect(payload.adjustmentAccountId).toBe(CAPITAL.id);
  });

  it("después de quitarla se puede volver a elegir una cuenta de REPOMO", async () => {
    renderPanel();
    const [, repomo] = panelComboboxes(2);
    clickClear();
    pickByCode(repomo, "510101001");
    expect(repomo.value).toBe("5.1.01.01.001 — Papelería y Útiles");
    expect(clearButtons()).toHaveLength(1);
    const payload = await clickPreview();
    expect(payload.repomoAccountId).toBe("m:5.1.01.01.001");
  });

  it("vaciar el TEXTO del campo y salir NO quita la cuenta (solo el botón lo hace)", () => {
    renderPanel();
    const [, repomo] = panelComboboxes(2);
    fireEvent.focus(repomo);
    fireEvent.change(repomo, { target: { value: "" } });
    fireEvent.blur(repomo);
    expect(repomo.value).toBe(labelOf(VENTAS));
  });

  it("tras la vista previa con REPOMO, la fila dice «se registra»; sin REPOMO dice «sin cuenta REPOMO»", async () => {
    const repomoRow = { netMonetaryPosition: "1000.00", factor: "1.2000", repomoAmount: "200.00" };
    previewInflationAdjustmentAction.mockResolvedValue({
      success: true,
      data: { rows: [], repomo: repomoRow },
    });
    renderPanel();
    fireEvent.click(previewButton());
    await screen.findByText("se registra");

    cleanup();
    previewInflationAdjustmentAction.mockClear();
    renderPanel();
    clickClear();
    fireEvent.click(previewButton());
    await screen.findByText("sin cuenta REPOMO");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("InflationAdjustmentPanel — RN-19: el aviso de REPOMO cuenta solo cuentas de movimiento", () => {
  it("con cuentas de movimiento de Ingreso/Gasto NO hay aviso", () => {
    renderPanel();
    expect(screen.queryByText(REPOMO_WARNING)).toBeNull();
  });

  it("sin ninguna cuenta de REPOMO: aviso visible", () => {
    renderPanel(EQUITY, []);
    expect(screen.getByText(REPOMO_WARNING)).toBeTruthy();
  });

  it("con SOLO títulos de Ingreso/Gasto: aviso visible (los títulos no cuentan) y ningún selector de REPOMO utilizable", () => {
    renderPanel(
      EQUITY,
      REPOMO.filter((a) => !a.isPostable)
    );
    expect(screen.getByText(REPOMO_WARNING)).toBeTruthy();
    const usable = accountComboboxes().filter((i) => !i.disabled);
    expect(usable).toHaveLength(1); // solo el de Patrimonio
    expect(screen.getByLabelText(/Cuenta actualizadora/)).toBe(usable[0]);
  });

  it("una sola cuenta de movimiento entre muchos títulos basta para quitar el aviso", () => {
    renderPanel(EQUITY, [...REPOMO.filter((a) => !a.isPostable), VENTAS]);
    expect(screen.queryByText(REPOMO_WARNING)).toBeNull();
    const [, repomo] = panelComboboxes(2);
    expect(repomo.disabled).toBe(false);
    openList(repomo);
    expect(listedOptionLabels()).toEqual([labelOf(VENTAS)]);
    expect(headerEl("VENTAS")).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("InflationAdjustmentPanel — confirmar el ajuste (el payload NO cambia)", () => {
  const previewRow = {
    accountId: "acc-1",
    accountCode: "1.1.01.01.001",
    accountName: "Caja Principal",
    accountType: "ASSET",
    originalBalance: "1000.00",
    adjustmentAmount: "200.00",
    cumulativeIndex: "1.200000",
    periodInpc: "120",
    baseInpc: "100",
  };

  it("«Confirmar y Registrar Ajuste» envía los mismos ids que la vista previa", async () => {
    previewInflationAdjustmentAction.mockResolvedValue({
      success: true,
      data: { rows: [previewRow], repomo: null },
    });
    runInflationAdjustmentAction.mockResolvedValue({
      success: true,
      data: { adjustedAccounts: 1, totalAdjustment: "200.00", factor: "1.2", repomo: null },
    });
    renderPanel();
    const [equity] = panelComboboxes(2);
    pickByCode(equity, "310101002");
    fireEvent.click(previewButton());
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar y Registrar Ajuste" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(runInflationAdjustmentAction).toHaveBeenCalledTimes(1));
    const payload = runInflationAdjustmentAction.mock.calls[0][0];
    expect(payload).toMatchObject({
      companyId: COMPANY_ID,
      adjustmentAccountId: RESERVA.id,
      repomoAccountId: VENTAS.id,
    });
    expect(Object.keys(payload).sort()).toEqual([
      "adjustmentAccountId",
      "companyId",
      "periodMonth",
      "periodYear",
      "repomoAccountId",
    ]);
    await screen.findByText(/Ajuste registrado: 1 cuentas/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// L-2 (revisión de seguridad de la Entrega B1) — TDD SPEC, modo RED: las cuentas elegidas se REVALIDAN
// con las listas vigentes.
//
// Hoy «Vista Previa» solo mira `!adjustmentAccountId` y el REPOMO se envía tal cual. El panel
// autoselecciona la primera cuenta de movimiento de cada lista al montarse (default) y NUNCA lo
// revisa: si tras un refresco de `equityAccounts` / `repomoAccounts` ese default (o lo elegido) deja de
// ser elegible (otro usuario lo convirtió en título, o ya no está en la lista), el combobox se ve vacío e
// inválido pero el botón sigue activo y envía el id viejo.
//
// Contrato:
//   · Cuenta actualizadora (OBLIGATORIA): la guarda y el `disabled` usan
//     `isSelectableAccountId(equityAccounts, adjustmentAccountId)`.
//   · REPOMO (OPCIONAL, «» = sin REPOMO): un REPOMO VACÍO sigue siendo válido; un REPOMO ELEGIDO que ya
//     no es elegible deja el botón deshabilitado (`isSelectableAccountId(repomoAccounts, repomoAccountId)`).
//   · El botón que EJECUTA el ajuste («Confirmar») tampoco puede enviar un id obsoleto.
//
// El refresco se simula con `rerender` sobre la MISMA instancia (el estado sobrevive; el default queda
// obsoleto). Un botón deshabilitado no dispara `onClick` en React: la guarda dentro del manejador no se
// puede aislar del `disabled` en este componente.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
const asTitle = (a: PlanAccount): PlanAccount => ({ ...a, isPostable: false });
/** La lista con `target` convertida en título (`isPostable: false`). */
const withTitle = (list: readonly PlanAccount[], target: PlanAccount): PlanAccount[] =>
  list.map((a) => (a.id === target.id ? asTitle(a) : a));
/** La lista sin `target`. */
const without = (list: readonly PlanAccount[], target: PlanAccount): PlanAccount[] =>
  list.filter((a) => a.id !== target.id);

type Lists = { equity?: PlanAccount[]; repomo?: PlanAccount[] };

/**
 * Monta el panel con los defaults (Capital Social y Ventas Gravadas, comprobado) y «Vista Previa»
 * habilitado (comprobado). `refresh({ equity, repomo })` = el padre entrega listas nuevas (la que no se
 * indica se queda como estaba al montar).
 */
function mountPanel() {
  const element = ({ equity = EQUITY, repomo = REPOMO }: Lists) => (
    <InflationAdjustmentPanel
      companyId={COMPANY_ID}
      equityAccounts={equity}
      repomoAccounts={repomo}
      inflationBaseYear={2024}
      inflationBaseMonth={1}
    />
  );
  const utils = render(element({}));
  const [adjustment, repomo] = panelComboboxes(2);
  expect(adjustment.value).toBe(labelOf(CAPITAL));
  expect(repomo.value).toBe(labelOf(VENTAS));
  expect(previewButton().hasAttribute("disabled")).toBe(false); // precondición: así SÍ se podría enviar
  return { adjustment, repomo, refresh: (lists: Lists) => utils.rerender(element(lists)) };
}

const OBSOLETE_EQUITY = [
  { when: "pasa a ser un TÍTULO", lists: (): Lists => ({ equity: withTitle(EQUITY, CAPITAL) }) },
  { when: "YA NO ESTÁ en la lista", lists: (): Lists => ({ equity: without(EQUITY, CAPITAL) }) },
];

describe.each(OBSOLETE_EQUITY)(
  "InflationAdjustmentPanel — L-2: la cuenta actualizadora por defecto $when tras refrescar la lista",
  ({ lists }) => {
    it("el combobox queda vacío e inválido y «Vista Previa» queda DESHABILITADO", () => {
      const { adjustment, refresh } = mountPanel();
      refresh(lists());
      expect(adjustment.value).toBe("");
      expect(adjustment.getAttribute("aria-invalid")).toBe("true");
      expect(previewButton().hasAttribute("disabled")).toBe(true);
    });

    it("hacer clic en «Vista Previa» NO llama a previewInflationAdjustmentAction", async () => {
      const { refresh } = mountPanel();
      refresh(lists());
      fireEvent.click(previewButton());
      await act(async () => {});
      expect(previewInflationAdjustmentAction).not.toHaveBeenCalled();
    });
  }
);

describe("InflationAdjustmentPanel — L-2: Patrimonio se queda sin NINGUNA cuenta de movimiento", () => {
  it("con solo títulos: campo deshabilitado, «Vista Previa» deshabilitado y sin llamada", async () => {
    const { adjustment, refresh } = mountPanel();
    refresh({ equity: EQUITY.filter((a) => !a.isPostable) });
    expect(adjustment.disabled).toBe(true);
    expect(previewButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(previewButton());
    await act(async () => {});
    expect(previewInflationAdjustmentAction).not.toHaveBeenCalled();
  });

  it("con la lista vacía: «Vista Previa» deshabilitado y sin llamada", async () => {
    const { refresh } = mountPanel();
    refresh({ equity: [] });
    expect(previewButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(previewButton());
    await act(async () => {});
    expect(previewInflationAdjustmentAction).not.toHaveBeenCalled();
  });
});

const OBSOLETE_REPOMO = [
  { when: "pasa a ser un TÍTULO", lists: (): Lists => ({ repomo: withTitle(REPOMO, VENTAS) }) },
  { when: "YA NO ESTÁ en la lista", lists: (): Lists => ({ repomo: without(REPOMO, VENTAS) }) },
];

describe.each(OBSOLETE_REPOMO)(
  "InflationAdjustmentPanel — L-2: la cuenta REPOMO elegida (opcional) $when tras refrescar la lista",
  ({ lists }) => {
    it("el combobox de REPOMO queda vacío e inválido y «Vista Previa» queda DESHABILITADO (aunque Patrimonio esté bien)", () => {
      const { adjustment, repomo, refresh } = mountPanel();
      refresh(lists());
      expect(repomo.value).toBe("");
      expect(repomo.getAttribute("aria-invalid")).toBe("true");
      expect(adjustment.value).toBe(labelOf(CAPITAL)); // la obligatoria sigue vigente
      expect(previewButton().hasAttribute("disabled")).toBe(true);
    });

    it("hacer clic en «Vista Previa» NO llama a previewInflationAdjustmentAction", async () => {
      const { refresh } = mountPanel();
      refresh(lists());
      fireEvent.click(previewButton());
      await act(async () => {});
      expect(previewInflationAdjustmentAction).not.toHaveBeenCalled();
    });
  }
);

describe("InflationAdjustmentPanel — L-2: a la lista de REPOMO no le queda NINGUNA cuenta de movimiento", () => {
  // AMBIGÜEDAD declarada en el reporte: con 0 cuentas de REPOMO el selector se oculta (aviso «No hay
  // cuentas de Ingreso/Gasto…») y el usuario no puede quitar el id viejo. El contrato solo fija que el
  // id obsoleto NUNCA llegue a la acción: o el botón queda deshabilitado, o se envía SIN REPOMO. Los
  // dos finales son válidos; lo que NO se admite es enviar el id viejo.
  it.each([
    { when: "solo quedan títulos", repomo: () => REPOMO.filter((a) => !a.isPostable) },
    { when: "la lista queda vacía", repomo: (): PlanAccount[] => [] },
  ])("$when: el id obsoleto de REPOMO nunca llega a la acción", async ({ repomo }) => {
    const { refresh } = mountPanel();
    refresh({ repomo: repomo() });
    expect(screen.getByText(REPOMO_WARNING)).toBeTruthy();
    fireEvent.click(previewButton()); // si está deshabilitado, React ignora el clic
    await act(async () => {});
    for (const call of previewInflationAdjustmentAction.mock.calls) {
      expect((call[0] as { repomoAccountId?: string }).repomoAccountId).toBeUndefined();
    }
  });
});

describe("InflationAdjustmentPanel — L-2: lo que NO debe cambiar (guardas verdes que matan mutantes)", () => {
  it("un refresco que deja las dos cuentas elegidas igual (objetos y arreglos nuevos): «Vista Previa» sigue habilitado y envía los mismos ids", async () => {
    const { refresh } = mountPanel();
    refresh({ equity: EQUITY.map((a) => ({ ...a })), repomo: REPOMO.map((a) => ({ ...a })) });
    expect(previewButton().hasAttribute("disabled")).toBe(false);
    const payload = await clickPreview();
    expect(payload.adjustmentAccountId).toBe(CAPITAL.id);
    expect(payload.repomoAccountId).toBe(VENTAS.id);
  });

  it("OTRAS cuentas que pasan a título o desaparecen NO invalidan las elegidas", async () => {
    const { adjustment, repomo, refresh } = mountPanel();
    refresh({
      equity: withTitle(EQUITY, RESERVA),
      repomo: without(withTitle(REPOMO, VIAJE), PLAN.find((a) => a.code === "5.1.01.01.001")!),
    });
    expect(adjustment.value).toBe(labelOf(CAPITAL));
    expect(repomo.value).toBe(labelOf(VENTAS));
    expect(previewButton().hasAttribute("disabled")).toBe(false);
    const payload = await clickPreview();
    expect(payload.adjustmentAccountId).toBe(CAPITAL.id);
    expect(payload.repomoAccountId).toBe(VENTAS.id);
  });

  it("un REPOMO VACÍO (quitado con el botón) sigue siendo válido aunque la lista cambie: «Vista Previa» habilitado y se envía sin REPOMO", async () => {
    const { repomo, refresh } = mountPanel();
    clickClear();
    expect(repomo.value).toBe("");
    refresh({ repomo: withTitle(REPOMO, VENTAS) });
    expect(previewButton().hasAttribute("disabled")).toBe(false);
    const payload = await clickPreview();
    expect(payload.repomoAccountId).toBeUndefined();
    expect(payload.adjustmentAccountId).toBe(CAPITAL.id);
  });

  it("un REPOMO VACÍO sigue siendo válido aunque la lista de REPOMO se quede sin cuentas de movimiento", async () => {
    const { refresh } = mountPanel();
    clickClear();
    refresh({ repomo: REPOMO.filter((a) => !a.isPostable) });
    expect(previewButton().hasAttribute("disabled")).toBe(false);
    const payload = await clickPreview();
    expect(payload.repomoAccountId).toBeUndefined();
    expect(payload.adjustmentAccountId).toBe(CAPITAL.id);
  });
});

describe("InflationAdjustmentPanel — L-2: recuperación tras un refresco que dejó una cuenta obsoleta", () => {
  it("Patrimonio: elegir OTRA cuenta vigente rehabilita «Vista Previa» y envía la nueva, nunca la vieja", async () => {
    const { adjustment, refresh } = mountPanel();
    refresh({ equity: withTitle(EQUITY, CAPITAL) });
    expect(previewButton().hasAttribute("disabled")).toBe(true);
    pickByCode(adjustment, "310101002");
    expect(adjustment.value).toBe(labelOf(RESERVA));
    expect(previewButton().hasAttribute("disabled")).toBe(false);
    const payload = await clickPreview();
    expect(payload.adjustmentAccountId).toBe(RESERVA.id);
  });

  it("Patrimonio: si la cuenta vuelve a ser elegible en el siguiente refresco, «Vista Previa» se rehabilita solo", async () => {
    const { refresh } = mountPanel();
    refresh({ equity: withTitle(EQUITY, CAPITAL) });
    expect(previewButton().hasAttribute("disabled")).toBe(true);
    refresh({});
    expect(previewButton().hasAttribute("disabled")).toBe(false);
    const payload = await clickPreview();
    expect(payload.adjustmentAccountId).toBe(CAPITAL.id);
  });

  it("REPOMO: elegir OTRA cuenta vigente rehabilita «Vista Previa» y envía la nueva, nunca la vieja", async () => {
    const { repomo, refresh } = mountPanel();
    refresh({ repomo: withTitle(REPOMO, VENTAS) });
    expect(previewButton().hasAttribute("disabled")).toBe(true);
    pickByCode(repomo, "5.1.01.01.002");
    expect(repomo.value).toBe(labelOf(VIAJE));
    expect(previewButton().hasAttribute("disabled")).toBe(false);
    const payload = await clickPreview();
    expect(payload.repomoAccountId).toBe(VIAJE.id);
  });

  it("REPOMO: «Quitar la cuenta» sobre el valor obsoleto lo deja vacío (válido): «Vista Previa» se rehabilita y se envía sin REPOMO", async () => {
    const { repomo, refresh } = mountPanel();
    refresh({ repomo: withTitle(REPOMO, VENTAS) });
    expect(previewButton().hasAttribute("disabled")).toBe(true);
    clickClear();
    expect(repomo.value).toBe("");
    expect(previewButton().hasAttribute("disabled")).toBe(false);
    const payload = await clickPreview();
    expect(payload.repomoAccountId).toBeUndefined();
    expect(payload.adjustmentAccountId).toBe(CAPITAL.id);
  });
});

describe("InflationAdjustmentPanel — L-2: el botón que EJECUTA el ajuste tampoco envía una cuenta obsoleta", () => {
  const PREVIEW_ROW = {
    accountId: "acc-1",
    accountCode: "1.1.01.01.001",
    accountName: "Caja Principal",
    accountType: "ASSET",
    originalBalance: "1000.00",
    adjustmentAmount: "200.00",
    cumulativeIndex: "1.200000",
    periodInpc: "120",
    baseInpc: "100",
  };

  beforeEach(() => {
    previewInflationAdjustmentAction.mockResolvedValue({
      success: true,
      data: { rows: [PREVIEW_ROW], repomo: null },
    });
    // Por si el código llegara a ejecutarlo: que no reviente con `undefined` y el fallo sea la aserción.
    runInflationAdjustmentAction.mockResolvedValue({
      success: true,
      data: { adjustedAccounts: 1, totalAdjustment: "200.00", factor: "1.2", repomo: null },
    });
  });

  /** Vista previa ya mostrada (botón «Confirmar y Registrar Ajuste» visible); `openPrompt` abre el «¿Registrar…?». */
  async function mountWithPreview({ openPrompt }: { openPrompt: boolean }) {
    const mounted = mountPanel();
    fireEvent.click(previewButton());
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar y Registrar Ajuste" }));
    if (!openPrompt) {
      // Se vuelve a la vista previa sin el aviso abierto: «Cancelar» cierra el «¿Registrar…?».
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    }
    return mounted;
  }

  /**
   * Recorre la UI como el usuario: abre el aviso si el botón lo permite y pulsa «Confirmar» si está
   * disponible. Un botón deshabilitado o ausente es una forma válida de bloquear (el contrato no
   * fija cuál); lo que importa es que la ejecución no salga.
   */
  async function tryToRunTheAdjustment() {
    const open = screen.queryByRole("button", { name: "Confirmar y Registrar Ajuste" });
    if (open && !open.hasAttribute("disabled")) fireEvent.click(open);
    const confirm = screen.queryByRole("button", { name: "Confirmar" });
    const confirmIsBlocked = confirm === null || confirm.hasAttribute("disabled");
    if (confirm && !confirm.hasAttribute("disabled")) fireEvent.click(confirm);
    await act(async () => {});
    return { confirmIsBlocked };
  }

  it("control: con las cuentas vigentes, «Confirmar» ejecuta el ajuste con los ids elegidos", async () => {
    await mountWithPreview({ openPrompt: true });
    const { confirmIsBlocked } = await tryToRunTheAdjustment();
    expect(confirmIsBlocked).toBe(false);
    await waitFor(() => expect(runInflationAdjustmentAction).toHaveBeenCalledTimes(1));
    expect(runInflationAdjustmentAction.mock.calls[0][0]).toMatchObject({
      adjustmentAccountId: CAPITAL.id,
      repomoAccountId: VENTAS.id,
    });
  });

  it.each([
    {
      cuando: "Patrimonio queda obsoleta con el aviso «¿Registrar…?» abierto",
      openPrompt: true,
      lists: (): Lists => ({ equity: withTitle(EQUITY, CAPITAL) }),
    },
    {
      cuando: "Patrimonio queda obsoleta con la vista previa mostrada (aviso cerrado)",
      openPrompt: false,
      lists: (): Lists => ({ equity: withTitle(EQUITY, CAPITAL) }),
    },
    {
      cuando: "Patrimonio desaparece de la lista con el aviso abierto",
      openPrompt: true,
      lists: (): Lists => ({ equity: without(EQUITY, CAPITAL) }),
    },
    {
      cuando: "REPOMO queda obsoleta con el aviso «¿Registrar…?» abierto",
      openPrompt: true,
      lists: (): Lists => ({ repomo: withTitle(REPOMO, VENTAS) }),
    },
    {
      cuando: "REPOMO queda obsoleta con la vista previa mostrada (aviso cerrado)",
      openPrompt: false,
      lists: (): Lists => ({ repomo: withTitle(REPOMO, VENTAS) }),
    },
    {
      cuando: "REPOMO desaparece de la lista con el aviso abierto",
      openPrompt: true,
      lists: (): Lists => ({ repomo: without(REPOMO, VENTAS) }),
    },
  ])(
    "cuando $cuando: «Confirmar» queda bloqueado y runInflationAdjustmentAction NO se llama",
    async ({ openPrompt, lists }) => {
      const { refresh } = await mountWithPreview({ openPrompt });
      refresh(lists());
      const { confirmIsBlocked } = await tryToRunTheAdjustment();
      expect(confirmIsBlocked).toBe(true);
      expect(runInflationAdjustmentAction).not.toHaveBeenCalled();
    }
  );
});
