// @vitest-environment jsdom
// SPEC-008 CA-UI — diálogo "Nueva cuenta" de AccountsTable: selector de cuenta padre (título) y
// código sugerido. La sugerencia es una PROPUESTA editable (RN-8): estos tests fijan cuándo se pide,
// cuándo se aplica y cuándo se descarta, no la regla de negocio (esa vive en el servidor).
import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { AccountsTable } from "./AccountsTable";
import {
  getAccountsAction,
  createAccountAction,
  getNextAccountCodeAction,
} from "@/modules/accounting/actions/account.actions";

vi.mock("@/modules/accounting/actions/account.actions", () => ({
  getAccountsAction: vi.fn(),
  createAccountAction: vi.fn(),
  updateAccountAction: vi.fn(),
  deleteAccountAction: vi.fn(),
  getNextAccountCodeAction: vi.fn(),
}));

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastError, warning: vi.fn() },
  Toaster: () => null,
}));

// Abrir un Radix Select en jsdom + montar el Dialog cuesta ~1 s por caso; con la suite completa en
// paralelo el margen de 5 s por defecto es justo (timeouts intermitentes ajenos a la lógica).
vi.setConfig({ testTimeout: 20_000 });

const COMPANY_ID = "company-1";
const PARENT_LABEL = "Cuenta padre (título)";
const TYPE_LABEL = "Tipo de Cuenta";
const NO_PARENT_OPTION = "Sin cuenta padre (crear un título)";
const NO_TITLES_HELP = "Aún no hay títulos de 6 dígitos para este tipo. Crea primero el título.";
const NO_PARENT_HELP =
  "Sin cuenta padre solo puedes crear títulos (menos de 9 dígitos). Para una cuenta de movimiento elige un título padre.";

type TableAccount = ComponentProps<typeof AccountsTable>["initialAccounts"][number];
type NextCodeResult = Awaited<ReturnType<typeof getNextAccountCodeAction>>;

function account(
  over: Partial<TableAccount> & Pick<TableAccount, "id" | "code" | "name">
): TableAccount {
  return {
    type: "ASSET",
    description: null,
    isMonetary: false,
    isCurrent: false,
    isPostable: false,
    companyId: COMPANY_ID,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...over,
  };
}

// Desordenadas a propósito: la UI debe ordenarlas por código.
const ACCOUNTS: TableAccount[] = [
  account({ id: "t-bancos", code: "1.1.02.01", name: "BANCOS" }),
  account({ id: "t-cajas", code: "1.1.01.01", name: "CAJAS" }),
  account({ id: "t-prov", code: "2.1.01.01", name: "PROVEEDORES", type: "LIABILITY" }),
  // No son padres válidos: movimiento, título de 4 dígitos y título de 6 dígitos sin forma A.B.CC.DD.
  account({ id: "m-caja", code: "1.1.01.01.001", name: "CAJA PRINCIPAL", isPostable: true }),
  account({ id: "t-efectivo", code: "1.1.01", name: "EFECTIVO" }),
  account({ id: "t-plano", code: "110301", name: "SIN SEPARADORES" }),
];

