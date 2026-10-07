// @vitest-environment jsdom
// src/modules/settings/components/GLAccountsForm.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase.
//
// SPEC-012 · ENTREGA B2 · paso 1 (modo RED) — «Integración con Libro Mayor» (`GLAccountsForm`): los ONCE
// selectores de cuenta (10 si la empresa no es Contribuyente Especial) pasan del `Select` de Radix
// (`AccountSelect` local, con el centinela `__none__`) a `AccountCombobox` con `clearable`. TODOS son
// OPCIONALES: «sin asignar» = «» y viaja como `null`.
//
// Q4: si un valor guardado de `initialConfig` es un TÍTULO o no existe en LA LISTA DE SU CAMPO (p. ej. el
// IVA Débito Fiscal solo ofrece Pasivo), el formulario muestra `SavedAccountsAlert` con los rótulos de esos
// campos desde el primer render, DESHABILITA «Guardar configuración» (con `aria-describedby` hacia la
// alerta) y el `submit` retorna SIN llamar a la acción. Reemplazar la cuenta, o quitarla con «Quitar la
// cuenta», retira la alerta.
//
// Los ids de los campos se conservan (`arAccountId`, …): son el `id` del combobox.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GLAccountsForm } from "./GLAccountsForm";
import {
  accessibleNames,
  accountComboboxes,
  clearButtonOf,
  clearField,
  describedByText,
  expectAlertListing,
  expectBlockedByAlert,
  expectNoSavedAccountsAlert,
  fieldLabelOf,
  labelOf,
  labelRegex,
  listedOptionLabels,
  moveAcc,
  movementLabels,
  ofType,
  openList,
  pickByCode,
  pressEveryHeader,
  savedAccountsAlerts,
  stubJsdomForListbox,
  titleAcc,
  visibleHeaderNames,
  type PlanAccount,
} from "@/__tests__/helpers/account-combobox-forms";

const { saveGLConfigAction, postUnbookedInvoicesAction, toastSuccess, toastError } = vi.hoisted(
  () => ({
    saveGLConfigAction: vi.fn(),
    postUnbookedInvoicesAction: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
  })
);

vi.mock("../actions/gl-config.actions", () => ({ saveGLConfigAction, postUnbookedInvoicesAction }));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError, info: vi.fn() },
  Toaster: () => null,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────
// Cada tipo tiene ≥ 2 cuentas de movimiento (para elegir una distinta de la guardada) y títulos de
// nombre único (en MAYÚSCULAS, sin palabras en común entre sí).

const T_ACTIVO = titleAcc("1", "ACTIVO", "ASSET");
const T_CORRIENTE = titleAcc("1.1", "CORRIENTE", "ASSET");
const T_COBRANZAS = titleAcc("1.1.02", "COBRANZAS", "ASSET");
const A_CXC = moveAcc("1.1.02.01.001", "Cuentas por Cobrar Clientes", "ASSET");
const A_INV = moveAcc("1.1.03.01.001", "Inventario Mercancias", "ASSET");
const A_IVACF = moveAcc("1.1.04.01.001", "IVA Credito Cuenta", "ASSET");
const A_IVARET = moveAcc("1.1.04.01.002", "IVA Retenido Cuenta", "ASSET");

const T_PASIVO = titleAcc("2", "PASIVO", "LIABILITY");
const T_EXIGIBLE = titleAcc("2.1", "EXIGIBLE", "LIABILITY");
const L_CXP = moveAcc("2.1.01.01.001", "Proveedores Nacionales", "LIABILITY");
const L_IVADF = moveAcc("2.1.02.01.001", "IVA Debito Cuenta", "LIABILITY");
const L_IVARETP = moveAcc("2.1.02.01.002", "Retenciones IVA Cuenta", "LIABILITY");
const L_IGTF = moveAcc("2.1.02.01.003", "IGTF Cuenta", "LIABILITY");

const T_INGRESOS = titleAcc("4", "INGRESOS", "REVENUE");
const T_OPERATIVOS = titleAcc("4.1", "OPERATIVOS", "REVENUE");
const R_VENTAS = moveAcc("4.1.01.01.001", "Ventas Gravadas", "REVENUE");
const R_FXGAIN = moveAcc("4.2.01.01.001", "Ganancia Diferencial", "REVENUE");

const T_EGRESOS = titleAcc("5", "EGRESOS", "EXPENSE");
const T_FINANCIEROS = titleAcc("5.1", "FINANCIEROS", "EXPENSE");
const E_FXLOSS = moveAcc("5.1.01.01.001", "Perdida Diferencial", "EXPENSE");
const E_VARIOS = moveAcc("5.1.02.01.001", "Gasto Varios", "EXPENSE");

const PLAN: PlanAccount[] = [
  T_ACTIVO,
  T_CORRIENTE,
  T_COBRANZAS,
  A_CXC,
  A_INV,
  A_IVACF,
  A_IVARET,
  T_PASIVO,
  T_EXIGIBLE,
  L_CXP,
  L_IVADF,
  L_IVARETP,
  L_IGTF,
  T_INGRESOS,
  T_OPERATIVOS,
  R_VENTAS,
  R_FXGAIN,
  T_EGRESOS,
  T_FINANCIEROS,
  E_FXLOSS,
  E_VARIOS,
];
const TITLE_NAMES = PLAN.filter((a) => !a.isPostable).map((a) => a.name);

type Pool = "ASSET" | "LIABILITY" | "REVENUE" | "EXPENSE";
type FieldDef = {
  key: keyof Config;
  label: string;
  pool: Pool;
  ceOnly?: boolean;
  /** Una cuenta de movimiento de SU lista, para el config válido. */
  valid: PlanAccount;
  /** Otra cuenta de movimiento de su lista, para reemplazar. */
  other: PlanAccount;
};

