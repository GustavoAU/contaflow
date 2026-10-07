// @vitest-environment jsdom
// src/modules/inventory/__tests__/MovementForm.state.test.tsx
//
// SPEC-012 B3 · paso 4 (mutantes, test-agent): el ESTADO de la contrapartida (decisiones 3 y 4 de la sesión
// principal y D6):
//   · el campo se marca inválido SOLO tras un envío rechazado (`counterpartChecked`), se desmarca al elegir una
//     cuenta válida y se reinicia tras un guardado correcto (no queda «inválido» sobre el campo ya vacío);
//   · cada tipo tiene su mensaje de «falta la contrapartida» (ENTRADA: Banco/Caja/Capital; AJUSTE: cuenta de ajuste);
//   · un id que dejó de ser elegible (otro tipo o producto) se CONSERVA en el estado: si el usuario vuelve a
//     donde sí es elegible, REAPARECE (no se limpia).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

import {
  labelOf,
  pickByCode,
  stubJsdomForListbox,
} from "@/__tests__/helpers/account-combobox-forms";
import {
  COUNTERPART_REQUIRED_MESSAGE,
  ITEM_MERC,
  ITEM_MP,
  chooseItem,
  chooseType,
  counterpart,
  fillCommon,
  fillEntrada,
  fillUnitCost,
  mountForm,
  sentPayload,
  submitForm,
} from "./helpers/movement-form-kit";
import { A_BANCO, A_INV_MP, Q_CAPITAL } from "./helpers/inventory-plan";

vi.mock("../actions/inventory-operations.actions", () => ({ createMovementAction: vi.fn() }));
vi.mock("../actions/inventory-uom.actions", () => ({ listUomsAction: vi.fn() }));

import { createMovementAction } from "../actions/inventory-operations.actions";
import { listUomsAction } from "../actions/inventory-uom.actions";

const AJUSTE_REQUIRED_MESSAGE = "Seleccione la cuenta de ajuste (contrapartida).";
const FIELD_ERROR = "Selecciona una cuenta de movimiento.";

const isMarkedInvalid = () => counterpart().getAttribute("aria-invalid") === "true";
const describedBy = () => counterpart().getAttribute("aria-describedby") ?? "";

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listUomsAction).mockResolvedValue({ success: true, data: [] } as never);
  vi.mocked(createMovementAction).mockResolvedValue({ success: true, data: "mov-1" } as never);
});

afterEach(cleanup);

describe("MovementForm — el campo se marca inválido solo tras un envío rechazado", () => {
  it("antes de enviar nada: ni aria-invalid ni mensaje de campo", () => {
    mountForm();
    expect(isMarkedInvalid()).toBe(false);
    expect(screen.queryByText(FIELD_ERROR)).toBeNull();
  });

  it("ENTRADA rechazada: aria-invalid, mensaje de campo enlazado por aria-describedby y mensaje de ENTRADA en el role=alert", async () => {
    mountForm();
    await fillEntrada();
    submitForm();
    expect((await screen.findByRole("alert")).textContent).toBe(COUNTERPART_REQUIRED_MESSAGE);
    expect(isMarkedInvalid()).toBe(true);
    const error = screen.getByText(FIELD_ERROR);
    expect(describedBy().split(/\s+/)).toContain(error.id);
  });

  it("AJUSTE rechazado: mensaje PROPIO de AJUSTE (no el de Banco/Caja/Capital) y campo inválido", async () => {
    mountForm();
    chooseType("Ajuste");
    await chooseItem(ITEM_MERC.id);
    fillCommon("ACTA-7");
    submitForm();
    expect((await screen.findByRole("alert")).textContent).toBe(AJUSTE_REQUIRED_MESSAGE);
    expect(isMarkedInvalid()).toBe(true);
  });

  it("elegir una cuenta válida tras el rechazo desmarca el campo y retira el mensaje de campo", async () => {
    mountForm();
    await fillEntrada();
    submitForm();
    await screen.findByRole("alert");
    pickByCode(counterpart(), A_BANCO.code);
    expect(isMarkedInvalid()).toBe(false);
    expect(screen.queryByText(FIELD_ERROR)).toBeNull();
    expect(describedBy()).not.toContain("-error");
  });

  it("rechazo → elegir cuenta → registro correcto: el campo queda vacío y NO vuelve a marcarse inválido", async () => {
    mountForm();
    await fillEntrada();
    submitForm();
    await screen.findByRole("alert");
    pickByCode(counterpart(), A_BANCO.code);
    submitForm();
    await screen.findByRole("status");
    expect(createMovementAction).toHaveBeenCalledTimes(1);
    expect(counterpart().value).toBe("");
    expect(isMarkedInvalid()).toBe(false);
    expect(screen.queryByText(FIELD_ERROR)).toBeNull();
  });
});

describe("MovementForm — un id que dejó de ser elegible se conserva y REAPARECE al volver (decisión 4)", () => {
  it("ENTRADA → AJUSTE → ENTRADA con Patrimonio: se ve vacío en AJUSTE, reaparece en ENTRADA y la ENTRADA se envía con él", async () => {
    mountForm();
    await chooseItem(ITEM_MERC.id);
    pickByCode(counterpart(), Q_CAPITAL.code);
    chooseType("Ajuste");
    expect(counterpart().value).toBe("");
    chooseType("Entrada");
    expect(counterpart().value).toBe(labelOf(Q_CAPITAL));
    expect(isMarkedInvalid()).toBe(false);
    fillCommon("F-77");
    fillUnitCost();
    submitForm();
    await waitFor(() => expect(createMovementAction).toHaveBeenCalledTimes(1));
    expect(sentPayload().counterpartAccountId).toBe(Q_CAPITAL.id);
  });

  it("producto A → producto B (su cuenta de inventario) → producto A: la cuenta reaparece", async () => {
    mountForm();
    await chooseItem(ITEM_MERC.id);
    pickByCode(counterpart(), A_INV_MP.code);
    await chooseItem(ITEM_MP.id);
    expect(counterpart().value).toBe("");
    await chooseItem(ITEM_MERC.id);
    expect(counterpart().value).toBe(labelOf(A_INV_MP));
    expect(isMarkedInvalid()).toBe(false);
  });
});
