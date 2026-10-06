// @vitest-environment jsdom
// src/components/accounting/JournalEntryForm.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Todo lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase.
//
// SPEC-012 CA-16 (Entrega A, paso 1, modo RED) — la columna «Cuenta» del asiento manual usa el
// AccountCombobox buscable: tecleando el código (`110101001` + Enter) se elige la cuenta, el payload
// lleva su accountId, y un título (encabezado) no se puede elegir.
//
// Estos tests deben fallar HOY por aserción real: el control actual es un `Select` de Radix (un
// <button role="combobox">), no un <input> de búsqueda; `accountInputs()` exige 2 <input
// role="combobox"> (uno por fila). Se localizan por rol y por orden de aparición (el nombre accesible
// exacto lo fija el ui-agent; solo se exige que sea no vacío, distinto por fila y que diga «cuenta»).
//
// Los importes se teclean como los teclea el contador: coma decimal en MoneyInput (`100,10` →
// canónico `100.10`), ver src/components/ui/money-input.tsx.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { JournalEntryForm } from "./JournalEntryForm";

const { createTransactionAction, push, toastSuccess, toastError } = vi.hoisted(() => ({
  createTransactionAction: vi.fn(),
  push: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/modules/accounting/actions/transaction.actions", () => ({ createTransactionAction }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
  Toaster: () => null,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────

type FormAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  isPostable: boolean;
};
const title = (id: string, code: string, name: string, type: string): FormAccount => ({
  id,
  code,
  name,
  type,
  isPostable: false,
});

/** Plan de la SPEC: títulos de 1 a 4 niveles y una cuenta de movimiento por rama. */
const ACCOUNTS: FormAccount[] = [
  title("t-1", "1", "ACTIVO", "ASSET"),
  title("t-1-1", "1.1", "CORRIENTE", "ASSET"),
  title("t-1-1-01", "1.1.01", "DISPONIBLE", "ASSET"),
  title("t-1-1-01-01", "1.1.01.01", "CAJAS", "ASSET"),
  {
    id: "m-caja",
    code: "1.1.01.01.001",
    name: "Caja Principal",
    type: "ASSET",
    isPostable: true,
  },
  title("t-2", "2", "PASIVO", "LIABILITY"),
  title("t-2-1", "2.1", "EXIGIBLE", "LIABILITY"),
  title("t-2-1-01", "2.1.01", "OBLIGACIONES", "LIABILITY"),
  title("t-2-1-01-01", "2.1.01.01", "PROVEEDORES", "LIABILITY"),
  {
    id: "m-prov",
    code: "2.1.01.01.001",
    name: "Proveedores",
    type: "LIABILITY",
    isPostable: true,
  },
];
const CAJA_LABEL = "1.1.01.01.001 — Caja Principal";
const PROV_LABEL = "2.1.01.01.001 — Proveedores";
const TITLE_IDS = ACCOUNTS.filter((a) => !a.isPostable).map((a) => a.id);

const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const DESCRIPTION = "Pago a proveedor";

// ─── jsdom ───────────────────────────────────────────────────────────────────────────────────────

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  createTransactionAction.mockResolvedValue({ success: true, data: { number: "AS-0001" } });
});

afterEach(cleanup);

// ─── Helpers ─────────────────────────────────────────────────────────────────────────────────────

function renderForm() {
  return render(<JournalEntryForm companyId={COMPANY_ID} userId={USER_ID} accounts={ACCOUNTS} />);
}

/** Los <input role="combobox"> de la columna «Cuenta» (el «Tipo» es un botón combobox de Radix). */
function accountInputs(expected = 2): HTMLInputElement[] {
  const inputs = screen
    .queryAllByRole("combobox")
    .filter((el): el is HTMLInputElement => el.tagName === "INPUT");
  expect(
    inputs,
    `la columna «Cuenta» debe usar un <input role="combobox"> por fila (AccountCombobox); hay ${inputs.length}`
  ).toHaveLength(expected);
  return inputs;
}

const typeInto = (input: HTMLElement, text: string) =>
  fireEvent.change(input, { target: { value: text } });
const press = (input: HTMLElement, key: string) => fireEvent.keyDown(input, { key });

function pressMouse(el: Element) {
  fireEvent.mouseDown(el);
  fireEvent.mouseUp(el);
  fireEvent.click(el);
}

function chooseByCode(input: HTMLInputElement, digits: string) {
  fireEvent.focus(input);
  typeInto(input, digits);
  press(input, "Enter");
}

function moneyInput(container: HTMLElement, row: number, side: "debit" | "credit") {
  return container.querySelector(`input[name="entries.${row}.${side}"]`) as HTMLInputElement;
}