const FIELDS: FieldDef[] = [
  {
    key: "arAccountId",
    label: "Cuentas por Cobrar (CxC)",
    pool: "ASSET",
    valid: A_CXC,
    other: A_INV,
  },
  {
    key: "salesAccountId",
    label: "Ingresos por Ventas",
    pool: "REVENUE",
    valid: R_VENTAS,
    other: R_FXGAIN,
  },
  {
    key: "ivaDFAccountId",
    label: "IVA Débito Fiscal",
    pool: "LIABILITY",
    valid: L_IVADF,
    other: L_CXP,
  },
  {
    key: "inventoryAccountId",
    label: "Inventario de Mercancías",
    pool: "ASSET",
    valid: A_INV,
    other: A_CXC,
  },
  {
    key: "apAccountId",
    label: "Cuentas por Pagar (CxP)",
    pool: "LIABILITY",
    valid: L_CXP,
    other: L_IVADF,
  },
  {
    key: "ivaCFAccountId",
    label: "IVA Crédito Fiscal",
    pool: "ASSET",
    valid: A_IVACF,
    other: A_CXC,
  },
  {
    key: "ivaRetentionPayableAccountId",
    label: "Retenciones IVA por Pagar",
    pool: "LIABILITY",
    valid: L_IVARETP,
    other: L_CXP,
  },
  {
    key: "ivaRetentionReceivableAccountId",
    label: "IVA Retenido por Cobrar",
    pool: "ASSET",
    ceOnly: true,
    valid: A_IVARET,
    other: A_CXC,
  },
  {
    key: "igtfPayableAccountId",
    label: "IGTF por Pagar",
    pool: "LIABILITY",
    valid: L_IGTF,
    other: L_CXP,
  },
  {
    key: "fxGainAccountId",
    label: "Ganancia Cambiaria",
    pool: "REVENUE",
    valid: R_FXGAIN,
    other: R_VENTAS,
  },
  {
    key: "fxLossAccountId",
    label: "Pérdida Cambiaria",
    pool: "EXPENSE",
    valid: E_FXLOSS,
    other: E_VARIOS,
  },
];

type Config = React.ComponentProps<typeof GLAccountsForm>["initialConfig"];

const EMPTY_CONFIG: Config = {
  arAccountId: null,
  apAccountId: null,
  salesAccountId: null,
  purchaseExpenseAccountId: null,
  inventoryAccountId: null,
  ivaDFAccountId: null,
  ivaCFAccountId: null,
  ivaRetentionPayableAccountId: null,
  fxGainAccountId: null,
  fxLossAccountId: null,
  igtfPayableAccountId: null,
  ivaRetentionReceivableAccountId: null,
};
const VALID_CONFIG: Config = FIELDS.reduce<Config>(
  (config, f) => ({ ...config, [f.key]: f.valid.id }),
  EMPTY_CONFIG
);
/** Lo que `saveGLConfigAction` recibe: `companyId` + los 12 campos de cuenta (null = sin asignar). */
const COMPANY_ID = "company-1";
const payloadOf = (config: Partial<Config>) => ({
  companyId: COMPANY_ID,
  ...EMPTY_CONFIG,
  ...config,
});

const field = (key: keyof Config) => FIELDS.find((f) => f.key === key)!;
const poolOf = (type: Pool, accounts: readonly PlanAccount[] = PLAN) => ofType(accounts, type);

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  saveGLConfigAction.mockResolvedValue({ success: true, data: undefined });
  postUnbookedInvoicesAction.mockResolvedValue({ success: true, data: { posted: 0, skipped: 0 } });
});

afterEach(cleanup);

// ─── Helpers de render ───────────────────────────────────────────────────────────────────────────

type Opts = { config?: Config; accounts?: PlanAccount[]; ce?: boolean; unbooked?: number };

function element({ config = EMPTY_CONFIG, accounts = PLAN, ce = true, unbooked = 0 }: Opts) {
  return (
    <GLAccountsForm
      companyId={COMPANY_ID}
      allAccounts={accounts}
      isSpecialContributor={ce}
      initialConfig={config}
      initialUnbookedCount={unbooked}
    />
  );
}

function mount(opts: Opts = {}) {
  const utils = render(element(opts));
  return {
    ...utils,
    refresh: (next: Opts) => utils.rerender(element({ ...opts, ...next })),
  };
}

/** El combobox de un campo por su etiqueta (falla con un mensaje claro si sigue siendo `Select` de Radix). */
function box(key: keyof Config): HTMLInputElement {
  const def = field(key);
  const found = screen.getByLabelText(labelRegex(def.label));
  if (found.tagName !== "INPUT") {
    throw new Error(
      `«${def.label}» sigue siendo ${found.tagName} (se esperaba un <input role=combobox>)`
    );
  }
  return found as HTMLInputElement;
}

const saveBtn = () => screen.getByRole("button", { name: /Guardar configuración|Guardando/ });
const form = () => document.querySelector("form") as HTMLFormElement;
const radixTriggers = () => document.querySelectorAll('button[role="combobox"]');
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const clearButtons = () => screen.queryAllByRole("button", { name: "Quitar la cuenta" });

const asTitle = (a: PlanAccount): PlanAccount => ({ ...a, isPostable: false });
const withTitle = (list: readonly PlanAccount[], target: PlanAccount) =>
  list.map((a) => (a.id === target.id ? asTitle(a) : a));
const without = (list: readonly PlanAccount[], ...targets: PlanAccount[]) =>
  list.filter((a) => !targets.some((t) => t.id === a.id));

