// @vitest-environment jsdom
// src/modules/inventory/__tests__/MovementForm.accounts.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Lo que sigue en rojo FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase.
//
// SPEC-012 · ENTREGA B3 · paso 1 (modo RED) — registro de movimientos (`MovementForm`): la contrapartida
// (`counterpartAccountId`) pasa del <select> con <optgroup> + `FormData` a `AccountCombobox` con ESTADO (D6):
//   · POOL = las cuentas de los tipos que se ofrecen hoy MÁS los títulos de esos tipos. ENTRADA: Activo,
//     Pasivo, Patrimonio y Gasto, sin la cuenta de inventario del producto elegido y sin las que exigen
//     tercero (ADR-054). AJUSTE: Activo, Pasivo y Gasto, sin Patrimonio y SIN otros filtros (el servicio
//     ignora esa cuenta, PA-4, pero el formulario sigue exigiéndola). SALIDA: sin selector;
//   · los títulos son encabezados NO elegibles y nunca se autoseleccionan;
//   · sin `required` nativo: se valida al enviar con `isSelectableAccountId` tanto en ENTRADA como en AJUSTE;
//   · un valor que DEJA de ser elegible al cambiar de producto o de tipo se muestra vacío e inválido (D1,
//     `aria-invalid`) y NO se envía; uno que sigue siendo elegible no se toca;
//   · el estado se limpia tras `reset()`/éxito (D6) y una SALIDA nunca envía la contrapartida que quedó en el
//     estado; con un error de la action el formulario conserva lo escrito;
//   · se conservan `COUNTERPART_REQUIRED_MESSAGE` y `COUNTERPART_EMPTY_MESSAGE`; RN-19: el aviso «no hay
//     cuentas» cuenta solo cuentas de MOVIMIENTO elegibles.
//
// Lo que el contrato NO fija y aquí se comprueba de forma tolerante (declarado en el reporte): el texto del
// error de «sin cuenta» en AJUSTE y para un valor que dejó de ser elegible; y qué pasa con el valor al
// VOLVER a un tipo/producto donde sí sería elegible (no se prueba).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import {
  accessibleNames,
  accountComboboxes,
  describedByText,
  expectAccountComboboxes,
  labelOf,
  listedOptionLabels,
  moveAcc,
  movementLabels,
  newTextsSince,
  openList,
  pickByCode,
  press,
  pressEveryHeader,
  snapshotTexts,
  stubJsdomForListbox,
  titleAcc,
  typeInto,
  visibleHeaderNames,
} from "@/__tests__/helpers/account-combobox-forms";
import {
  AJUSTE_HINT,
  COMPANY_ID,
  COUNTERPART_EMPTY_MESSAGE,
  COUNTERPART_REQUIRED_MESSAGE,
  ENTRADA_HINT,
  ITEM_MERC,
  ITEM_MP,
  ITEM_SERVICIO,
  ITEM_SIN_CUENTA,
  chooseItem,
  chooseType,
  counterpart,
  fillCommon,
  fillEntrada,
  fillUnitCost,
  mountForm,
  productSelect,
  sentPayload,
  submitForm,
} from "./helpers/movement-form-kit";
import {
  AJUSTE_ACCOUNTS,
  ALL_TITLE_NAMES,
  ENTRADA_ACCOUNTS,
  INV_PLAN,
  A_BANCO,
  A_CAJA,
  A_INV_MERC,
  A_INV_MP,
  E_MERMAS,
  L_PROVEEDORES,
  Q_CAPITAL,
  Q_RESERVA,
  T_ACTIVO,
  T_CORRIENTE,
  T_EXIGIBLE,
  T_INVENTARIOS,
  T_OBLIGACIONES,
  T_PASIVO,
  T_POR_PAGAR,
  T_EXISTENCIAS,
  titleNamesOf,
} from "./helpers/inventory-plan";

vi.mock("../actions/inventory-operations.actions", () => ({
  createMovementAction: vi.fn(),
}));
vi.mock("../actions/inventory-uom.actions", () => ({
  listUomsAction: vi.fn(),
}));

import { createMovementAction } from "../actions/inventory-operations.actions";
import { listUomsAction } from "../actions/inventory-uom.actions";

