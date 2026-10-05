// @vitest-environment jsdom
// SPEC-007 paso 4 — MovementForm: la ENTRADA lleva contrapartida obligatoria.
//   - Selector asociado a su etiqueta (htmlFor/id), `required`, agrupado por tipo de cuenta
//     y con Patrimonio (Capital) disponible solo en ENTRADA.
//   - La cuenta de inventario del producto elegido no se ofrece como contrapartida.
//   - AJUSTE no cambia (PA-4): selector requerido, sin Patrimonio.
//   - Botón de envío con disabled + aria-busy mientras isPending.
//   - Un error de negocio devuelto por la action se muestra con role="alert".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MovementForm } from "../components/MovementForm";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../actions/inventory-operations.actions", () => ({
  createMovementAction: vi.fn(),
}));
vi.mock("../actions/inventory-uom.actions", () => ({
  listUomsAction: vi.fn(),
}));

import { createMovementAction } from "../actions/inventory-operations.actions";
import { listUomsAction } from "../actions/inventory-uom.actions";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const INVENTORY_ACCOUNT_ID = "acc-inventario";

const ITEMS = [
  {
    id: "item-1",
    sku: "SKU-001",
    name: "Harina de trigo",
    unit: "kg",
    stockQuantity: "10",
    averageCost: "5",
    itemType: "PRODUCT",
    accountId: INVENTORY_ACCOUNT_ID,
  },
];

const ACCOUNTS = [
  { id: "acc-caja", code: "110101001", name: "Caja", type: "ASSET" },
  { id: "acc-banco", code: "110102001", name: "Banco Mercantil", type: "ASSET" },
  { id: INVENTORY_ACCOUNT_ID, code: "110301001", name: "Inventario de mercancía", type: "ASSET" },
  { id: "acc-cxp", code: "210101001", name: "Cuentas por pagar", type: "LIABILITY" },
  { id: "acc-capital", code: "310101001", name: "Capital social", type: "EQUITY" },
  { id: "acc-mermas", code: "610101001", name: "Mermas", type: "EXPENSE" },
];

const BASE_PROPS = {
  companyId: "company-1",
  items: ITEMS,
  counterpartAccounts: ACCOUNTS,
  currentBcvRate: "36.5",
};

const COUNTERPART_LABEL = /Cuenta contrapartida/;

// ── Helpers ───────────────────────────────────────────────────────────────────

function counterpartSelect(): HTMLSelectElement {
  return screen.getByLabelText(COUNTERPART_LABEL) as HTMLSelectElement;
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /Registrar movimiento|Registrando/ });
}

function chooseType(label: "Entrada" | "Salida" | "Ajuste") {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
}

// Elige el producto y espera a que termine la carga de unidades (evita avisos de act()).
async function chooseItem() {
  fireEvent.change(screen.getByDisplayValue("Seleccionar producto..."), {
    target: { value: "item-1" },
  });
  await waitFor(() => expect(listUomsAction).toHaveBeenCalled());
}

