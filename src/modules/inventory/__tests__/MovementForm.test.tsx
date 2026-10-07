// @vitest-environment jsdom
// src/modules/inventory/__tests__/MovementForm.test.tsx
//
// SPEC-007 paso 4, ADAPTADO a SPEC-012 · ENTREGA B3 (modo RED): MovementForm — la ENTRADA lleva
// contrapartida obligatoria, y ahora la contrapartida es un `AccountCombobox` (`<input role="combobox">`) en
// lugar del <select> con <optgroup>:
//   - Combobox asociado a su etiqueta (htmlFor/id), SIN `required` nativo (el formulario valida al enviar),
//     con TODAS las cuentas en una sola lista jerárquica (la búsqueda por nombre sustituye a los grupos).
//   - La cuenta de inventario del producto elegido no se ofrece como contrapartida; en ENTRADA tampoco las
//     que exigen tercero (ADR-054).
//   - AJUSTE no cambia (PA-4): contrapartida requerida, sin Patrimonio.
//   - Botón de envío con disabled + aria-busy mientras isPending.
//   - Un error de negocio devuelto por la action se muestra con role="alert".
// Las reglas NUEVAS de B3 (títulos, cambio de producto/tipo, estado limpio) están en
// `MovementForm.accounts.test.tsx`. Aquí, además, las guardas VERDES de lo que no cambia: stock, SERVICE
// (R-06), unidades alternativas, tasa BCV y el payload de SALIDA.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import {
  accountComboboxes,
  describedByText,
  labelOf,
  listedOptionLabels,
  movementLabels,
  openList,
  pickByCode,
  stubJsdomForListbox,
  visibleHeaderNames,
} from "@/__tests__/helpers/account-combobox-forms";
import {
  AJUSTE_HINT,
  COMPANY_ID,
  COUNTERPART_EMPTY_MESSAGE,
  COUNTERPART_LABEL,
  COUNTERPART_REQUIRED_MESSAGE,
  ENTRADA_HINT,
  ITEM_MERC,
  ITEM_SERVICIO,
  SERVICE_BLOCKED_MESSAGE,
  chooseItem,
  chooseType,
  counterpart,
  field,
  fillCommon,
  fillEntrada,
  mountForm,
  productSelect,
  sentPayload,
  submitButton,
  submitForm,
} from "./helpers/movement-form-kit";
import {
  AJUSTE_ACCOUNTS,
  ALL_TITLE_NAMES,
  ENTRADA_ACCOUNTS,
  A_BANCO,
  A_CAJA,
  A_INV_MERC,
  A_INV_MP,
  E_MERMAS,
  L_PROVEEDORES,
  L_RETENCIONES,
  Q_CAPITAL,
} from "./helpers/inventory-plan";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../actions/inventory-operations.actions", () => ({
  createMovementAction: vi.fn(),
}));
vi.mock("../actions/inventory-uom.actions", () => ({
  listUomsAction: vi.fn(),
}));

import { createMovementAction } from "../actions/inventory-operations.actions";
import { listUomsAction } from "../actions/inventory-uom.actions";

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listUomsAction).mockResolvedValue({ success: true, data: [] } as never);
  vi.mocked(createMovementAction).mockResolvedValue({ success: true, data: "mov-1" } as never);
});