const ENTRADA_LABELS = movementLabels(ENTRADA_ACCOUNTS);
const AJUSTE_LABELS = movementLabels(AJUSTE_ACCOUNTS);
const ENTRADA_TITLE_NAMES = ALL_TITLE_NAMES; // los cuatro tipos
const AJUSTE_TITLE_NAMES = titleNamesOf(INV_PLAN.filter((a) => a.type !== "EQUITY"));

/** Tipos que NUNCA se ofrecen como contrapartida: Ingreso y Contra-activo (con su título y su cuenta). */
const T_INGRESOS = { ...titleAcc("4", "INGRESOS", "REVENUE"), requiresThirdParty: false };
const R_VENTAS = {
  ...moveAcc("4.1.01.01.001", "Ventas Gravadas", "REVENUE"),
  requiresThirdParty: false,
};
const T_DEPRECIACION = {
  ...titleAcc("1.3", "DEPRECIACION", "CONTRA_ASSET"),
  requiresThirdParty: false,
};
const C_DEP_ACUM = {
  ...moveAcc("1.3.01.01.001", "Depreciación Acumulada", "CONTRA_ASSET"),
  requiresThirdParty: false,
};
const OTHER_TYPES = [T_INGRESOS, R_VENTAS, T_DEPRECIACION, C_DEP_ACUM];

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listUomsAction).mockResolvedValue({ success: true, data: [] } as never);
  vi.mocked(createMovementAction).mockResolvedValue({ success: true, data: "mov-1" } as never);
});

afterEach(cleanup);

/**
 * El envío queda BLOQUEADO: la action no se llama y aparece un texto NUEVO que habla de la cuenta o de la
 * contrapartida (el texto exacto del error en AJUSTE / valor no elegible no está fijado por el contrato).
 */