function ok(code: string): NextCodeResult {
  return { success: true, data: { code } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeAll(() => {
  // jsdom no implementa lo que Radix Select (Popper + foco) necesita para abrirse.
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
  vi.mocked(getAccountsAction).mockResolvedValue({ success: true, data: ACCOUNTS as never });
});

function renderTable(accounts: TableAccount[] = ACCOUNTS) {
  return render(<AccountsTable initialAccounts={accounts} companyId={COMPANY_ID} />);
}

async function openCreateDialog() {
  fireEvent.click(screen.getByRole("button", { name: /nueva cuenta/i }));
  await screen.findByRole("dialog");
}

const select = (name: string) => screen.getByRole("combobox", { name });
const codeInput = () => screen.getByLabelText("Codigo") as HTMLInputElement;

// Radix Select se abre con el teclado (en jsdom no hay captura de puntero) y se elige con un click.
async function openSelect(trigger: HTMLElement) {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  await screen.findByRole("listbox");
}

async function choose(selectName: string, optionName: string) {
  await openSelect(select(selectName));
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
}

describe("AccountsTable — Nueva cuenta con título padre (SPEC-008 CA-UI)", () => {
  it("(a) ofrece solo los títulos de 6 dígitos del tipo elegido, ordenados y como «código — nombre»", async () => {
    renderTable();
    await openCreateDialog();

    await openSelect(select(PARENT_LABEL));
    const options = screen.getAllByRole("option").map((o) => o.textContent);

    expect(options).toEqual([NO_PARENT_OPTION, "1.1.01.01 — CAJAS", "1.1.02.01 — BANCOS"]);
    // Ni el título de otro tipo, ni la cuenta de movimiento, ni títulos de otra forma.
    for (const absent of ["PROVEEDORES", "CAJA PRINCIPAL", "EFECTIVO", "SIN SEPARADORES"]) {
      expect(options.some((o) => o?.includes(absent))).toBe(false);
    }
    expect(getNextAccountCodeAction).not.toHaveBeenCalled();
  });

  it("arranca sin padre: código vacío y editable, con la ayuda de títulos", async () => {
    renderTable();
    await openCreateDialog();

    expect(select(PARENT_LABEL).textContent).toBe(NO_PARENT_OPTION);
    expect(codeInput().value).toBe("");
    expect(codeInput().disabled).toBe(false);
    expect(screen.getByText(NO_PARENT_HELP)).toBeTruthy();
    expect(screen.queryByText(NO_TITLES_HELP)).toBeNull();
  });

  it("(b) al elegir un padre pide la sugerencia con (tipo, empresa, id del padre) y rellena el código", async () => {
    vi.mocked(getNextAccountCodeAction).mockResolvedValue(ok("1.1.01.01.003"));
    renderTable();
    await openCreateDialog();

    await choose(PARENT_LABEL, "1.1.01.01 — CAJAS");

    await waitFor(() => expect(codeInput().value).toBe("1.1.01.01.003"));
    expect(getNextAccountCodeAction).toHaveBeenCalledTimes(1);
    expect(getNextAccountCodeAction).toHaveBeenCalledWith("ASSET", COMPANY_ID, "t-cajas");
    expect(
      screen.getByText("Código sugerido dentro de 1.1.01.01 — CAJAS. Puedes editarlo.")
    ).toBeTruthy();
    // Sigue siendo editable.
    expect(codeInput().disabled).toBe(false);
    fireEvent.change(codeInput(), { target: { value: "1.1.01.01.050" } });
    expect(codeInput().value).toBe("1.1.01.01.050");
  });

  it("[L-1] si la llamada a la action se rechaza, el código y el guardado se desbloquean y hay toast", async () => {
    vi.mocked(getNextAccountCodeAction).mockRejectedValue(new Error("fetch failed"));
    renderTable();
    await openCreateDialog();

    await choose(PARENT_LABEL, "1.1.01.01 — CAJAS");

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "No se pudo calcular el código sugerido. Inténtalo de nuevo o escríbelo."
      )
    );
    await waitFor(() => expect(codeInput().disabled).toBe(false));
    expect(codeInput().getAttribute("aria-busy")).toBe("false");
    expect(
      (screen.getByRole("button", { name: /crear cuenta/i }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it("(c) mientras llega la sugerencia el código queda aria-busy y bloqueado, y no se puede guardar", async () => {
    const pending = deferred<NextCodeResult>();
    vi.mocked(getNextAccountCodeAction).mockReturnValue(pending.promise);
    renderTable();
    await openCreateDialog();

    await choose(PARENT_LABEL, "1.1.01.01 — CAJAS");

    await waitFor(() => expect(codeInput().getAttribute("aria-busy")).toBe("true"));
    expect(codeInput().disabled).toBe(true);
    expect(screen.getByText("Calculando el código sugerido…")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /crear cuenta/i }) as HTMLButtonElement).disabled
    ).toBe(true);

    await act(async () => {
      pending.resolve(ok("1.1.01.01.002"));
    });

    await waitFor(() => expect(codeInput().getAttribute("aria-busy")).toBe("false"));
    expect(codeInput().disabled).toBe(false);
    expect(codeInput().value).toBe("1.1.01.01.002");
    expect(
      (screen.getByRole("button", { name: /crear cuenta/i }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it("(d) si la action falla muestra el error de negocio y conserva el código anterior", async () => {
    const message = "El título 1.1.02.01 ya tiene 999 cuentas; elige otro título.";
    vi.mocked(getNextAccountCodeAction)
      .mockResolvedValueOnce(ok("1.1.01.01.003"))
      .mockResolvedValueOnce({ success: false, error: message });
    renderTable();
    await openCreateDialog();

    await choose(PARENT_LABEL, "1.1.01.01 — CAJAS");
    await waitFor(() => expect(codeInput().value).toBe("1.1.01.01.003"));

    await choose(PARENT_LABEL, "1.1.02.01 — BANCOS");

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(message));
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(codeInput().value).toBe("1.1.01.01.003");
    expect(codeInput().getAttribute("aria-busy")).toBe("false");
    expect(codeInput().disabled).toBe(false);
    // La ayuda ya no afirma que haya una sugerencia: dice que el código se teclea a mano.
    expect(
      screen.getByText("No se pudo sugerir un código. Escríbelo dentro de 1.1.02.01 — BANCOS.")
    ).toBeTruthy();
  });

  it("(e) cambiar el tipo limpia el padre y el código sugerido, y ofrece los títulos del nuevo tipo", async () => {
    vi.mocked(getNextAccountCodeAction).mockResolvedValue(ok("1.1.01.01.003"));
    renderTable();
    await openCreateDialog();
    await choose(PARENT_LABEL, "1.1.01.01 — CAJAS");
    await waitFor(() => expect(codeInput().value).toBe("1.1.01.01.003"));

    await choose(TYPE_LABEL, "Pasivo");

    expect(select(PARENT_LABEL).textContent).toBe(NO_PARENT_OPTION);
    expect(codeInput().value).toBe("");
    expect(screen.getByText(NO_PARENT_HELP)).toBeTruthy();
    expect(getNextAccountCodeAction).toHaveBeenCalledTimes(1);

    await openSelect(select(PARENT_LABEL));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      NO_PARENT_OPTION,
      "2.1.01.01 — PROVEEDORES",
    ]);
  });

  it("(e2) cambiar el tipo no borra un código tecleado a mano si no había padre", async () => {
    renderTable();
    await openCreateDialog();
    fireEvent.change(codeInput(), { target: { value: "1.1.09" } });

    await choose(TYPE_LABEL, "Pasivo");

    expect(codeInput().value).toBe("1.1.09");
  });

  it("(f) sin títulos del tipo elegido muestra que hay que crear primero el título", async () => {
    renderTable();
    await openCreateDialog();
    expect(screen.queryByText(NO_TITLES_HELP)).toBeNull();

    await choose(TYPE_LABEL, "Patrimonio");

    expect(screen.getByText(NO_TITLES_HELP)).toBeTruthy();
    await openSelect(select(PARENT_LABEL));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([NO_PARENT_OPTION]);
  });

  it("(g) descarta la respuesta obsoleta: gana la última elección aunque la anterior llegue después", async () => {
    const slow = deferred<NextCodeResult>();
    const fast = deferred<NextCodeResult>();
    vi.mocked(getNextAccountCodeAction)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise);
    renderTable();
    await openCreateDialog();

    await choose(PARENT_LABEL, "1.1.01.01 — CAJAS");
    await waitFor(() => expect(codeInput().getAttribute("aria-busy")).toBe("true"));
    await choose(PARENT_LABEL, "1.1.02.01 — BANCOS");
    expect(getNextAccountCodeAction).toHaveBeenNthCalledWith(2, "ASSET", COMPANY_ID, "t-bancos");

    await act(async () => {
      fast.resolve(ok("1.1.02.01.001"));
    });
    await waitFor(() => expect(codeInput().value).toBe("1.1.02.01.001"));
    // La última respuesta ya llegó: el campo no queda bloqueado esperando a la antigua.
    expect(codeInput().getAttribute("aria-busy")).toBe("false");

    await act(async () => {
      slow.resolve(ok("1.1.01.01.009"));
    });
    expect(codeInput().value).toBe("1.1.02.01.001");
    expect(
      screen.getByText("Código sugerido dentro de 1.1.02.01 — BANCOS. Puedes editarlo.")
    ).toBeTruthy();
  });

  it("(g2) un error obsoleto tampoco se muestra ni pisa la sugerencia vigente", async () => {
    const slow = deferred<NextCodeResult>();
    vi.mocked(getNextAccountCodeAction)
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(ok("1.1.02.01.001"));
    renderTable();
    await openCreateDialog();

    await choose(PARENT_LABEL, "1.1.01.01 — CAJAS");
    await choose(PARENT_LABEL, "1.1.02.01 — BANCOS");
    await waitFor(() => expect(codeInput().value).toBe("1.1.02.01.001"));

    await act(async () => {
      slow.resolve({
        success: false,
        error: "La cuenta padre no es válida para este tipo de cuenta.",
      });
    });

    expect(toastError).not.toHaveBeenCalled();
    expect(codeInput().value).toBe("1.1.02.01.001");
  });

  it("elegir «Sin cuenta padre» después de un padre vacía el código y descarta la sugerencia en vuelo", async () => {
    const pending = deferred<NextCodeResult>();
    vi.mocked(getNextAccountCodeAction).mockReturnValue(pending.promise);
    renderTable();
    await openCreateDialog();
    await choose(PARENT_LABEL, "1.1.01.01 — CAJAS");

    await choose(PARENT_LABEL, NO_PARENT_OPTION);
    expect(codeInput().getAttribute("aria-busy")).toBe("false");

    await act(async () => {
      pending.resolve(ok("1.1.01.01.001"));
    });
    expect(codeInput().value).toBe("");
    expect(screen.getByText(NO_PARENT_HELP)).toBeTruthy();
  });

  it("guarda con el código sugerido y sin enviar el padre al servidor", async () => {
    vi.mocked(getNextAccountCodeAction).mockResolvedValue(ok("1.1.01.01.003"));
    vi.mocked(createAccountAction).mockResolvedValue({
      success: true,
      data: { id: "new-1", name: "Caja Chica" },
    });
    renderTable();
    await openCreateDialog();
    await choose(PARENT_LABEL, "1.1.01.01 — CAJAS");
    await waitFor(() => expect(codeInput().value).toBe("1.1.01.01.003"));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Caja Chica" } });

    fireEvent.click(screen.getByRole("button", { name: /crear cuenta/i }));

    await waitFor(() => expect(createAccountAction).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(createAccountAction).mock.calls[0][0];
    expect(payload).toMatchObject({
      code: "1.1.01.01.003",
      name: "Caja Chica",
      type: "ASSET",
      companyId: COMPANY_ID,
    });
    expect("parentId" in payload).toBe(false);
  });

  it("en edición no hay selector de padre, no pide sugerencia y cambiar el tipo no toca el código", async () => {
    renderTable();
    const row = screen.getByText("CAJA PRINCIPAL").closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /editar/i }));
    await screen.findByRole("dialog");

    expect(screen.queryByRole("combobox", { name: PARENT_LABEL })).toBeNull();
    expect(codeInput().value).toBe("1.1.01.01.001");
    expect(screen.queryByText(NO_PARENT_HELP)).toBeNull();

    await choose(TYPE_LABEL, "Pasivo");

    expect(codeInput().value).toBe("1.1.01.01.001");
    expect(getNextAccountCodeAction).not.toHaveBeenCalled();
  });
});
