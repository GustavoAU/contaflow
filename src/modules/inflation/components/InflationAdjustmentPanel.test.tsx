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