// Llena los campos obligatorios de una ENTRADA (la fecha y la tasa traen valor por defecto).
async function fillEntrada(counterpartId: string) {
  await chooseItem();
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "5" } });
  fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "10" } });
  fireEvent.change(screen.getByPlaceholderText(/Nro\. factura de compra/), {
    target: { value: "F-001-2345" },
  });
  if (counterpartId) {
    fireEvent.change(counterpartSelect(), { target: { value: counterpartId } });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listUomsAction).mockResolvedValue({ success: true, data: [] } as never);
  vi.mocked(createMovementAction).mockResolvedValue({ success: true, data: "mov-1" } as never);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MovementForm — contrapartida obligatoria en ENTRADA (SPEC-007)", () => {
  it("ENTRADA (tipo por defecto): el selector existe, es required y está asociado a su etiqueta", () => {
    render(<MovementForm {...BASE_PROPS} />);

    const select = counterpartSelect();
    expect(select.tagName).toBe("SELECT");
    expect(select.required).toBe(true);
    expect(select.name).toBe("counterpartAccountId");

    // La etiqueta apunta al selector mediante htmlFor/id
    const label = document.querySelector(`label[for="${select.id}"]`);
    expect(label).not.toBeNull();
    expect(label?.textContent).toMatch(COUNTERPART_LABEL);
  });

  it("ENTRADA: muestra la ayuda de la contadora, enlazada con aria-describedby", () => {
    render(<MovementForm {...BASE_PROPS} />);

    const hint =
      "Seleccione de dónde sale el dinero o qué origina la entrada: Banco o Caja si fue de contado, o Capital solo si es un aporte de socios (por ejemplo, al constituir la empresa). Una compra a crédito se registra con su factura de compra.";
    const hintEl = screen.getByText(hint);
    expect(counterpartSelect().getAttribute("aria-describedby")).toBe(hintEl.id);
  });

  it("ENTRADA: ofrece Capital (Patrimonio) y agrupa las opciones por tipo de cuenta", () => {
    render(<MovementForm {...BASE_PROPS} />);

    const select = counterpartSelect();
    const groups = Array.from(select.querySelectorAll("optgroup")).map((g) => g.label);
    expect(groups).toEqual(["Activo", "Pasivo", "Patrimonio", "Gasto"]);

    const patrimonio = within(select).getByRole("group", { name: "Patrimonio" });
    expect(within(patrimonio).getByRole("option", { name: /Capital social/ })).toBeTruthy();

    // Banco/Caja (Activo) y Cuentas por pagar (Pasivo) también están disponibles
    expect(within(select).getByRole("option", { name: /Banco Mercantil/ })).toBeTruthy();
    expect(within(select).getByRole("option", { name: /Cuentas por pagar/ })).toBeTruthy();
  });

  it("ENTRADA: la cuenta de inventario del producto elegido no se ofrece como contrapartida", async () => {
    render(<MovementForm {...BASE_PROPS} />);

    // Sin producto elegido todavía no hay nada que excluir
    expect(
      within(counterpartSelect()).queryByRole("option", { name: /Inventario de mercancía/ })
    ).not.toBeNull();

    await chooseItem();

    const select = counterpartSelect();
    expect(within(select).queryByRole("option", { name: /Inventario de mercancía/ })).toBeNull();
    // El resto de cuentas de Activo sigue disponible
    expect(within(select).getByRole("option", { name: /Caja/ })).toBeTruthy();
  });

  // ADR-054: las cuentas que exigen tercero (Cuentas por pagar a proveedores) no se ofrecen en una
  // ENTRADA sin factura: el movimiento no registra tercero y el gate de Prisma rechazaría el
  // asiento al contabilizar. Una compra a crédito va con su factura de compra.
  it("ENTRADA: no ofrece las cuentas que exigen tercero (ADR-054)", () => {
    const accounts = [
      ...ACCOUNTS,
      {
        id: "acc-cxp-prov",
        code: "210102001",
        name: "Cuentas por pagar a proveedores",
        type: "LIABILITY",
        requiresThirdParty: true,
      },
    ];
    render(<MovementForm {...BASE_PROPS} counterpartAccounts={accounts} />);

    const select = counterpartSelect();
    expect(
      within(select).queryByRole("option", { name: /Cuentas por pagar a proveedores/ })
    ).toBeNull();
    // Las demás contrapartidas siguen disponibles
    expect(within(select).getByRole("option", { name: /Cuentas por pagar$/ })).toBeTruthy();
    expect(within(select).getByRole("option", { name: /Capital social/ })).toBeTruthy();
  });

  it("SALIDA: el selector de contrapartida no aparece", () => {
    render(<MovementForm {...BASE_PROPS} />);
    expect(screen.queryByLabelText(COUNTERPART_LABEL)).not.toBeNull();

    chooseType("Salida");

    expect(screen.queryByLabelText(COUNTERPART_LABEL)).toBeNull();
    expect(screen.queryByText(/Capital solo si es un aporte de socios/)).toBeNull();
  });

  it("AJUSTE no cambia (PA-4): selector requerido, con su ayuda de siempre y sin Patrimonio", () => {
    render(<MovementForm {...BASE_PROPS} />);

    chooseType("Ajuste");

    const select = counterpartSelect();
    expect(select.required).toBe(true);
    expect(
      screen.getByText(/Seleccione la cuenta de ajuste: Mermas \(gasto\) para sobrantes\/faltas/)
    ).toBeTruthy();
    expect(within(select).queryByRole("option", { name: /Capital social/ })).toBeNull();
    expect(within(select).getByRole("option", { name: /Mermas/ })).toBeTruthy();
  });

  it("ENTRADA sin contrapartida: no llama a la action y muestra el mensaje con role=alert", async () => {
    const { container } = render(<MovementForm {...BASE_PROPS} />);
    await fillEntrada(""); // todo lo demás lleno, contrapartida sin elegir

    // fireEvent.submit se salta la validación nativa de `required`: es la red del cliente
    fireEvent.submit(container.querySelector("form")!);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Seleccione la cuenta de contrapartida/);
    expect(alert.textContent).toMatch(/Capital solo si es un aporte de socios/);
    expect(createMovementAction).not.toHaveBeenCalled();
  });

  it("ENTRADA con contrapartida: envía counterpartAccountId a la action", async () => {
    const { container } = render(<MovementForm {...BASE_PROPS} />);
    await fillEntrada("acc-capital");

    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(createMovementAction).toHaveBeenCalledTimes(1));
    expect(createMovementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        itemId: "item-1",
        type: "ENTRADA",
        counterpartAccountId: "acc-capital",
      })
    );
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("isPending: el botón queda disabled y con aria-busy mientras la action responde", async () => {
    let resolveAction!: (v: unknown) => void;
    vi.mocked(createMovementAction).mockImplementation(
      () => new Promise((resolve) => (resolveAction = resolve)) as never
    );
    const { container } = render(<MovementForm {...BASE_PROPS} />);
    await fillEntrada("acc-banco");

    // En reposo: habilitado y sin busy
    expect(submitButton().disabled).toBe(false);
    expect(submitButton().getAttribute("aria-busy")).toBe("false");

    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(submitButton().disabled).toBe(true));
    expect(submitButton().getAttribute("aria-busy")).toBe("true");
    expect(submitButton().textContent).toMatch(/Registrando/);

    resolveAction({ success: true, data: "mov-1" });
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    expect(submitButton().getAttribute("aria-busy")).toBe("false");
  });

  it("muestra al usuario el error de negocio que devuelve la action", async () => {
    const businessError =
      "La cuenta de contrapartida no puede ser la misma cuenta de inventario del producto.";
    vi.mocked(createMovementAction).mockResolvedValue({
      success: false,
      error: businessError,
    } as never);
    const { container } = render(<MovementForm {...BASE_PROPS} />);
    await fillEntrada("acc-banco");

    fireEvent.submit(container.querySelector("form")!);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(businessError);
    // El formulario conserva lo escrito: el usuario corrige y reintenta
    expect(counterpartSelect().value).toBe("acc-banco");
  });

  it("ENTRADA sin cuentas disponibles: avisa qué cuentas crear en el Plan de Cuentas", () => {
    render(<MovementForm {...BASE_PROPS} counterpartAccounts={[]} />);

    expect(screen.getByText(/No hay cuentas disponibles para la contrapartida/)).toBeTruthy();
  });
});