afterEach(cleanup);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MovementForm — contrapartida obligatoria en ENTRADA (SPEC-007) con AccountCombobox (SPEC-012 B3)", () => {
  it("ENTRADA (tipo por defecto): la contrapartida es un combobox, sin `required` nativo y asociado a su etiqueta", () => {
    mountForm();

    const input = counterpart();
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.required).toBe(false);
    expect(document.querySelector('select[name="counterpartAccountId"]')).toBeNull();

    // La etiqueta apunta al combobox mediante htmlFor/id
    const label = document.querySelector(`label[for="${input.id}"]`);
    expect(label).not.toBeNull();
    expect(label?.textContent).toMatch(COUNTERPART_LABEL);
  });

  it("ENTRADA: muestra la ayuda de la contadora, enlazada con aria-describedby", () => {
    mountForm();

    const hintEl = screen.getByText(ENTRADA_HINT);
    const describedBy = (counterpart().getAttribute("aria-describedby") ?? "").split(/\s+/);
    expect(describedBy).toContain(hintEl.id);
    expect(describedByText(counterpart())).toContain(ENTRADA_HINT);
  });

  it("ENTRADA: ofrece Capital (Patrimonio) y las cuentas de Activo, Pasivo y Gasto en UNA lista jerárquica (ya no hay grupos)", () => {
    mountForm();

    openList(counterpart());
    expect(listedOptionLabels()).toEqual(movementLabels(ENTRADA_ACCOUNTS));
    expect(document.querySelectorAll("optgroup")).toHaveLength(0);
    // Los títulos de los cuatro tipos son los encabezados de la lista
    expect(visibleHeaderNames(ALL_TITLE_NAMES)).toEqual(ALL_TITLE_NAMES);

    // Capital (Patrimonio), Banco/Caja (Activo) y Retenciones por pagar (Pasivo) están disponibles
    const labels = listedOptionLabels();
    expect(labels).toContain(labelOf(Q_CAPITAL));
    expect(labels).toContain(labelOf(A_BANCO));
    expect(labels).toContain(labelOf(L_RETENCIONES));
  });

  it("ENTRADA: la cuenta de inventario del producto elegido no se ofrece como contrapartida", async () => {
    mountForm();

    // Sin producto elegido todavía no hay nada que excluir
    openList(counterpart());
    expect(listedOptionLabels()).toContain(labelOf(A_INV_MERC));
    fireEvent.blur(counterpart());

    await chooseItem(ITEM_MERC.id);

    openList(counterpart());
    expect(listedOptionLabels()).not.toContain(labelOf(A_INV_MERC));
    // El resto de cuentas de Activo sigue disponible
    expect(listedOptionLabels()).toContain(labelOf(A_CAJA));
    expect(listedOptionLabels()).toContain(labelOf(A_INV_MP));
  });

  // ADR-054: las cuentas que exigen tercero (Cuentas por pagar a proveedores) no se ofrecen en una
  // ENTRADA sin factura: el movimiento no registra tercero y el gate de Prisma rechazaría el
  // asiento al contabilizar. Una compra a crédito va con su factura de compra.
  it("ENTRADA: no ofrece las cuentas que exigen tercero (ADR-054)", () => {
    mountForm();

    openList(counterpart());
    const labels = listedOptionLabels();
    expect(labels).not.toContain(labelOf(L_PROVEEDORES));
    // Las demás contrapartidas siguen disponibles
    expect(labels).toContain(labelOf(L_RETENCIONES));
    expect(labels).toContain(labelOf(Q_CAPITAL));
  });

  it("SALIDA: el selector de contrapartida no aparece", () => {
    mountForm();
    expect(screen.queryByLabelText(COUNTERPART_LABEL)).not.toBeNull();

    chooseType("Salida");

    expect(screen.queryByLabelText(COUNTERPART_LABEL)).toBeNull();
    expect(accountComboboxes()).toHaveLength(0);
    expect(screen.queryByText(/Capital solo si es un aporte de socios/)).toBeNull();
  });

  it("AJUSTE no cambia (PA-4): contrapartida con su ayuda de siempre, sin Patrimonio y sin `required` nativo", () => {
    mountForm();

    chooseType("Ajuste");

    const input = counterpart();
    expect(input.required).toBe(false);
    expect(screen.getByText(AJUSTE_HINT)).toBeTruthy();
    openList(input);
    const labels = listedOptionLabels();
    expect(labels).toEqual(movementLabels(AJUSTE_ACCOUNTS));
    expect(labels).not.toContain(labelOf(Q_CAPITAL));
    expect(labels).toContain(labelOf(E_MERMAS));
  });

  it("ENTRADA sin contrapartida: no llama a la action y muestra el mensaje con role=alert", async () => {
    mountForm();
    await fillEntrada(); // todo lo demás lleno, contrapartida sin elegir

    // fireEvent.submit se salta la validación nativa de `required`: es la red del cliente
    submitForm();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(COUNTERPART_REQUIRED_MESSAGE);
    expect(createMovementAction).not.toHaveBeenCalled();
  });

  it("ENTRADA con contrapartida: envía counterpartAccountId a la action", async () => {
    mountForm();
    await fillEntrada(Q_CAPITAL);
    expect(counterpart().value).toBe(labelOf(Q_CAPITAL));

    submitForm();

    await waitFor(() => expect(createMovementAction).toHaveBeenCalledTimes(1));
    expect(createMovementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        itemId: ITEM_MERC.id,
        type: "ENTRADA",
        counterpartAccountId: Q_CAPITAL.id,
      })
    );
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("ENTRADA completa: el payload de la action conserva TODOS los demás campos", async () => {
    mountForm();
    await fillEntrada(A_BANCO);

    submitForm();

    await waitFor(() => expect(createMovementAction).toHaveBeenCalledTimes(1));
    expect(createMovementAction).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      itemId: ITEM_MERC.id,
      type: "ENTRADA",
      quantity: 5,
      unitCost: "10",
      reference: "F-001-2345",
      notes: null,
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/),
      idempotencyKey: expect.any(String),
      unitId: undefined,
      counterpartAccountId: A_BANCO.id,
      exchangeRateVes: "36.5",
    });
  });

  it("isPending: el botón queda disabled y con aria-busy mientras la action responde", async () => {
    let resolveAction!: (v: unknown) => void;
    vi.mocked(createMovementAction).mockImplementation(
      () => new Promise((resolve) => (resolveAction = resolve)) as never
    );
    mountForm();
    await fillEntrada(A_BANCO);

    // En reposo: habilitado y sin busy
    expect(submitButton().hasAttribute("disabled")).toBe(false);
    expect(submitButton().getAttribute("aria-busy")).toBe("false");

    submitForm();

    await waitFor(() => expect(submitButton().hasAttribute("disabled")).toBe(true));
    expect(submitButton().getAttribute("aria-busy")).toBe("true");
    expect(submitButton().textContent).toMatch(/Registrando/);

    resolveAction({ success: true, data: "mov-1" });
    await waitFor(() => expect(submitButton().hasAttribute("disabled")).toBe(false));
    expect(submitButton().getAttribute("aria-busy")).toBe("false");
  });

  it("muestra al usuario el error de negocio que devuelve la action", async () => {
    const businessError =
      "La cuenta de contrapartida no puede ser la misma cuenta de inventario del producto.";
    vi.mocked(createMovementAction).mockResolvedValue({
      success: false,
      error: businessError,
    } as never);
    mountForm();
    await fillEntrada(A_BANCO);

    submitForm();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(businessError);
    // El formulario conserva lo escrito: el usuario corrige y reintenta
    expect(counterpart().value).toBe(labelOf(A_BANCO));
  });

  it("ENTRADA sin cuentas disponibles: avisa qué cuentas crear en el Plan de Cuentas", () => {
    mountForm({ counterpartAccounts: [] });

    expect(screen.getByText(COUNTERPART_EMPTY_MESSAGE)).toBeTruthy();
    expect(counterpart().disabled).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Guardas VERDES: lo que B3 no toca (stock, SERVICE R-06, unidades alternativas, tasa BCV, SALIDA).
describe("MovementForm — lo que NO cambia con el combobox (guardas)", () => {
  const stockFmt = (n: string) =>
    parseFloat(n).toLocaleString("es-VE", { maximumFractionDigits: 2 });
  const cppFmt = (n: string) =>
    parseFloat(n).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  it("al elegir un producto muestra su stock actual y su CPP vigente", async () => {
    mountForm();
    await chooseItem(ITEM_MERC.id);

    const info = screen.getByText(/Stock actual:/);
    expect(info.textContent).toBe(
      `Stock actual: ${stockFmt(ITEM_MERC.stockQuantity)} kg · CPP vigente: ${cppFmt(ITEM_MERC.averageCost)} Bs.`
    );
    expect(screen.getByText(/^Unidad:/).textContent).toBe("Unidad: kg");
  });

  it("SALIDA: avisa que el costo unitario se toma del CPP vigente", async () => {
    mountForm();
    chooseType("Salida");
    await chooseItem(ITEM_MERC.id);

    expect(screen.getByText(/Costo unitario se toma del CPP vigente automáticamente/)).toBeTruthy();
    // y ya no se pide costo unitario
    expect(screen.queryByPlaceholderText("0,00")).toBeNull();
  });

  it("el selector de producto lista cada producto con su stock y marca los servicios", () => {
    mountForm();
    const options = Array.from(productSelect().options).map((o) => o.textContent ?? "");
    expect(options[0]).toBe("Seleccionar producto...");
    expect(options).toContain(`[SKU-001] Harina de trigo — Stock: ${stockFmt("10")} kg`);
    expect(options.some((t) => t.includes("Asesoría contable") && t.includes("Servicio"))).toBe(
      true
    );
  });

  it.each([{ tipo: "Entrada" as const }, { tipo: "Salida" as const }])(
    "R-06: un Servicio no admite $tipo — error de R-06 ANTES que cualquier otro y la action no se llama",
    async ({ tipo }) => {
      mountForm();
      chooseType(tipo);
      await chooseItem(ITEM_SERVICIO.id);
      expect(screen.getByText(/Servicio:/)).toBeTruthy();
      expect(screen.getByText(/Solo se permiten Ajustes de corrección/)).toBeTruthy();
      fillCommon("DOC-1", "2");

      submitForm();

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe(SERVICE_BLOCKED_MESSAGE);
      expect(createMovementAction).not.toHaveBeenCalled();
    }
  );

  it("R-06: un Servicio SÍ admite Ajuste (sin stock físico), con su contrapartida", async () => {
    mountForm();
    chooseType("Ajuste");
    await chooseItem(ITEM_SERVICIO.id);
    fillCommon("ACTA-9", "2");
    pickByCode(counterpart(), E_MERMAS.code);

    submitForm();

    await waitFor(() => expect(createMovementAction).toHaveBeenCalledTimes(1));
    expect(sentPayload()).toMatchObject({
      itemId: ITEM_SERVICIO.id,
      type: "AJUSTE",
      counterpartAccountId: E_MERMAS.id,
    });
  });

  describe("unidades alternativas", () => {
    const UNITS = [
      { id: "u-kg", name: "Kilogramo", abbreviation: "kg", conversionFactor: "1", isBase: true },
      { id: "u-saco", name: "Saco", abbreviation: "sc", conversionFactor: "50", isBase: false },
    ];
    const unitSelect = () =>
      screen.getByText("Unidad de registro").parentElement!.querySelector("select")!;

    beforeEach(() => {
      vi.mocked(listUomsAction).mockResolvedValue({ success: true, data: UNITS } as never);
    });

    it("con más de una unidad aparece «Unidad de registro» con la base preseleccionada", async () => {
      mountForm();
      chooseType("Salida");
      await chooseItem(ITEM_MERC.id);

      expect(unitSelect().value).toBe("u-kg");
      expect(Array.from(unitSelect().options).map((o) => o.value)).toEqual(["u-kg", "u-saco"]);
      expect(screen.queryByText(/La cantidad se convertirá/)).toBeNull();
    });

    it("con la unidad base elegida el payload no lleva unitId", async () => {
      mountForm();
      chooseType("Salida");
      await chooseItem(ITEM_MERC.id);
      fillCommon("OD-1", "3");

      submitForm();

      await waitFor(() => expect(createMovementAction).toHaveBeenCalledTimes(1));
      expect(sentPayload().unitId).toBeUndefined();
    });

    it("con una unidad alternativa avisa la conversión y el payload lleva su unitId", async () => {
      mountForm();
      chooseType("Salida");
      await chooseItem(ITEM_MERC.id);
      fireEvent.change(unitSelect(), { target: { value: "u-saco" } });
      expect(screen.getByText(/La cantidad se convertirá: 1 sc = 50 kg/)).toBeTruthy();
      fillCommon("OD-2", "3");

      submitForm();

      await waitFor(() => expect(createMovementAction).toHaveBeenCalledTimes(1));
      expect(sentPayload()).toMatchObject({
        itemId: ITEM_MERC.id,
        quantity: 3,
        unitId: "u-saco",
      });
    });
  });

  describe("tasa BCV (R-02)", () => {
    it("arranca con la tasa vigente; es obligatoria en ENTRADA y «(referencial)» en SALIDA y AJUSTE", () => {
      mountForm();
      expect(field("exchangeRateVes").value).toBe("36.5");
      expect(field("exchangeRateVes").required).toBe(true);
      expect(screen.queryByText("(referencial)")).toBeNull();

      chooseType("Salida");
      expect(field("exchangeRateVes").required).toBe(false);
      expect(screen.getByText("(referencial)")).toBeTruthy();

      chooseType("Ajuste");
      expect(field("exchangeRateVes").required).toBe(false);
      expect(screen.getByText("(referencial)")).toBeTruthy();
    });

    it("sin tasa vigente el campo arranca vacío y la SALIDA no envía tasa", async () => {
      mountForm({ currentBcvRate: undefined });
      expect(field("exchangeRateVes").value).toBe("");
      chooseType("Salida");
      await chooseItem(ITEM_MERC.id);
      fillCommon("OD-3", "1");

      submitForm();

      await waitFor(() => expect(createMovementAction).toHaveBeenCalledTimes(1));
      expect(sentPayload().exchangeRateVes).toBeUndefined();
    });
  });

  it("SALIDA: el payload no lleva contrapartida ni costo unitario y conserva el resto de campos", async () => {
    mountForm();
    chooseType("Salida");
    await chooseItem(ITEM_MERC.id);
    fillCommon("OD-77", "3");
    fireEvent.change(field("notes"), { target: { value: "Despacho a sucursal" } });

    submitForm();

    await waitFor(() => expect(createMovementAction).toHaveBeenCalledTimes(1));
    expect(createMovementAction).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      itemId: ITEM_MERC.id,
      type: "SALIDA",
      quantity: 3,
      unitCost: undefined,
      reference: "OD-77",
      notes: "Despacho a sucursal",
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/),
      idempotencyKey: expect.any(String),
      unitId: undefined,
      counterpartAccountId: undefined,
      exchangeRateVes: "36.5",
    });
    expect(sentPayload().counterpartAccountId).toBeUndefined();
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("tras un registro correcto se vacía el producto y se llama a onSuccess", async () => {
    const { onSuccess } = mountForm();
    chooseType("Salida");
    await chooseItem(ITEM_MERC.id);
    fillCommon("OD-5", "2");

    submitForm();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(productSelect().value).toBe("");
    expect(field("reference").value).toBe("");
  });
});