function fillHeader() {
  fireEvent.change(screen.getByLabelText("Descripcion"), { target: { value: DESCRIPTION } });
}

/** 100,10 al débito de la fila 1 y al crédito de la fila 2 (asiento balanceado). */
function fillBalancedAmounts(container: HTMLElement) {
  fireEvent.change(moneyInput(container, 0, "debit"), { target: { value: "100,10" } });
  fireEvent.change(moneyInput(container, 1, "credit"), { target: { value: "100,10" } });
}

const submitButton = () => screen.getByRole("button", { name: /contabilizar asiento/i });

function headerEl(name: string): HTMLElement | null {
  const root = screen.queryByRole("listbox") ?? document.body;
  return within(root as HTMLElement).queryByText(new RegExp(`\\b${name}\\b`));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("JournalEntryForm — selector de cuenta buscable (SPEC-012 CA-16)", () => {
  it("cada fila tiene un selector de cuenta (<input role=combobox>) con nombre accesible propio y vacío", () => {
    renderForm();
    const inputs = accountInputs();
    const labels = inputs.map((i) => i.getAttribute("aria-label") ?? "");
    expect(labels.every((l) => /cuenta/i.test(l))).toBe(true);
    expect(new Set(labels).size).toBe(inputs.length);
    for (const input of inputs) expect(input.value).toBe("");
  });

  it("CA-16 (a): sin cuenta elegida, enviar muestra «Selecciona una cuenta» en cada fila y no llama a la action", async () => {
    const { container } = renderForm();
    const inputs = accountInputs();
    fillHeader();
    fillBalancedAmounts(container);

    fireEvent.click(submitButton());

    const messages = await screen.findAllByText("Selecciona una cuenta");
    expect(messages).toHaveLength(2);
    expect(createTransactionAction).not.toHaveBeenCalled();
    // el error se refleja en el control (borde + aria-invalid, SPEC §8 «error»)
    for (const input of inputs) expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("(a) el error es por fila: con la fila 1 elegida, solo la fila 2 muestra «Selecciona una cuenta»", async () => {
    const { container } = renderForm();
    const [first, second] = accountInputs();
    fillHeader();
    fillBalancedAmounts(container);
    chooseByCode(first, "110101001");

    fireEvent.click(submitButton());

    expect(await screen.findAllByText("Selecciona una cuenta")).toHaveLength(1);
    expect(createTransactionAction).not.toHaveBeenCalled();
    expect(second.getAttribute("aria-invalid")).toBe("true");
    expect(first.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("CA-16 (b): tecleando 110101001 + Enter en la fila 1 y 210101001 + Enter en la fila 2, el payload lleva los accountId correctos", async () => {
    const { container } = renderForm();
    const [first, second] = accountInputs();

    fireEvent.focus(first);
    typeInto(first, "110101001");
    // Enter dentro del <form> no debe enviarlo: el selector cancela el evento
    const notCanceled = fireEvent.keyDown(first, { key: "Enter" });
    expect(notCanceled).toBe(false);
    expect(first.value).toBe(CAJA_LABEL);

    chooseByCode(second, "210101001");
    expect(second.value).toBe(PROV_LABEL);

    fillHeader();
    fillBalancedAmounts(container);
    expect(createTransactionAction).not.toHaveBeenCalled();
    fireEvent.click(submitButton());

    await waitFor(() => expect(createTransactionAction).toHaveBeenCalledTimes(1));
    expect(createTransactionAction).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        userId: USER_ID,
        description: DESCRIPTION,
        type: "DIARIO",
        date: expect.any(Date),
        entries: [
          { accountId: "m-caja", debit: "100.10", credit: "0" },
          { accountId: "m-prov", debit: "0", credit: "100.10" },
        ],
      })
    );
    expect(screen.queryByText("Selecciona una cuenta")).toBeNull();
  });

  it("(b) tras crear el asiento avisa con el número y vuelve al listado", async () => {
    const { container } = renderForm();
    const [first, second] = accountInputs();
    chooseByCode(first, "110101001");
    chooseByCode(second, "210101001");
    fillHeader();
    fillBalancedAmounts(container);

    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Asiento AS-0001 creado correctamente")
    );
    expect(push).toHaveBeenCalledWith(`/company/${COMPANY_ID}/transactions`);
  });

  it("(b) elegir con la lista abierta y el ratón (clic en la opción) también deja el accountId en el payload", async () => {
    const { container } = renderForm();
    const [first, second] = accountInputs();

    fireEvent.focus(first);
    const option = screen.getByRole("option", { name: CAJA_LABEL });
    // como un navegador: si mousedown no se cancela, el foco sale del input antes del click
    if (fireEvent.mouseDown(option)) fireEvent.blur(first);
    fireEvent.mouseUp(option);
    fireEvent.click(option);
    expect(first.value).toBe(CAJA_LABEL);

    chooseByCode(second, "210101001");
    fillHeader();
    fillBalancedAmounts(container);
    fireEvent.click(submitButton());

    await waitFor(() => expect(createTransactionAction).toHaveBeenCalledTimes(1));
    expect(createTransactionAction.mock.calls[0][0].entries[0].accountId).toBe("m-caja");
  });

  it("CA-16 (c): la lista ofrece los títulos como encabezados pero solo las cuentas de movimiento como opciones", async () => {
    renderForm();
    const [first] = accountInputs();
    fireEvent.focus(first);
    const labels = screen.getAllByRole("option").map((o) => o.textContent?.trim());
    expect(labels).toEqual([CAJA_LABEL, PROV_LABEL]);
    for (const name of ["ACTIVO", "CORRIENTE", "DISPONIBLE", "CAJAS", "PASIVO", "PROVEEDORES"]) {
      const header = headerEl(name);
      expect(header, name).not.toBeNull();
      expect(header!.closest('[role="option"]'), name).toBeNull();
    }
  });

  it("CA-16 (c): intentar elegir un título (clic sobre el encabezado) no cambia el valor y el envío sigue marcando «Selecciona una cuenta»", async () => {
    const { container } = renderForm();
    const [first, second] = accountInputs();

    fireEvent.focus(first);
    for (const name of ["ACTIVO", "CAJAS"]) {
      const header = headerEl(name); // si la lista se cerró tras un clic, no hay más que pulsar
      if (header) pressMouse(header);
    }
    fireEvent.blur(first);
    expect(first.value).toBe("");

    chooseByCode(second, "210101001");
    fillHeader();
    fillBalancedAmounts(container);
    fireEvent.click(submitButton());

    expect(await screen.findAllByText("Selecciona una cuenta")).toHaveLength(1);
    expect(first.getAttribute("aria-invalid")).toBe("true");
    expect(createTransactionAction).not.toHaveBeenCalled();
  });

  it("CA-16 (c): teclear el código de un título y pulsar Enter nunca deja un id de título en el payload", async () => {
    const { container } = renderForm();
    const [first, second] = accountInputs();

    // «1.1.01.01» es el título CAJAS: con una sola cuenta debajo, Enter elige esa CUENTA (RN-14), jamás el título
    chooseByCode(first, "1.1.01.01");
    chooseByCode(second, "210101001");
    fillHeader();
    fillBalancedAmounts(container);
    fireEvent.click(submitButton());

    await waitFor(() => expect(createTransactionAction).toHaveBeenCalledTimes(1));
    const sent = createTransactionAction.mock.calls[0][0].entries.map(
      (e: { accountId: string }) => e.accountId
    );
    expect(sent).toEqual(["m-caja", "m-prov"]);
    for (const id of sent) expect(TITLE_IDS).not.toContain(id);
  });

  it("una consulta sin coincidencias no cambia el valor: al salir queda vacío y el envío marca el error", async () => {
    const { container } = renderForm();
    const [first, second] = accountInputs();
    fireEvent.focus(first);
    typeInto(first, "999999999");
    press(first, "Enter");
    fireEvent.blur(first);
    expect(first.value).toBe("");

    chooseByCode(second, "210101001");
    fillHeader();
    fillBalancedAmounts(container);
    fireEvent.click(submitButton());

    expect(await screen.findAllByText("Selecciona una cuenta")).toHaveLength(1);
    expect(createTransactionAction).not.toHaveBeenCalled();
  });

  it("«Agregar Linea» monta un tercer selector independiente, con su propio nombre accesible", async () => {
    renderForm();
    const [first, second] = accountInputs();
    chooseByCode(first, "110101001");

    fireEvent.click(screen.getByRole("button", { name: /agregar linea/i }));

    const inputs = accountInputs(3);
    const third = inputs[2];
    expect(third.value).toBe("");
    expect(first.value).toBe(CAJA_LABEL);
    expect(second.value).toBe("");
    const labels = inputs.map((i) => i.getAttribute("aria-label") ?? "");
    expect(new Set(labels).size).toBe(3);

    chooseByCode(third, "210101001");
    expect(third.value).toBe(PROV_LABEL);
    expect(first.value).toBe(CAJA_LABEL);
    expect(second.value).toBe("");
  });
});