async function submitAndExpectBlocked() {
  const before = snapshotTexts();
  submitForm();
  await waitFor(() =>
    expect(newTextsSince(before).some((text) => /cuenta|contrapartida/i.test(text))).toBe(true)
  );
  expect(createMovementAction).not.toHaveBeenCalled();
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("MovementForm — la contrapartida es un AccountCombobox, no un <select> (SPEC-012 B3)", () => {
  it("ENTRADA: hay UN <input role=combobox> de cuenta y ningún <select> de cuenta (solo queda el de producto)", () => {
    mountForm();
    expectAccountComboboxes(1, "MovementForm (ENTRADA)");
    expect(document.querySelector('select[name="counterpartAccountId"]')).toBeNull();
    expect(document.querySelectorAll("select")).toHaveLength(1);
    expect(productSelect()).toBeTruthy();
  });

  it("D9: el combobox tiene nombre accesible (su etiqueta) y arranca VACÍO y sin marcar como inválido", () => {
    mountForm();
    const input = counterpart();
    const names = accessibleNames();
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/contrapartida/i);
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("en AJUSTE también es un <input role=combobox> con nombre accesible; en SALIDA no hay ninguno", () => {
    mountForm();
    chooseType("Ajuste");
    expectAccountComboboxes(1, "MovementForm (AJUSTE)");
    expect(accessibleNames()[0]).toMatch(/contrapartida/i);
    chooseType("Salida");
    expect(accountComboboxes()).toHaveLength(0);
  });

  it("la ayuda de cada tipo queda enlazada con aria-describedby (ENTRADA y AJUSTE)", () => {
    mountForm();
    expect(describedByText(counterpart())).toContain(ENTRADA_HINT);
    chooseType("Ajuste");
    expect(describedByText(counterpart())).toContain(AJUSTE_HINT);
    expect(describedByText(counterpart())).not.toContain(ENTRADA_HINT);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("MovementForm — qué se ofrece: las cuentas de hoy MÁS los títulos de esos tipos", () => {
  it("ENTRADA: SOLO las cuentas de movimiento de Activo/Pasivo/Patrimonio/Gasto sin tercero, con los títulos de los cuatro tipos como encabezados", () => {
    mountForm();
    openList(counterpart());
    expect(listedOptionLabels()).toEqual(ENTRADA_LABELS);
    expect(visibleHeaderNames(ALL_TITLE_NAMES)).toEqual(ENTRADA_TITLE_NAMES);
  });

  it("AJUSTE: Activo/Pasivo/Gasto SIN Patrimonio — y SIN ningún otro filtro: incluye las que exigen tercero", () => {
    mountForm();
    chooseType("Ajuste");
    openList(counterpart());
    expect(listedOptionLabels()).toEqual(AJUSTE_LABELS);
    expect(listedOptionLabels()).toContain(labelOf(L_PROVEEDORES));
    expect(listedOptionLabels()).not.toContain(labelOf(Q_CAPITAL));
    expect(listedOptionLabels()).not.toContain(labelOf(Q_RESERVA));
  });

  it("AJUSTE: los títulos de Patrimonio NO son encabezados (solo los de Activo, Pasivo y Gasto)", () => {
    mountForm();
    chooseType("Ajuste");
    openList(counterpart());
    expect(visibleHeaderNames(ALL_TITLE_NAMES)).toEqual(AJUSTE_TITLE_NAMES);
    expect(visibleHeaderNames(["PATRIMONIO", "CAPITALES", "APORTES", "CAPITAL"])).toEqual([]);
  });

  it("ENTRADA con producto: la cuenta de inventario de ESE producto no se ofrece; las demás de Activo sí", async () => {
    mountForm();
    await chooseItem(ITEM_MERC.id);
    openList(counterpart());
    expect(listedOptionLabels()).toEqual(
      movementLabels(ENTRADA_ACCOUNTS.filter((a) => a.id !== A_INV_MERC.id))
    );
    fireEvent.blur(counterpart());

    await chooseItem(ITEM_MP.id);
    openList(counterpart());
    expect(listedOptionLabels()).toEqual(
      movementLabels(ENTRADA_ACCOUNTS.filter((a) => a.id !== A_INV_MP.id))
    );
  });

  it("ENTRADA con un producto SIN cuenta de inventario: no se excluye ninguna", async () => {
    mountForm();
    await chooseItem(ITEM_SIN_CUENTA.id);
    openList(counterpart());
    expect(listedOptionLabels()).toEqual(ENTRADA_LABELS);
  });

  it("AJUSTE con producto: la cuenta de inventario del producto SÍ se ofrece (el filtro es solo de ENTRADA)", async () => {
    mountForm();
    chooseType("Ajuste");
    await chooseItem(ITEM_MERC.id);
    openList(counterpart());
    expect(listedOptionLabels()).toEqual(AJUSTE_LABELS);
    expect(listedOptionLabels()).toContain(labelOf(A_INV_MERC));
  });

  it.each([
    { tipo: "Entrada" as const, esperadas: ENTRADA_LABELS },
    { tipo: "Ajuste" as const, esperadas: AJUSTE_LABELS },
  ])(
    "$tipo: las cuentas de Ingreso y Contra-activo (y sus títulos) NO se ofrecen aunque lleguen en la lista",
    ({ tipo, esperadas }) => {
      mountForm({ counterpartAccounts: [...INV_PLAN, ...OTHER_TYPES] });
      chooseType(tipo);
      openList(counterpart());
      expect(listedOptionLabels()).toEqual(esperadas);
      expect(visibleHeaderNames(["INGRESOS", "DEPRECIACION"])).toEqual([]);
    }
  );

  it("se busca por nombre: «social» deja Capital Social bajo sus títulos y Enter la elige", () => {
    mountForm();
    const input = counterpart();
    openList(input);
    typeInto(input, "social");
    expect(listedOptionLabels()).toEqual([labelOf(Q_CAPITAL)]);
    expect(visibleHeaderNames(ALL_TITLE_NAMES)).toEqual([
      "PATRIMONIO",
      "CAPITALES",
      "APORTES",
      "CAPITAL",
    ]);
    press(input, "Enter");
    expect(input.value).toBe(labelOf(Q_CAPITAL));
  });

  it("se elige por código tecleándolo con o sin puntos (la búsqueda por nombre y por código sustituye a los grupos)", () => {
    mountForm();
    const input = counterpart();
    pickByCode(input, "3.1.01.01.002");
    expect(input.value).toBe(labelOf(Q_RESERVA));
    pickByCode(input, "510101002");
    expect(input.value).toBe(labelOf(E_MERMAS));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("MovementForm — los títulos NO se pueden elegir ni se autoseleccionan (CA-9 / RN-19)", () => {
  it("clic en los encabezados no elige nada: el campo sigue vacío y la ENTRADA no se envía", async () => {
    mountForm();
    await fillEntrada();
    const input = counterpart();
    pressEveryHeader(input, ALL_TITLE_NAMES);
    fireEvent.blur(input);
    expect(input.value).toBe("");

    submitForm();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(COUNTERPART_REQUIRED_MESSAGE);
    expect(createMovementAction).not.toHaveBeenCalled();
  });

  it("clic en los encabezados de AJUSTE tampoco elige nada y el AJUSTE no se envía", async () => {
    mountForm();
    chooseType("Ajuste");
    await chooseItem(ITEM_MERC.id);
    fillCommon("ACTA-1");
    const input = counterpart();
    pressEveryHeader(input, AJUSTE_TITLE_NAMES);
    fireEvent.blur(input);
    expect(input.value).toBe("");

    await submitAndExpectBlocked();
  });

  it("nada se autoselecciona: ni con un único título y una sola cuenta elegible", () => {
    mountForm({ counterpartAccounts: [T_INVENTARIOS, T_EXISTENCIAS, A_CAJA] });
    expect(counterpart().value).toBe("");
    openList(counterpart());
    expect(listedOptionLabels()).toEqual([labelOf(A_CAJA)]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("MovementForm — validación al enviar: sin `required` nativo, ENTRADA y AJUSTE (D5)", () => {
  it("el combobox no lleva `required` ni en ENTRADA ni en AJUSTE", () => {
    mountForm();
    expect(counterpart().required).toBe(false);
    chooseType("Ajuste");
    expect(counterpart().required).toBe(false);
  });

  it("ENTRADA sin cuenta elegida: role=alert con el mensaje de siempre y la action NO se llama", async () => {
    mountForm();
    await fillEntrada();
    submitForm();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(COUNTERPART_REQUIRED_MESSAGE);
    expect(createMovementAction).not.toHaveBeenCalled();
  });

  it("AJUSTE sin cuenta elegida: la action NO se llama y se avisa de la cuenta (antes lo hacía el `required` nativo)", async () => {
    mountForm();
    chooseType("Ajuste");
    await chooseItem(ITEM_MERC.id);
    fillCommon("ACTA-1");
    await submitAndExpectBlocked();
  });

  it("AJUSTE con cuenta: la action recibe type AJUSTE y la contrapartida elegida (el servicio la ignora, el formulario la envía)", async () => {
    mountForm();
    chooseType("Ajuste");
    await chooseItem(ITEM_MERC.id);
    fillCommon("ACTA-1", "2");
    pickByCode(counterpart(), E_MERMAS.code);

    submitForm();

    await waitFor(() => expect(createMovementAction).toHaveBeenCalledTimes(1));
    expect(createMovementAction).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      itemId: ITEM_MERC.id,
      type: "AJUSTE",
      quantity: 2,
      unitCost: undefined,
      reference: "ACTA-1",
      notes: null,
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/),
      idempotencyKey: expect.any(String),
      unitId: undefined,
      counterpartAccountId: E_MERMAS.id,
      exchangeRateVes: "36.5",
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("MovementForm — un valor que DEJA de ser elegible se ve vacío e inválido y no se envía (D1)", () => {
  it("ENTRADA→AJUSTE con Patrimonio elegido: el campo queda vacío e inválido y el AJUSTE no se envía", async () => {
    mountForm();
    await chooseItem(ITEM_MERC.id);
    pickByCode(counterpart(), Q_CAPITAL.code);
    expect(counterpart().value).toBe(labelOf(Q_CAPITAL));
    expect(counterpart().getAttribute("aria-invalid")).not.toBe("true");

    chooseType("Ajuste");

    expect(counterpart().value).toBe("");
    expect(counterpart().getAttribute("aria-invalid")).toBe("true");
    fillCommon("ACTA-2");
    await submitAndExpectBlocked();
  });

  it("ENTRADA→AJUSTE con una cuenta que sigue siendo elegible (Caja): se conserva, no es inválida y se envía", async () => {
    mountForm();
    await chooseItem(ITEM_MERC.id);
    pickByCode(counterpart(), A_CAJA.code);

    chooseType("Ajuste");

    expect(counterpart().value).toBe(labelOf(A_CAJA));
    expect(counterpart().getAttribute("aria-invalid")).not.toBe("true");
    fillCommon("ACTA-3", "4");
    submitForm();
    await waitFor(() => expect(createMovementAction).toHaveBeenCalledTimes(1));
    expect(sentPayload()).toMatchObject({
      type: "AJUSTE",
      quantity: 4,
      counterpartAccountId: A_CAJA.id,
    });
  });

  it("AJUSTE→ENTRADA con una cuenta que exige tercero: queda vacía e inválida y la ENTRADA no se envía", async () => {
    mountForm();
    chooseType("Ajuste");
    pickByCode(counterpart(), L_PROVEEDORES.code);
    expect(counterpart().value).toBe(labelOf(L_PROVEEDORES));

    chooseType("Entrada");

    expect(counterpart().value).toBe("");
    expect(counterpart().getAttribute("aria-invalid")).toBe("true");
    await chooseItem(ITEM_MERC.id);
    fillCommon("F-9");
    fillUnitCost();
    await submitAndExpectBlocked();
  });

  it("cambiar al producto cuya cuenta de inventario es la elegida (ENTRADA): vacío e inválido, no se envía; elegir otra lo arregla", async () => {
    mountForm();
    await chooseItem(ITEM_MERC.id);
    pickByCode(counterpart(), A_INV_MP.code);
    expect(counterpart().value).toBe(labelOf(A_INV_MP));

    await chooseItem(ITEM_MP.id);

    expect(counterpart().value).toBe("");
    expect(counterpart().getAttribute("aria-invalid")).toBe("true");
    fillCommon("F-10");
    fillUnitCost();
    await submitAndExpectBlocked();

    pickByCode(counterpart(), A_BANCO.code);
    expect(counterpart().getAttribute("aria-invalid")).not.toBe("true");
    submitForm();
    await waitFor(() => expect(createMovementAction).toHaveBeenCalledTimes(1));
    expect(sentPayload()).toMatchObject({
      itemId: ITEM_MP.id,
      counterpartAccountId: A_BANCO.id,
    });
  });

  it("cambiar de producto NO toca una cuenta que sigue siendo elegible", async () => {
    mountForm();
    await chooseItem(ITEM_MERC.id);
    pickByCode(counterpart(), A_BANCO.code);

    await chooseItem(ITEM_MP.id);

    expect(counterpart().value).toBe(labelOf(A_BANCO));
    expect(counterpart().getAttribute("aria-invalid")).not.toBe("true");
  });

  it("D1 con la lista refrescada: si la cuenta elegida pasa a ser título, el campo se ve vacío y no se envía", async () => {
    const { refresh } = mountForm();
    await fillEntrada(A_BANCO);
    refresh({
      counterpartAccounts: INV_PLAN.map((a) =>
        a.id === A_BANCO.id ? { ...a, isPostable: false } : a
      ),
    });
    expect(counterpart().value).toBe("");
    submitForm();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeNull());
    expect(createMovementAction).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("MovementForm — el estado se limpia tras el éxito y no se filtra a la SALIDA (D6)", () => {
  it("tras un registro correcto el combobox queda VACÍO y sin marcar como inválido", async () => {
    mountForm();
    await fillEntrada(A_BANCO);

    submitForm();

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(createMovementAction).toHaveBeenCalledTimes(1);
    expect(counterpart().value).toBe("");
    expect(counterpart().getAttribute("aria-invalid")).not.toBe("true");
  });

  it("…y un segundo registro SIN volver a elegir cuenta se bloquea: la cuenta anterior no se reenvía", async () => {
    mountForm();
    await fillEntrada(A_BANCO);
    submitForm();
    await screen.findByRole("status");
    expect(createMovementAction).toHaveBeenCalledTimes(1);

    await fillEntrada(); // todo lleno otra vez, SIN elegir contrapartida
    submitForm();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(COUNTERPART_REQUIRED_MESSAGE);
    expect(createMovementAction).toHaveBeenCalledTimes(1);
  });

  it("tras un AJUSTE correcto el formulario vuelve a ENTRADA con el combobox vacío (y también vacío al volver a AJUSTE)", async () => {
    mountForm();
    chooseType("Ajuste");
    await chooseItem(ITEM_MERC.id);
    fillCommon("ACTA-4");
    pickByCode(counterpart(), E_MERMAS.code);

    submitForm();

    await screen.findByRole("status");
    expect(counterpart().value).toBe(""); // ya es la ENTRADA del reinicio
    expect(screen.getByText(ENTRADA_HINT)).toBeTruthy();
    chooseType("Ajuste");
    expect(counterpart().value).toBe("");
  });

  it("si la action devuelve un error el combobox CONSERVA la cuenta elegida", async () => {
    vi.mocked(createMovementAction).mockResolvedValue({
      success: false,
      error: "Período cerrado",
    } as never);
    mountForm();
    await fillEntrada(A_BANCO);

    submitForm();

    expect((await screen.findByRole("alert")).textContent).toBe("Período cerrado");
    expect(counterpart().value).toBe(labelOf(A_BANCO));
  });

  it("SALIDA nunca envía la contrapartida que quedó en el estado de una ENTRADA anterior", async () => {
    mountForm();
    await chooseItem(ITEM_MERC.id);
    pickByCode(counterpart(), A_BANCO.code);

    chooseType("Salida");
    fillCommon("OD-1", "3");
    submitForm();

    await waitFor(() => expect(createMovementAction).toHaveBeenCalledTimes(1));
    const sent = sentPayload();
    expect(sent.type).toBe("SALIDA");
    expect(sent.counterpartAccountId).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("MovementForm — RN-19: el aviso «no hay cuentas» cuenta SOLO cuentas de movimiento elegibles", () => {
  it("ENTRADA con SOLO títulos: aviso de qué crear y el combobox no es utilizable", () => {
    mountForm({ counterpartAccounts: INV_PLAN.filter((a) => !a.isPostable) });
    expect(screen.getByText(COUNTERPART_EMPTY_MESSAGE)).toBeTruthy();
    expect(counterpart().disabled).toBe(true);
  });

  it("ENTRADA con títulos y cuentas de movimiento: sin aviso y el combobox habilitado", () => {
    mountForm();
    expect(screen.queryByText(COUNTERPART_EMPTY_MESSAGE)).toBeNull();
    expect(counterpart().disabled).toBe(false);
  });

  it("ENTRADA: si la ÚNICA cuenta de movimiento es la de inventario del producto, el aviso aparece al elegirlo", async () => {
    mountForm({
      counterpartAccounts: [T_ACTIVO, T_CORRIENTE, T_INVENTARIOS, T_EXISTENCIAS, A_INV_MERC],
    });
    expect(screen.queryByText(COUNTERPART_EMPTY_MESSAGE)).toBeNull();
    expect(counterpart().disabled).toBe(false);

    await chooseItem(ITEM_MERC.id);

    expect(screen.getByText(COUNTERPART_EMPTY_MESSAGE)).toBeTruthy();
    expect(counterpart().disabled).toBe(true);
  });

  it("ENTRADA: si la ÚNICA cuenta de movimiento exige tercero, también hay aviso; en AJUSTE esa cuenta sí se ofrece", () => {
    mountForm({
      counterpartAccounts: [T_PASIVO, T_EXIGIBLE, T_OBLIGACIONES, T_POR_PAGAR, L_PROVEEDORES],
    });
    expect(screen.getByText(COUNTERPART_EMPTY_MESSAGE)).toBeTruthy();
    expect(counterpart().disabled).toBe(true);

    chooseType("Ajuste");

    expect(counterpart().disabled).toBe(false);
    openList(counterpart());
    expect(listedOptionLabels()).toEqual([labelOf(L_PROVEEDORES)]);
  });

  it("AJUSTE con SOLO títulos: el combobox no es utilizable y el AJUSTE no se puede enviar", async () => {
    mountForm({ counterpartAccounts: INV_PLAN.filter((a) => !a.isPostable) });
    chooseType("Ajuste");
    expect(counterpart().disabled).toBe(true);
    await chooseItem(ITEM_MERC.id);
    fillCommon("ACTA-5");
    await submitAndExpectBlocked();
  });

  it("un pool de SOLO Patrimonio (títulos y cuentas) no deja nada que elegir en AJUSTE", () => {
    mountForm({
      counterpartAccounts: INV_PLAN.filter((a) => a.type === "EQUITY"),
    });
    chooseType("Ajuste");
    expect(counterpart().disabled).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("MovementForm — R-06 con el combobox y el producto elegido (el orden de las validaciones)", () => {
  it("un Servicio en ENTRADA con la contrapartida ya elegida sigue dando el error de R-06 y no llama a la action", async () => {
    mountForm();
    pickByCode(counterpart(), A_BANCO.code);
    await chooseItem(ITEM_SERVICIO.id);
    fillCommon("DOC-2");
    fillUnitCost();

    submitForm();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Los productos de tipo Servicio no tienen stock físico/);
    expect(createMovementAction).not.toHaveBeenCalled();
  });
});