async function saveOk() {
  fireEvent.click(saveBtn());
  await waitFor(() => expect(saveGLConfigAction).toHaveBeenCalledTimes(1));
  return saveGLConfigAction.mock.calls[0][0] as Record<string, unknown>;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("GLAccountsForm — los selectores son AccountCombobox, no `Select` de Radix (SPEC-012 B2)", () => {
  it("Contribuyente Especial: ONCE <input role=combobox> y ningún disparador de Radix", () => {
    mount({ ce: true });
    expect(accountComboboxes()).toHaveLength(11);
    expect(radixTriggers()).toHaveLength(0);
    expect(screen.queryAllByRole("combobox").every((el) => el.tagName === "INPUT")).toBe(true);
  });

  it("no Contribuyente Especial: DIEZ (falta «IVA Retenido por Cobrar»)", () => {
    mount({ ce: false });
    expect(accountComboboxes()).toHaveLength(10);
    expect(radixTriggers()).toHaveLength(0);
    expect(screen.queryByLabelText(labelRegex("IVA Retenido por Cobrar"))).toBeNull();
  });

  it("D9: cada etiqueta está asociada a SU combobox, se conserva el id y los 11 nombres accesibles son distintos", () => {
    mount();
    for (const def of FIELDS) {
      const input = box(def.key);
      expect(input.id).toBe(def.key);
      expect(fieldLabelOf(input)).toBe(def.label);
    }
    const names = accessibleNames();
    expect(names).toHaveLength(11);
    expect(names.every((n) => n.trim() !== "")).toBe(true);
    expect(new Set(names).size).toBe(11);
  });

  it("sin `required` nativo", () => {
    mount();
    for (const input of accountComboboxes()) expect(input.required).toBe(false);
  });

  it.each(FIELDS)("«$label» ofrece SOLO cuentas $pool, con sus títulos como encabezados", (def) => {
    mount();
    openList(box(def.key));
    expect(listedOptionLabels()).toEqual(movementLabels(poolOf(def.pool)));
    expect(visibleHeaderNames(TITLE_NAMES)).toEqual(
      poolOf(def.pool)
        .filter((a) => !a.isPostable)
        .map((a) => a.name)
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("GLAccountsForm — todos OPCIONALES: `clearable`, «sin asignar» = null", () => {
  it("sin configuración previa: los 11 campos nacen vacíos y ninguno muestra «Quitar la cuenta»", () => {
    mount();
    for (const def of FIELDS) {
      expect(box(def.key).value).toBe("");
      expect(clearButtonOf(box(def.key))).toBeNull();
    }
    expect(clearButtons()).toHaveLength(0);
  });

  it("con la configuración completa los 11 muestran «código — nombre» y cada uno tiene su «Quitar la cuenta»", () => {
    mount({ config: VALID_CONFIG });
    for (const def of FIELDS) {
      expect(box(def.key).value).toBe(labelOf(def.valid));
      expect(clearButtonOf(box(def.key))).not.toBeNull();
    }
    expect(clearButtons()).toHaveLength(11);
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("guardar SIN tocar nada con todo en null envía los doce campos en null (nunca «__none__» ni «»)", async () => {
    mount();
    const payload = await saveOk();
    expect(payload).toEqual(payloadOf({}));
    for (const value of Object.values(payload)) expect(value).not.toBe("__none__");
  });

  it("guardar la configuración vigente sin tocar nada la envía tal cual (purchaseExpenseAccountId siempre null)", async () => {
    mount({ config: VALID_CONFIG });
    const payload = await saveOk();
    expect(payload).toEqual(payloadOf(VALID_CONFIG));
    expect(payload.purchaseExpenseAccountId).toBeNull();
  });

  it("elegir cuentas tecleando el código + Enter y guardar: solo esos campos llevan id, el resto null", async () => {
    mount();
    pickByCode(box("arAccountId"), "110201001");
    pickByCode(box("salesAccountId"), R_VENTAS.code);
    pickByCode(box("ivaDFAccountId"), L_IVADF.code);
    expect(box("arAccountId").value).toBe(labelOf(A_CXC));
    const payload = await saveOk();
    expect(payload).toEqual(
      payloadOf({
        arAccountId: A_CXC.id,
        salesAccountId: R_VENTAS.id,
        ivaDFAccountId: L_IVADF.id,
      })
    );
  });

  it("«Quitar la cuenta» deja el campo vacío, retira su botón y envía null; los demás no se tocan", async () => {
    mount({ config: VALID_CONFIG });
    const input = box("fxLossAccountId");
    clearField(input);
    expect(input.value).toBe("");
    expect(clearButtonOf(input)).toBeNull();
    expect(clearButtons()).toHaveLength(10);
    const payload = await saveOk();
    expect(payload).toEqual(payloadOf({ ...VALID_CONFIG, fxLossAccountId: null }));
  });

  it("vaciar el TEXTO del campo y salir NO quita la cuenta (RN-15: solo el botón lo hace)", () => {
    mount({ config: VALID_CONFIG });
    const input = box("arAccountId");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe(labelOf(A_CXC));
  });

  it("reemplazar una cuenta por otra de su lista cambia solo ese campo", async () => {
    mount({ config: VALID_CONFIG });
    pickByCode(box("inventoryAccountId"), A_CXC.code);
    const payload = await saveOk();
    expect(payload).toEqual(payloadOf({ ...VALID_CONFIG, inventoryAccountId: A_CXC.id }));
  });

  it("si la acción falla muestra su error; si guarda, el mensaje de éxito (guarda verde)", async () => {
    saveGLConfigAction.mockResolvedValueOnce({ success: false, error: "Sin permiso" });
    mount();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Sin permiso"));
    await waitFor(() => expect(saveBtn().hasAttribute("disabled")).toBe(false));
    fireEvent.click(saveBtn());
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Configuración del Libro Mayor guardada.")
    );
  });

  it("mientras guarda, el botón está deshabilitado con aria-busy (guarda verde)", async () => {
    let release!: (value: unknown) => void;
    saveGLConfigAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    mount();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(saveBtn().textContent).toContain("Guardando..."));
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
    expect(saveBtn().getAttribute("aria-busy")).toBe("true");
    release({ success: true, data: undefined });
    await waitFor(() => expect(saveBtn().textContent).toContain("Guardar configuración"));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("GLAccountsForm — los títulos NO se pueden elegir (CA-9)", () => {
  it.each(["arAccountId", "apAccountId", "salesAccountId", "fxLossAccountId"] as const)(
    "clic sobre los encabezados de «%s» no elige nada: el campo sigue vacío y se envía null",
    async (key) => {
      mount();
      const input = box(key);
      pressEveryHeader(input, TITLE_NAMES);
      fireEvent.blur(input);
      expect(input.value).toBe("");
      const payload = await saveOk();
      expect(payload[key]).toBeNull();
    }
  );

  it("clic sobre los encabezados no cambia una cuenta ya elegida", () => {
    mount({ config: VALID_CONFIG });
    const input = box("arAccountId");
    pressEveryHeader(input, ["ACTIVO", "CORRIENTE", "COBRANZAS"]);
    fireEvent.blur(input);
    expect(input.value).toBe(labelOf(A_CXC));
  });

  it("ningún id enviado es el de un título, pase lo que pase con los encabezados", async () => {
    mount();
    for (const key of ["arAccountId", "ivaDFAccountId", "fxGainAccountId"] as const) {
      pressEveryHeader(box(key), TITLE_NAMES);
      fireEvent.blur(box(key));
    }
    const payload = await saveOk();
    for (const value of Object.values(payload)) {
      expect(String(value ?? "").startsWith("t:")).toBe(false);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("GLAccountsForm — RN-19: una lista de SOLO títulos no ofrece nada", () => {
  it("sin cuentas de movimiento de Pasivo: los 4 campos de Pasivo no son utilizables y los demás sí", () => {
    mount({ accounts: [...without(PLAN, L_CXP, L_IVADF, L_IVARETP, L_IGTF)] });
    expect(radixTriggers()).toHaveLength(0);
    const liability = FIELDS.filter((f) => f.pool === "LIABILITY");
    for (const def of liability) expect(box(def.key).disabled).toBe(true);
    for (const def of FIELDS.filter((f) => f.pool !== "LIABILITY")) {
      expect(box(def.key).disabled).toBe(false);
    }
  });

  it("los campos sin cuentas utilizables se pueden dejar sin asignar y guardar (todo es opcional)", async () => {
    mount({ accounts: without(PLAN, L_CXP, L_IVADF, L_IVARETP, L_IGTF) });
    const payload = await saveOk();
    expect(payload).toEqual(payloadOf({}));
  });

  it("un solo título + una cuenta de movimiento del tipo: solo esa cuenta se ofrece", () => {
    mount({
      accounts: [T_PASIVO, T_EXIGIBLE, L_CXP, ...without(PLAN, ...ofType(PLAN, "LIABILITY"))],
    });
    openList(box("apAccountId"));
    expect(listedOptionLabels()).toEqual([labelOf(L_CXP)]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("GLAccountsForm — lo que NO cambia (guardas verdes)", () => {
  it("las insignias «Activo» / «Incompleto» de venta y compra siguen la configuración", () => {
    const badgeOf = (heading: string) =>
      screen.getByText(heading).parentElement?.textContent?.replace(heading, "").trim();
    mount();
    expect(badgeOf("Facturas de Venta")).toBe("Incompleto");
    expect(badgeOf("Facturas de Compra")).toBe("Incompleto");
    cleanup();
    mount({ config: VALID_CONFIG });
    expect(badgeOf("Facturas de Venta")).toBe("Activo");
    expect(badgeOf("Facturas de Compra")).toBe("Activo");
  });

  it("«Causar ahora» aparece solo con facturas sin asiento y configuración completa", () => {
    mount({ config: VALID_CONFIG, unbooked: 3 });
    expect(screen.getByRole("button", { name: /Causar ahora/ })).toBeTruthy();
    cleanup();
    mount({ unbooked: 3 });
    expect(screen.queryByRole("button", { name: /Causar ahora/ })).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Q4 — la configuración guardada apunta a un título o a una cuenta que no existe en LA LISTA DE ESE CAMPO.
describe("GLAccountsForm — Q4: alerta que BLOQUEA el guardado (valor guardado no elegible)", () => {
  it("una cuenta de TÍTULO guardada: alerta desde el primer render que lista SOLO ese campo", () => {
    mount({ config: { ...VALID_CONFIG, arAccountId: T_COBRANZAS.id } });
    expectAlertListing(
      ["Cuentas por Cobrar (CxC)"],
      ["Ingresos por Ventas", "IVA Débito Fiscal", "IGTF por Pagar"]
    );
    expect(savedAccountsAlerts()).toHaveLength(1);
  });

  it("el campo del título queda VACÍO e inválido; los demás conservan su cuenta", () => {
    mount({ config: { ...VALID_CONFIG, arAccountId: T_COBRANZAS.id } });
    expect(box("arAccountId").value).toBe("");
    expect(box("arAccountId").getAttribute("aria-invalid")).toBe("true");
    expect(box("salesAccountId").value).toBe(labelOf(R_VENTAS));
    expect(box("salesAccountId").getAttribute("aria-invalid")).not.toBe("true");
  });

  it("«Guardar configuración» queda DESHABILITADO y su descripción accesible apunta a la alerta", () => {
    mount({ config: { ...VALID_CONFIG, arAccountId: T_COBRANZAS.id } });
    expectBlockedByAlert(saveBtn(), "Cuentas por Cobrar (CxC)");
  });

  it("el `submit` retorna SIN llamar a la acción (defensa en profundidad)", async () => {
    mount({ config: { ...VALID_CONFIG, arAccountId: T_COBRANZAS.id } });
    fireEvent.submit(form());
    await flush();
    expect(saveGLConfigAction).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("hacer clic en el botón deshabilitado tampoco llama a la acción", async () => {
    mount({ config: { ...VALID_CONFIG, arAccountId: T_COBRANZAS.id } });
    fireEvent.click(saveBtn());
    await flush();
    expect(saveGLConfigAction).not.toHaveBeenCalled();
  });

  it("reemplazar la cuenta por una de movimiento retira la alerta y se guarda con la nueva", async () => {
    mount({ config: { ...VALID_CONFIG, arAccountId: T_COBRANZAS.id } });
    pickByCode(box("arAccountId"), A_CXC.code);
    expectNoSavedAccountsAlert(saveBtn());
    const payload = await saveOk();
    expect(payload).toEqual(payloadOf(VALID_CONFIG));
  });

  it("un campo OPCIONAL con una cuenta que YA NO EXISTE: alerta; «Quitar la cuenta» la retira y envía null", async () => {
    mount({ config: { ...VALID_CONFIG, fxGainAccountId: "id-de-una-cuenta-eliminada" } });
    expectAlertListing(["Ganancia Cambiaria"], ["Pérdida Cambiaria"]);
    expect(box("fxGainAccountId").value).toBe("");
    expect(box("fxGainAccountId").getAttribute("aria-invalid")).toBe("true");
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
    clearField(box("fxGainAccountId"));
    expectNoSavedAccountsAlert(saveBtn());
    const payload = await saveOk();
    expect(payload).toEqual(payloadOf({ ...VALID_CONFIG, fxGainAccountId: null }));
  });

  it("cada campo se evalúa contra SU lista: una cuenta de Activo válida guardada en «IVA Débito Fiscal» (solo Pasivo) es un problema", () => {
    mount({ config: { ...VALID_CONFIG, ivaDFAccountId: A_CXC.id } });
    expectAlertListing(["IVA Débito Fiscal"], ["Cuentas por Cobrar (CxC)"]);
    expect(box("ivaDFAccountId").value).toBe("");
  });

  it("varios campos con problema (título, id ausente y tipo equivocado): la alerta los lista y arreglarlos de a uno la achica", () => {
    mount({
      config: {
        ...VALID_CONFIG,
        arAccountId: T_COBRANZAS.id,
        apAccountId: "no-existe",
        fxLossAccountId: R_VENTAS.id,
      },
    });
    expectAlertListing(
      ["Cuentas por Cobrar (CxC)", "Cuentas por Pagar (CxP)", "Pérdida Cambiaria"],
      ["Ingresos por Ventas"]
    );
    pickByCode(box("arAccountId"), A_CXC.code);
    expectAlertListing(
      ["Cuentas por Pagar (CxP)", "Pérdida Cambiaria"],
      ["Cuentas por Cobrar (CxC)"]
    );
    clearField(box("apAccountId"));
    expectAlertListing(["Pérdida Cambiaria"], ["Cuentas por Pagar (CxP)"]);
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
    pickByCode(box("fxLossAccountId"), E_FXLOSS.code);
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("clic sobre los encabezados NO arregla el problema: la alerta sigue y el botón también", () => {
    mount({ config: { ...VALID_CONFIG, arAccountId: T_COBRANZAS.id } });
    pressEveryHeader(box("arAccountId"), TITLE_NAMES);
    fireEvent.blur(box("arAccountId"));
    expect(box("arAccountId").value).toBe("");
    expectAlertListing(["Cuentas por Cobrar (CxC)"]);
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
  });

  it("sin valores guardados (todo null) NO hay alerta", () => {
    mount();
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("una configuración totalmente válida NO muestra alerta y deja guardar", () => {
    mount({ config: VALID_CONFIG });
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("la alerta usa los valores ACTUALES: si tras refrescar la lista una cuenta elegida pasa a ser título, aparece; al volver a ser elegible, se retira", () => {
    const { refresh } = mount({ config: VALID_CONFIG });
    expectNoSavedAccountsAlert(saveBtn());
    refresh({ accounts: withTitle(PLAN, A_CXC) });
    expectAlertListing(["Cuentas por Cobrar (CxC)"]);
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
    refresh({ accounts: PLAN });
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("una cuenta elegida por el usuario que luego desaparece de la lista también bloquea el `submit`", async () => {
    const { refresh } = mount();
    pickByCode(box("fxGainAccountId"), R_FXGAIN.code);
    expectNoSavedAccountsAlert(saveBtn());
    refresh({ accounts: without(PLAN, R_FXGAIN) });
    expectAlertListing(["Ganancia Cambiaria"]);
    fireEvent.submit(form());
    await flush();
    expect(saveGLConfigAction).not.toHaveBeenCalled();
  });

  it("un refresco que deja todo igual (objetos nuevos) NO muestra la alerta", () => {
    const { refresh } = mount({ config: VALID_CONFIG });
    refresh({ accounts: PLAN.map((a) => ({ ...a })) });
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("OTRAS cuentas (las que no están guardadas) que pasan a título o desaparecen NO activan la alerta", () => {
    // «Gasto Varios» no es la cuenta guardada de ningún campo.
    const { refresh } = mount({ config: VALID_CONFIG });
    refresh({ accounts: withTitle(PLAN, E_VARIOS) });
    expectNoSavedAccountsAlert(saveBtn());
    refresh({ accounts: without(PLAN, E_VARIOS) });
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("…pero si la que pasa a título ES la guardada de un campo, solo ese campo aparece en la alerta", () => {
    const { refresh } = mount({ config: VALID_CONFIG });
    refresh({ accounts: withTitle(PLAN, A_IVACF) });
    expectAlertListing(["IVA Crédito Fiscal"], ["Cuentas por Cobrar (CxC)", "Ingresos por Ventas"]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// SPEC-012 · B2 · paso 4 (cobertura): decisión 4 de la sesión principal. «IVA Retenido por Cobrar» solo se
// muestra a Contribuyentes Especiales: oculto no se puede corregir, no entra en la alerta y, si su valor
// guardado no es elegible, se guarda como null (un valor válido, también oculto, no se toca). Las insignias
// y las banderas de configuración completa usan `isSelectableAccountId` (un título NO cuenta).

/** El texto de la insignia de una sección: el último elemento del contenedor del encabezado. */
const sectionBadge = (heading: string) =>
  screen.getByText(heading).parentElement?.lastElementChild?.textContent?.trim();
const causarAhora = () => screen.queryByRole("button", { name: /Causar ahora/ });
const IVA_RET_LABEL = "IVA Retenido por Cobrar";

describe("GLAccountsForm — decisión 4: «IVA Retenido por Cobrar» OCULTO (no Contribuyente Especial)", () => {
  it.each([
    { caso: "una cuenta de TÍTULO", saved: T_COBRANZAS.id },
    { caso: "un id que ya no existe", saved: "id-de-una-cuenta-eliminada" },
  ])(
    "guardado como $caso: sin alerta, el guardado NO se bloquea y viaja null",
    async ({ saved }) => {
      mount({ ce: false, config: { ...VALID_CONFIG, ivaRetentionReceivableAccountId: saved } });
      expect(screen.queryByLabelText(labelRegex(IVA_RET_LABEL))).toBeNull();
      expectNoSavedAccountsAlert(saveBtn());
      const payload = await saveOk();
      expect(payload).toEqual(
        payloadOf({ ...VALID_CONFIG, ivaRetentionReceivableAccountId: null })
      );
    }
  );

  // B2-S2 (auditoría de seguridad): el campo está oculto, así que el usuario no puede ver ni corregir su valor. Una
  // cuenta de MOVIMIENTO de otro tipo sí es utilizable (el gate solo mira `isPostable`): anularla en silencio
  // dejaría el IVA retenido abierto en el asiento de cobro. Solo se anula lo inservible (título o inexistente).
  it("guardado con una cuenta de movimiento de OTRO tipo (Pasivo): se conserva, no se borra en silencio", async () => {
    mount({ ce: false, config: { ...VALID_CONFIG, ivaRetentionReceivableAccountId: L_CXP.id } });
    expect(screen.queryByLabelText(labelRegex(IVA_RET_LABEL))).toBeNull();
    expectNoSavedAccountsAlert(saveBtn());
    const payload = await saveOk();
    expect(payload.ivaRetentionReceivableAccountId).toBe(L_CXP.id);
    expect(payload).toEqual(
      payloadOf({ ...VALID_CONFIG, ivaRetentionReceivableAccountId: L_CXP.id })
    );
  });

  it("guardado con una cuenta de movimiento VÁLIDA: se conserva sin tocar, aunque el campo no se vea", async () => {
    mount({ ce: false, config: VALID_CONFIG });
    expect(screen.queryByLabelText(labelRegex(IVA_RET_LABEL))).toBeNull();
    expectNoSavedAccountsAlert(saveBtn());
    const payload = await saveOk();
    expect(payload.ivaRetentionReceivableAccountId).toBe(A_IVARET.id);
    expect(payload).toEqual(payloadOf(VALID_CONFIG));
  });

  it("el campo oculto inválido NO figura en la alerta, pero los visibles con problema SÍ", () => {
    mount({
      ce: false,
      config: {
        ...VALID_CONFIG,
        arAccountId: T_COBRANZAS.id,
        ivaRetentionReceivableAccountId: T_COBRANZAS.id,
      },
    });
    expectAlertListing(["Cuentas por Cobrar (CxC)"], [IVA_RET_LABEL]);
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
  });

  it("un campo visible inválido bloquea aunque el oculto sea válido; arreglarlo envía el oculto intacto", async () => {
    mount({ ce: false, config: { ...VALID_CONFIG, arAccountId: T_COBRANZAS.id } });
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
    pickByCode(box("arAccountId"), A_CXC.code);
    const payload = await saveOk();
    expect(payload).toEqual(payloadOf(VALID_CONFIG));
  });

  it("Contribuyente Especial con un TÍTULO guardado en ese campo: SÍ alerta, el botón se bloquea y el submit no llama a la acción", async () => {
    mount({
      ce: true,
      config: { ...VALID_CONFIG, ivaRetentionReceivableAccountId: T_COBRANZAS.id },
    });
    expectAlertListing([IVA_RET_LABEL], ["Cuentas por Cobrar (CxC)", "IGTF por Pagar"]);
    expect(box("ivaRetentionReceivableAccountId").value).toBe("");
    expect(box("ivaRetentionReceivableAccountId").getAttribute("aria-invalid")).toBe("true");
    expectBlockedByAlert(saveBtn(), IVA_RET_LABEL);
    fireEvent.submit(form());
    await flush();
    expect(saveGLConfigAction).not.toHaveBeenCalled();
  });

  it("la misma configuración pasa de oculta a bloqueada al volverse Contribuyente Especial, y de vuelta", () => {
    const { refresh } = mount({
      ce: false,
      config: { ...VALID_CONFIG, ivaRetentionReceivableAccountId: T_COBRANZAS.id },
    });
    expectNoSavedAccountsAlert(saveBtn());
    refresh({ ce: true });
    expectAlertListing([IVA_RET_LABEL]);
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
    refresh({ ce: false });
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("Contribuyente Especial: quitar la cuenta del título retira la alerta y se guarda null", async () => {
    mount({
      ce: true,
      config: { ...VALID_CONFIG, ivaRetentionReceivableAccountId: T_COBRANZAS.id },
    });
    clearField(box("ivaRetentionReceivableAccountId"));
    expectNoSavedAccountsAlert(saveBtn());
    const payload = await saveOk();
    expect(payload).toEqual(payloadOf({ ...VALID_CONFIG, ivaRetentionReceivableAccountId: null }));
  });
});

describe("GLAccountsForm — decisión 4: las insignias «Activo» / «Incompleto» cuentan SOLO cuentas elegibles", () => {
  const SALE = [
    { key: "arAccountId", titulo: T_COBRANZAS, etiqueta: "Cuentas por Cobrar (CxC)" },
    { key: "salesAccountId", titulo: T_INGRESOS, etiqueta: "Ingresos por Ventas" },
    { key: "ivaDFAccountId", titulo: T_EXIGIBLE, etiqueta: "IVA Débito Fiscal" },
  ] as const;
  const PURCHASE = [
    { key: "inventoryAccountId", titulo: T_ACTIVO, etiqueta: "Inventario de Mercancías" },
    { key: "apAccountId", titulo: T_PASIVO, etiqueta: "Cuentas por Pagar (CxP)" },
    { key: "ivaCFAccountId", titulo: T_CORRIENTE, etiqueta: "IVA Crédito Fiscal" },
  ] as const;

  it.each(SALE)(
    "Venta: «$etiqueta» guardada como TÍTULO ⇒ «Facturas de Venta» Incompleto y «Compra» sigue Activo",
    ({ key, titulo }) => {
      mount({ config: { ...VALID_CONFIG, [key]: titulo.id } });
      expect(sectionBadge("Facturas de Venta")).toBe("Incompleto");
      expect(sectionBadge("Facturas de Compra")).toBe("Activo");
    }
  );

  it.each(PURCHASE)(
    "Compra: «$etiqueta» guardada como TÍTULO ⇒ «Facturas de Compra» Incompleto y «Venta» sigue Activo",
    ({ key, titulo }) => {
      mount({ config: { ...VALID_CONFIG, [key]: titulo.id } });
      expect(sectionBadge("Facturas de Compra")).toBe("Incompleto");
      expect(sectionBadge("Facturas de Venta")).toBe("Activo");
    }
  );

  it.each(SALE)("Venta: sin «$etiqueta» (null) basta para que quede Incompleto", ({ key }) => {
    mount({ config: { ...VALID_CONFIG, [key]: null } });
    expect(sectionBadge("Facturas de Venta")).toBe("Incompleto");
    expect(sectionBadge("Facturas de Compra")).toBe("Activo");
  });

  it.each(PURCHASE)("Compra: sin «$etiqueta» (null) basta para que quede Incompleto", ({ key }) => {
    mount({ config: { ...VALID_CONFIG, [key]: null } });
    expect(sectionBadge("Facturas de Compra")).toBe("Incompleto");
    expect(sectionBadge("Facturas de Venta")).toBe("Activo");
  });

  it("una cuenta guardada que ya no existe tampoco cuenta; volver a elegirla de movimiento la devuelve a Activo", () => {
    mount({ config: { ...VALID_CONFIG, arAccountId: "id-de-una-cuenta-eliminada" } });
    expect(sectionBadge("Facturas de Venta")).toBe("Incompleto");
    pickByCode(box("arAccountId"), A_CXC.code);
    expect(sectionBadge("Facturas de Venta")).toBe("Activo");
  });

  it("una cuenta de movimiento de OTRO tipo guardada en un campo no cuenta como configurada", () => {
    mount({ config: { ...VALID_CONFIG, ivaDFAccountId: A_CXC.id } });
    expect(sectionBadge("Facturas de Venta")).toBe("Incompleto");
  });

  it("«IVA Retenido en Cobros»: válida ⇒ Activo; null, título o inexistente ⇒ «Recomendado»", () => {
    mount({ ce: true, config: VALID_CONFIG });
    expect(sectionBadge("IVA Retenido en Cobros")).toBe("Activo");
    cleanup();
    for (const saved of [null, T_COBRANZAS.id, "id-eliminado"]) {
      mount({ ce: true, config: { ...VALID_CONFIG, ivaRetentionReceivableAccountId: saved } });
      expect(sectionBadge("IVA Retenido en Cobros")).toMatch(
        /Recomendado — Contribuyente Especial/
      );
      cleanup();
    }
  });

  it("IGTF — Contribuyente Especial: válida ⇒ Activo y sin «Atención»; null o título ⇒ «Requerido» con la advertencia", () => {
    mount({ ce: true, config: VALID_CONFIG });
    expect(sectionBadge("Pagos en Divisas (IGTF)")).toBe("Activo");
    expect(screen.queryByText("Atención:")).toBeNull();
    cleanup();
    for (const saved of [null, T_EXIGIBLE.id, "id-eliminado"]) {
      mount({ ce: true, config: { ...VALID_CONFIG, igtfPayableAccountId: saved } });
      expect(sectionBadge("Pagos en Divisas (IGTF)")).toMatch(/Requerido — Contribuyente Especial/);
      expect(screen.getByText("Atención:")).toBeTruthy();
      cleanup();
    }
  });

  it("IGTF — NO Contribuyente Especial: válida ⇒ Activo; null o título ⇒ «Opcional» y nunca la advertencia", () => {
    mount({ ce: false, config: VALID_CONFIG });
    expect(sectionBadge("Pagos en Divisas (IGTF)")).toBe("Activo");
    cleanup();
    for (const saved of [null, T_EXIGIBLE.id]) {
      mount({ ce: false, config: { ...VALID_CONFIG, igtfPayableAccountId: saved } });
      expect(sectionBadge("Pagos en Divisas (IGTF)")).toBe("Opcional");
      expect(screen.queryByText("Atención:")).toBeNull();
      cleanup();
    }
  });

  it("Diferencial Cambiario: Activo solo con LAS DOS cuentas elegibles; una sola, un título o ninguna ⇒ Opcional", () => {
    mount({ config: VALID_CONFIG });
    expect(sectionBadge("Diferencial Cambiario")).toBe("Activo");
    cleanup();
    const casos = [
      { fxGainAccountId: null },
      { fxLossAccountId: null },
      { fxGainAccountId: T_INGRESOS.id },
      { fxLossAccountId: T_EGRESOS.id },
      { fxGainAccountId: null, fxLossAccountId: null },
    ];
    for (const caso of casos) {
      mount({ config: { ...VALID_CONFIG, ...caso } });
      expect(sectionBadge("Diferencial Cambiario")).toBe("Opcional");
      cleanup();
    }
  });
});

describe("GLAccountsForm — decisión 4: «Causar ahora» depende de la configuración ELEGIBLE (se oculta, no se deshabilita)", () => {
  it("con venta y compra completas se ofrece", () => {
    mount({ config: VALID_CONFIG, unbooked: 3 });
    expect(causarAhora()).toBeTruthy();
    expect(screen.getByText("3 facturas sin asiento contable")).toBeTruthy();
  });

  it("basta UNA de las dos configuraciones completas: venta completa y compra con un título ⇒ se ofrece", () => {
    mount({ config: { ...VALID_CONFIG, apAccountId: T_PASIVO.id }, unbooked: 3 });
    expect(sectionBadge("Facturas de Compra")).toBe("Incompleto");
    expect(causarAhora()).toBeTruthy();
  });

  it("basta UNA de las dos: compra completa y venta vacía ⇒ se ofrece", () => {
    mount({ config: { ...VALID_CONFIG, arAccountId: null }, unbooked: 3 });
    expect(causarAhora()).toBeTruthy();
  });

  it("las DOS incompletas por culpa de TÍTULOS (aunque tengan id guardado) ⇒ no se ofrece", () => {
    mount({
      config: { ...VALID_CONFIG, arAccountId: T_COBRANZAS.id, apAccountId: T_PASIVO.id },
      unbooked: 3,
    });
    expect(sectionBadge("Facturas de Venta")).toBe("Incompleto");
    expect(sectionBadge("Facturas de Compra")).toBe("Incompleto");
    expect(causarAhora()).toBeNull();
    expect(screen.queryByText(/sin asiento contable/)).toBeNull();
  });

  it("sin facturas sin asiento no se ofrece aunque todo esté completo", () => {
    mount({ config: VALID_CONFIG, unbooked: 0 });
    expect(causarAhora()).toBeNull();
  });

  it("con UNA factura sin asiento el texto va en singular", () => {
    mount({ config: VALID_CONFIG, unbooked: 1 });
    expect(screen.getByText("1 factura sin asiento contable")).toBeTruthy();
  });

  // Comportamiento ACTUAL, fijado a propósito: «Causar ahora» causa con la configuración GUARDADA en el servidor
  // (`postUnbookedInvoicesAction(companyId)` no recibe el estado del formulario), así que la alerta de Q4, que
  // solo bloquea «Guardar configuración», no lo deshabilita.
  it("mientras la alerta de Q4 bloquea «Guardar», «Causar ahora» sigue habilitado y llama a la acción con la empresa", async () => {
    mount({ config: { ...VALID_CONFIG, fxGainAccountId: T_INGRESOS.id }, unbooked: 2 });
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
    const button = causarAhora() as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(postUnbookedInvoicesAction).toHaveBeenCalledWith(COMPANY_ID));
    expect(saveGLConfigAction).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Mutantes B2 (test-agent, paso 4): el placeholder de los selectores y el `aria-describedby` hacia el texto de
// ayuda de cada campo no estaban comprobados (los mutantes que los cambiaban sobrevivían).
describe("GLAccountsForm — cada selector tiene su ayuda enlazada y el placeholder de «sin asignar» (mutantes B2)", () => {
  it("los 11 campos: aria-describedby apunta a SU texto de ayuda (no vacío y distinto en cada uno) y el placeholder es el de «sin asignar»", () => {
    mount({ ce: true });
    const hints: string[] = [];
    for (const def of FIELDS) {
      const input = box(def.key);
      const hint = document.getElementById(`${input.id}-hint`);
      expect(hint, `falta el texto de ayuda de «${def.label}»`).not.toBeNull();
      const hintText = (hint?.textContent ?? "").replace(/\s+/g, " ").trim();
      expect(hintText, def.label).not.toBe("");
      expect(input.getAttribute("aria-describedby"), def.label).toBe(`${input.id}-hint`);
      expect(describedByText(input), def.label).toBe(hintText);
      expect(input.getAttribute("placeholder"), def.label).toBe("Sin asignar — buscar cuenta…");
      hints.push(hintText);
    }
    expect(new Set(hints).size).toBe(FIELDS.length);
  });
});
