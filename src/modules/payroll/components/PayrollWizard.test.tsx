// @vitest-environment jsdom
// src/modules/payroll/components/PayrollWizard.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase.
//
// SPEC-012 · ENTREGA B2 · paso 1 (modo RED) — «Configuración de nómina» (`PayrollWizard`), SOLO el paso 3
// «Configuración de Pagos» donde se eligen las cuentas contables: los DIECISIETE selectores (5 de nómina,
// 5 patronales y 7 de beneficios) pasan del <select> nativo a `AccountCombobox` con `clearable`. TODOS son
// OPCIONALES («sin asignar» = «» y viaja como `null`); cada uno ofrece TODO el plan (la página no filtra
// por tipo), con los títulos como encabezados no elegibles.
//
// RN-19: la sección de cuentas se muestra SOLO si hay alguna cuenta de movimiento
// (`selectableAccounts(accounts).length > 0`): con la lista vacía o de puros títulos no hay nada que elegir.
//
// Q4: si un valor guardado de `initial` es un TÍTULO o no existe en `accounts`, el paso 3 muestra
// `SavedAccountsAlert` con los rótulos (la etiqueta visible de cada campo), DESHABILITA «Guardar
// configuración» (con `aria-describedby` hacia la alerta) y reemplazar la cuenta, o quitarla con «Quitar
// la cuenta», retira la alerta. (El botón no es un `submit`: el clic en un botón deshabilitado no llega al
// manejador, así que la defensa en profundidad del `submit` no se puede aislar aquí.)

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import PayrollWizard from "./PayrollWizard";
import type { PayrollConfigRow } from "../services/PayrollConfigService";
import {
  accessibleNames,
  accountComboboxes,
  clearButtonOf,
  clearField,
  expectAccountComboboxes,
  expectAlertListing,
  expectBlockedByAlert,
  expectNoSavedAccountsAlert,
  fieldLabelOf,
  labelOf,
  labelRegex,
  listedOptionLabels,
  moveAcc,
  movementLabels,
  openList,
  pickByCode,
  pressEveryHeader,
  stubJsdomForListbox,
  titleAcc,
  visibleHeaderNames,
  type PlanAccount,
} from "@/__tests__/helpers/account-combobox-forms";

const { savePayrollConfigAction, push } = vi.hoisted(() => ({
  savePayrollConfigAction: vi.fn(),
  push: vi.fn(),
}));

vi.mock("../actions/payroll-config.actions", () => ({ savePayrollConfigAction }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────
// Las 17 cuentas guardadas son DISTINTAS (si dos conceptos de acreedores distintos compartieran cuenta
// saltaría `detectAccountConflict`). Hay 2 cuentas de movimiento de sobra para reemplazar.

const T_ACTIVO = titleAcc("1", "ACTIVO", "ASSET");
const T_CORRIENTE = titleAcc("1.1", "CORRIENTE", "ASSET");
const T_BANCOS = titleAcc("1.1.01.02", "BANCOS", "ASSET");
const A_BANK = moveAcc("1.1.01.02.001", "Cuenta Banco Desembolso", "ASSET");
const T_PRESTAMOS = titleAcc("1.1.03", "PRESTAMOS", "ASSET");
const A_LOAN = moveAcc("1.1.03.01.001", "Cuenta Prestamos Empleados", "ASSET");
const T_PASIVO = titleAcc("2", "PASIVO", "LIABILITY");
const T_EXIGIBLE = titleAcc("2.1", "EXIGIBLE", "LIABILITY");
const T_OBLIGACIONES = titleAcc("2.1.01", "OBLIGACIONES", "LIABILITY");
const T_LABORALES = titleAcc("2.1.01.01", "LABORALES", "LIABILITY");
const LABOR = Array.from({ length: 15 }, (_, i) =>
  moveAcc(
    `2.1.01.01.${String(i + 1).padStart(3, "0")}`,
    `Cuenta Laboral ${String(i + 1).padStart(2, "0")}`,
    "LIABILITY"
  )
);
const T_EGRESOS = titleAcc("5", "EGRESOS", "EXPENSE");
const T_PERSONAL = titleAcc("5.1", "PERSONAL", "EXPENSE");
const T_REMUNERACIONES = titleAcc("5.1.01.01", "REMUNERACIONES", "EXPENSE");
const E_SUELDOS = moveAcc("5.1.01.01.001", "Cuenta Gasto Sueldos", "EXPENSE");
const E_PRESTACIONES = moveAcc("5.1.01.01.002", "Cuenta Gasto Prestaciones", "EXPENSE");

/** Lo que entrega la página: TODO el plan (títulos Y cuentas de movimiento, todos los tipos). */
const PLAN: PlanAccount[] = [
  T_ACTIVO,
  T_CORRIENTE,
  T_BANCOS,
  A_BANK,
  T_PRESTAMOS,
  A_LOAN,
  T_PASIVO,
  T_EXIGIBLE,
  T_OBLIGACIONES,
  T_LABORALES,
  ...LABOR,
  T_EGRESOS,
  T_PERSONAL,
  T_REMUNERACIONES,
  E_SUELDOS,
  E_PRESTACIONES,
];
const TITLE_NAMES = PLAN.filter((a) => !a.isPostable).map((a) => a.name);
const EXTRA_1 = LABOR[13]; // para reemplazar
const EXTRA_2 = LABOR[14];

type GlKey =
  | "expenseAccountId"
  | "payableAccountId"
  | "ivssPayableAccountId"
  | "incesPayableAccountId"
  | "faovPayableAccountId"
  | "ivssPatronalAccountId"
  | "incesPatronalAccountId"
  | "faovPatronalAccountId"
  | "rpePatronalAccountId"
  | "pensionesPatronalAccountId"
  | "benefitsExpenseAccountId"
  | "benefitsPayableAccountId"
  | "vacationPayableAccountId"
  | "profitSharingPayableAccountId"
  | "rpePayableAccountId"
  | "loanReceivableAccountId"
  | "disbursementBankAccountId";

/** Los 17 campos en el ORDEN del paso 3, con su etiqueta visible y la cuenta con la que se guarda. */
const FIELDS: { key: GlKey; label: string; saved: PlanAccount }[] = [
  { key: "expenseAccountId", label: "Gasto Sueldos y Salarios", saved: E_SUELDOS },
  { key: "payableAccountId", label: "Sueldos y Salarios por Pagar (neto)", saved: LABOR[0] },
  { key: "ivssPayableAccountId", label: "IVSS Obrero por Pagar", saved: LABOR[1] },
  { key: "incesPayableAccountId", label: "INCES Obrero por Pagar", saved: LABOR[2] },
  { key: "faovPayableAccountId", label: "FAOV / Banavih Obrero por Pagar", saved: LABOR[3] },
  { key: "ivssPatronalAccountId", label: "IVSS Patronal por Pagar", saved: LABOR[4] },
  { key: "incesPatronalAccountId", label: "INCES Patronal por Pagar", saved: LABOR[5] },
  { key: "faovPatronalAccountId", label: "FAOV Patronal por Pagar", saved: LABOR[6] },
  { key: "rpePatronalAccountId", label: "RPE Patronal por Pagar", saved: LABOR[7] },
  {
    key: "pensionesPatronalAccountId",
    label: "Protección de Pensiones por Pagar",
    saved: LABOR[8],
  },
  { key: "benefitsExpenseAccountId", label: "Gasto Prestaciones Sociales", saved: E_PRESTACIONES },
  { key: "benefitsPayableAccountId", label: "Prestaciones Sociales por Pagar", saved: LABOR[9] },
  { key: "vacationPayableAccountId", label: "Vacaciones por Pagar", saved: LABOR[10] },
  { key: "profitSharingPayableAccountId", label: "Utilidades por Pagar", saved: LABOR[11] },
  { key: "rpePayableAccountId", label: "RPE Obrero por Pagar", saved: LABOR[12] },
  { key: "loanReceivableAccountId", label: "Préstamos a Empleados (Activo 1315)", saved: A_LOAN },
  {
    key: "disbursementBankAccountId",
    label: "Banco de Desembolso (para préstamos)",
    saved: A_BANK,
  },
];
const field = (key: GlKey) => FIELDS.find((f) => f.key === key)!;
const NULL_ACCOUNTS = Object.fromEntries(FIELDS.map((f) => [f.key, null])) as Record<GlKey, null>;
const SAVED_ACCOUNTS = Object.fromEntries(FIELDS.map((f) => [f.key, f.saved.id])) as Record<
  GlKey,
  string
>;

const BASE_CONFIG: PayrollConfigRow = {
  id: "cfg-1",
  companyId: "company-1",
  sizeRange: "SMALL",
  lottRegime: "POST_2012",
  ivssEnabled: true,
  incesEnabled: true,
  banavihEnabled: true,
  rpeEnabled: true,
  pensionesEnabled: false,
  cestaTicketType: "CARD",
  paymentCurrency: "VES",
  frequency: "BIWEEKLY",
  fideicomiso: "INTERNAL",
  ivssRiskClass: "MEDIO",
  salaryMinimumVes: null,
  ...NULL_ACCOUNTS,
  workSchedule: "LUNES_VIERNES",
  autoDraftEnabled: false,
  updatedAt: "2026-10-01T00:00:00.000Z",
};
const VALID_CONFIG: PayrollConfigRow = { ...BASE_CONFIG, ...SAVED_ACCOUNTS };

const COMPANY_ID = "company-1";

beforeAll(stubJsdomForListbox);

beforeEach(() => {
  vi.clearAllMocks();
  savePayrollConfigAction.mockResolvedValue({ success: true, data: VALID_CONFIG });
});

afterEach(cleanup);

// ─── Helpers de render y de navegación ───────────────────────────────────────────────────────────

type Opts = {
  initial?: PayrollConfigRow | null;
  accounts?: PlanAccount[];
  onSaved?: (cfg: PayrollConfigRow) => void;
};

function element({ initial = BASE_CONFIG, accounts = PLAN, onSaved }: Opts) {
  return (
    <PayrollWizard companyId={COMPANY_ID} initial={initial} accounts={accounts} onSaved={onSaved} />
  );
}

/** Monta el asistente y avanza al paso 3 (donde se eligen las cuentas). */
function mount(opts: Opts = {}) {
  const utils = render(element(opts));
  goToStep3();
  return {
    ...utils,
    refresh: (next: Opts) => utils.rerender(element({ ...opts, ...next })),
  };
}

function goToStep3() {
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  expect(screen.getByText(/Paso 3 — Configuración de Pagos/)).toBeTruthy();
}

/** El combobox de un campo por su etiqueta (falla con un mensaje claro si sigue siendo <select>). */
function box(key: GlKey): HTMLInputElement {
  const found = screen.getByLabelText(labelRegex(field(key).label));
  if (found.tagName !== "INPUT") {
    throw new Error(
      `«${field(key).label}» sigue siendo ${found.tagName} (se esperaba un <input role=combobox>)`
    );
  }
  return found as HTMLInputElement;
}

const saveBtn = () => screen.getByRole("button", { name: /Guardar configuración|Guardando/ });
const clearButtons = () => screen.queryAllByRole("button", { name: "Quitar la cuenta" });
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const nativeAccountOptions = () =>
  Array.from(document.querySelectorAll("option"))
    .map((o) => o.textContent ?? "")
    .filter((text) => / — /.test(text) && /\d/.test(text));

const asTitle = (a: PlanAccount): PlanAccount => ({ ...a, isPostable: false });
const withTitle = (list: readonly PlanAccount[], target: PlanAccount) =>
  list.map((a) => (a.id === target.id ? asTitle(a) : a));
const without = (list: readonly PlanAccount[], ...targets: PlanAccount[]) =>
  list.filter((a) => !targets.some((t) => t.id === a.id));

async function saveOk() {
  fireEvent.click(saveBtn());
  await waitFor(() => expect(savePayrollConfigAction).toHaveBeenCalledTimes(1));
  const [companyId, payload] = savePayrollConfigAction.mock.calls[0];
  expect(companyId).toBe(COMPANY_ID);
  return payload as Record<string, unknown>;
}

/** El payload esperado de las 17 cuentas: lo guardado en `base`, con `changes` encima (null = sin asignar). */
const accountsPayload = (
  changes: Partial<Record<GlKey, string | null>> = {},
  base: Record<GlKey, string | null> = NULL_ACCOUNTS
) => ({ ...base, ...changes }) as Record<GlKey, string | null>;
const pick17 = (payload: Record<string, unknown>) =>
  Object.fromEntries(FIELDS.map((f) => [f.key, payload[f.key]])) as Record<GlKey, unknown>;

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("PayrollWizard · paso 3 — los 17 selectores son AccountCombobox (SPEC-012 B2)", () => {
  it("hay DIECISIETE <input role=combobox> y ningún <select> nativo en el paso 3", () => {
    mount();
    expectAccountComboboxes(17, "PayrollWizard paso 3");
    expect(document.querySelectorAll("select")).toHaveLength(0);
    expect(nativeAccountOptions()).toEqual([]);
  });

  it("los pasos 1 y 2 NO tienen selectores de cuenta (el <select> de riesgo IVSS del paso 2 sigue nativo) — guarda verde", () => {
    render(element({}));
    expect(accountComboboxes()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(accountComboboxes()).toHaveLength(0);
    expect(document.querySelectorAll("select")).toHaveLength(1);
    expect(document.getElementById("ivssRiskClass")).toBeTruthy();
  });

  it("D9: cada etiqueta está asociada a SU combobox y los 17 nombres accesibles son distintos", () => {
    mount();
    for (const def of FIELDS) {
      expect(fieldLabelOf(box(def.key))).toBe(def.label);
    }
    const names = accessibleNames();
    expect(names).toHaveLength(17);
    expect(names.every((n) => n.trim() !== "")).toBe(true);
    expect(new Set(names).size).toBe(17);
  });

  it("los campos aparecen en el orden de siempre: nómina (5), aportes patronales (5) y beneficios (7)", () => {
    mount();
    const inputs = expectAccountComboboxes(17, "PayrollWizard paso 3");
    expect(inputs.map((input) => fieldLabelOf(input))).toEqual(FIELDS.map((f) => f.label));
  });

  it("sin `required` nativo (los 17 son opcionales)", () => {
    mount();
    for (const input of accountComboboxes()) expect(input.required).toBe(false);
  });

  it.each([FIELDS[0], FIELDS[8], FIELDS[16]])(
    "«$label» ofrece TODO el plan (movimiento) con los títulos como encabezados",
    (def) => {
      mount();
      openList(box(def.key));
      expect(listedOptionLabels()).toEqual(movementLabels(PLAN));
      expect(visibleHeaderNames(TITLE_NAMES)).toEqual(TITLE_NAMES);
    }
  );
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("PayrollWizard · paso 3 — RN-19: la sección de cuentas solo aparece si hay cuentas de movimiento", () => {
  it("sin la prop `accounts` (como en la página de nómina sin configuración) no hay sección de cuentas — guarda verde", () => {
    render(<PayrollWizard companyId={COMPANY_ID} initial={null} />);
    goToStep3();
    expect(accountComboboxes()).toHaveLength(0);
    expect(screen.queryByText(/Cuentas contables — Nómina/)).toBeNull();
  });

  it("con SOLO títulos la sección de cuentas se oculta (los títulos no cuentan): ni selectores ni encabezados de sección", () => {
    mount({ accounts: PLAN.filter((a) => !a.isPostable) });
    expect(accountComboboxes()).toHaveLength(0);
    expect(nativeAccountOptions()).toEqual([]);
    expect(screen.queryByText(/Cuentas contables — Nómina/)).toBeNull();
    expect(screen.queryByText(/Cuentas contables — Aportes patronales/)).toBeNull();
    expect(screen.queryByText(/Cuentas contables — Beneficios legales/)).toBeNull();
  });

  it("con UNA cuenta de movimiento entre muchos títulos la sección se muestra y cada selector ofrece solo esa cuenta", () => {
    mount({ accounts: [...PLAN.filter((a) => !a.isPostable), E_SUELDOS] });
    expectAccountComboboxes(17, "una sola cuenta de movimiento");
    openList(box("expenseAccountId"));
    expect(listedOptionLabels()).toEqual([labelOf(E_SUELDOS)]);
  });

  it("con cuentas de movimiento la sección y sus tres encabezados se muestran", () => {
    mount();
    expect(screen.getByText(/Cuentas contables — Nómina \(sueldos\)/)).toBeTruthy();
    expect(screen.getByText(/Cuentas contables — Aportes patronales/)).toBeTruthy();
    expect(screen.getByText(/Cuentas contables — Beneficios legales/)).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("PayrollWizard · paso 3 — todos OPCIONALES: `clearable`, «sin asignar» = null", () => {
  it("sin configuración previa: los 17 nacen vacíos y ninguno muestra «Quitar la cuenta»", () => {
    mount();
    for (const def of FIELDS) {
      expect(box(def.key).value).toBe("");
      expect(clearButtonOf(box(def.key))).toBeNull();
    }
    expect(clearButtons()).toHaveLength(0);
  });

  it("con la configuración completa los 17 muestran «código — nombre» y cada uno tiene su «Quitar la cuenta»", () => {
    mount({ initial: VALID_CONFIG });
    for (const def of FIELDS) {
      expect(box(def.key).value).toBe(labelOf(def.saved));
      expect(clearButtonOf(box(def.key))).not.toBeNull();
    }
    expect(clearButtons()).toHaveLength(17);
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("guardar SIN elegir nada envía las 17 cuentas en null (nunca «»)", async () => {
    mount();
    const payload = await saveOk();
    expect(pick17(payload)).toEqual(accountsPayload());
  });

  it("guardar la configuración vigente sin tocar nada envía las 17 cuentas tal cual", async () => {
    mount({ initial: VALID_CONFIG });
    const payload = await saveOk();
    expect(pick17(payload)).toEqual(accountsPayload({}, SAVED_ACCOUNTS));
  });

  it("elegir cuentas tecleando el código + Enter: solo esos campos llevan id, el resto null; navega y avisa onSaved", async () => {
    const onSaved = vi.fn();
    mount({ onSaved });
    pickByCode(box("expenseAccountId"), "510101001");
    pickByCode(box("payableAccountId"), LABOR[0].code);
    pickByCode(box("disbursementBankAccountId"), A_BANK.code);
    expect(box("expenseAccountId").value).toBe(labelOf(E_SUELDOS));
    const payload = await saveOk();
    expect(pick17(payload)).toEqual(
      accountsPayload({
        expenseAccountId: E_SUELDOS.id,
        payableAccountId: LABOR[0].id,
        disbursementBankAccountId: A_BANK.id,
      })
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/company/${COMPANY_ID}/payroll`));
    expect(onSaved).toHaveBeenCalledWith(VALID_CONFIG);
  });

  it("«Quitar la cuenta» deja el campo vacío, retira su botón y envía null; los demás no se tocan", async () => {
    mount({ initial: VALID_CONFIG });
    const input = box("rpePayableAccountId");
    clearField(input);
    expect(input.value).toBe("");
    expect(clearButtonOf(input)).toBeNull();
    expect(clearButtons()).toHaveLength(16);
    const payload = await saveOk();
    expect(pick17(payload)).toEqual(accountsPayload({ rpePayableAccountId: null }, SAVED_ACCOUNTS));
  });

  it("vaciar el TEXTO y salir NO quita la cuenta (RN-15: solo el botón lo hace)", () => {
    mount({ initial: VALID_CONFIG });
    const input = box("vacationPayableAccountId");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe(labelOf(field("vacationPayableAccountId").saved));
  });

  it("las elecciones se conservan al ir al paso 2 y volver al 3", async () => {
    mount();
    pickByCode(box("expenseAccountId"), E_SUELDOS.code);
    fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(box("expenseAccountId").value).toBe(labelOf(E_SUELDOS));
    const payload = await saveOk();
    expect(payload.expenseAccountId).toBe(E_SUELDOS.id);
  });

  it("el resto del payload (organismos, moneda, frecuencia…) no cambia", async () => {
    mount({ initial: VALID_CONFIG });
    const payload = await saveOk();
    expect(payload).toMatchObject({
      sizeRange: "SMALL",
      lottRegime: "POST_2012",
      ivssEnabled: true,
      incesEnabled: true,
      banavihEnabled: true,
      rpeEnabled: true,
      pensionesEnabled: false,
      cestaTicketType: "CARD",
      paymentCurrency: "VES",
      frequency: "BIWEEKLY",
      fideicomiso: "INTERNAL",
      workSchedule: "LUNES_VIERNES",
      ivssRiskClass: "MEDIO",
      salaryMinimumVes: null,
    });
  });

  it("si la acción falla muestra su error y NO navega (guarda verde)", async () => {
    savePayrollConfigAction.mockResolvedValue({ success: false, error: "Sin permiso" });
    mount({ initial: VALID_CONFIG });
    fireEvent.click(saveBtn());
    expect(await screen.findByText("Sin permiso")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("PayrollWizard · paso 3 — los títulos NO se pueden elegir (CA-9)", () => {
  it.each([FIELDS[0], FIELDS[9], FIELDS[16]])(
    "clic sobre los encabezados de «$label» no elige nada: sigue vacío y se envía null",
    async (def) => {
      mount();
      const input = box(def.key);
      pressEveryHeader(input, TITLE_NAMES);
      fireEvent.blur(input);
      expect(input.value).toBe("");
      const payload = await saveOk();
      expect(payload[def.key]).toBeNull();
    }
  );

  it("clic sobre los encabezados no cambia una cuenta ya elegida", () => {
    mount({ initial: VALID_CONFIG });
    const input = box("expenseAccountId");
    pressEveryHeader(input, ["EGRESOS", "PERSONAL", "REMUNERACIONES"]);
    fireEvent.blur(input);
    expect(input.value).toBe(labelOf(E_SUELDOS));
  });

  it("ningún id enviado es el de un título", async () => {
    mount();
    for (const def of FIELDS) {
      pressEveryHeader(box(def.key), ["PASIVO", "LABORALES"]);
      fireEvent.blur(box(def.key));
    }
    const payload = await saveOk();
    for (const def of FIELDS) expect(String(payload[def.key] ?? "").startsWith("t:")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("PayrollWizard · paso 3 — la regla de cuentas duplicadas (detectAccountConflict) sigue valiendo", () => {
  it("la MISMA cuenta en dos conceptos de acreedores distintos (IVSS e INCES obrero): alerta de cuenta GL duplicada y «Guardar» deshabilitado", () => {
    mount();
    pickByCode(box("ivssPayableAccountId"), LABOR[0].code);
    pickByCode(box("incesPayableAccountId"), LABOR[0].code);
    expect(screen.getByText(/Cuenta GL duplicada/)).toBeTruthy();
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
  });

  it("la misma cuenta en el obrero y el patronal del MISMO organismo (IVSS) está permitida", async () => {
    mount();
    pickByCode(box("ivssPayableAccountId"), LABOR[0].code);
    pickByCode(box("ivssPatronalAccountId"), LABOR[0].code);
    expect(screen.queryByText(/Cuenta GL duplicada/)).toBeNull();
    const payload = await saveOk();
    expect(payload.ivssPayableAccountId).toBe(LABOR[0].id);
    expect(payload.ivssPatronalAccountId).toBe(LABOR[0].id);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Q4 — la configuración guardada apunta a un título o a una cuenta que no existe.
describe("PayrollWizard · paso 3 — Q4: alerta que BLOQUEA el guardado (valor guardado no elegible)", () => {
  const withSaved = (changes: Partial<Record<GlKey, string>>): PayrollConfigRow => ({
    ...VALID_CONFIG,
    ...changes,
  });
  const EXPENSE_LABEL = field("expenseAccountId").label;
  const PAYABLE_LABEL = field("payableAccountId").label;

  it("una cuenta de TÍTULO guardada: alerta en el paso 3 que lista SOLO ese campo", () => {
    mount({ initial: withSaved({ expenseAccountId: T_PERSONAL.id }) });
    expectAlertListing([EXPENSE_LABEL], [PAYABLE_LABEL, field("ivssPayableAccountId").label]);
  });

  it("el campo del título queda VACÍO e inválido; los demás conservan su cuenta", () => {
    mount({ initial: withSaved({ expenseAccountId: T_PERSONAL.id }) });
    expect(box("expenseAccountId").value).toBe("");
    expect(box("expenseAccountId").getAttribute("aria-invalid")).toBe("true");
    expect(box("payableAccountId").value).toBe(labelOf(LABOR[0]));
    expect(box("payableAccountId").getAttribute("aria-invalid")).not.toBe("true");
  });

  it("«Guardar configuración» queda DESHABILITADO y su descripción accesible apunta a la alerta", () => {
    mount({ initial: withSaved({ expenseAccountId: T_PERSONAL.id }) });
    expectBlockedByAlert(saveBtn(), EXPENSE_LABEL);
  });

  it("hacer clic en el botón deshabilitado NO llama a la acción", async () => {
    mount({ initial: withSaved({ expenseAccountId: T_PERSONAL.id }) });
    fireEvent.click(saveBtn());
    await flush();
    expect(savePayrollConfigAction).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("una cuenta que YA NO EXISTE (id ausente del plan): misma alerta; «Quitar la cuenta» la retira y envía null", async () => {
    mount({ initial: withSaved({ faovPatronalAccountId: "id-de-una-cuenta-eliminada" }) });
    const label = field("faovPatronalAccountId").label;
    expectAlertListing([label], [EXPENSE_LABEL]);
    expect(box("faovPatronalAccountId").value).toBe("");
    expect(box("faovPatronalAccountId").getAttribute("aria-invalid")).toBe("true");
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
    clearField(box("faovPatronalAccountId"));
    expectNoSavedAccountsAlert(saveBtn());
    const payload = await saveOk();
    expect(pick17(payload)).toEqual(
      accountsPayload({ faovPatronalAccountId: null }, SAVED_ACCOUNTS)
    );
  });

  it("reemplazar la cuenta del título por una de movimiento retira la alerta y se guarda con la nueva", async () => {
    mount({ initial: withSaved({ expenseAccountId: T_PERSONAL.id }) });
    pickByCode(box("expenseAccountId"), E_SUELDOS.code);
    expectNoSavedAccountsAlert(saveBtn());
    const payload = await saveOk();
    expect(pick17(payload)).toEqual(accountsPayload({}, SAVED_ACCOUNTS));
  });

  it("varios campos con problema (título, id ausente, título): la alerta los lista y arreglarlos de a uno la achica", () => {
    mount({
      initial: withSaved({
        expenseAccountId: T_PERSONAL.id,
        payableAccountId: "no-existe",
        loanReceivableAccountId: T_PRESTAMOS.id,
      }),
    });
    const loanLabel = field("loanReceivableAccountId").label;
    expectAlertListing(
      [EXPENSE_LABEL, PAYABLE_LABEL, loanLabel],
      [field("ivssPayableAccountId").label]
    );
    pickByCode(box("expenseAccountId"), E_SUELDOS.code);
    expectAlertListing([PAYABLE_LABEL, loanLabel], [EXPENSE_LABEL]);
    clearField(box("payableAccountId"));
    expectAlertListing([loanLabel], [PAYABLE_LABEL]);
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
    pickByCode(box("loanReceivableAccountId"), A_LOAN.code);
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("clic sobre los encabezados NO arregla el problema: la alerta sigue y el botón también bloqueado", () => {
    mount({ initial: withSaved({ expenseAccountId: T_PERSONAL.id }) });
    pressEveryHeader(box("expenseAccountId"), TITLE_NAMES);
    fireEvent.blur(box("expenseAccountId"));
    expect(box("expenseAccountId").value).toBe("");
    expectAlertListing([EXPENSE_LABEL]);
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
  });

  it("sin valores guardados (todo null) NO hay alerta", () => {
    mount({ initial: BASE_CONFIG });
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("sin configuración previa (`initial` null) NO hay alerta y se puede guardar", () => {
    mount({ initial: null });
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("una configuración totalmente válida NO muestra alerta y deja guardar", () => {
    mount({ initial: VALID_CONFIG });
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("la alerta usa los valores ACTUALES: si tras refrescar el plan una cuenta guardada pasa a ser título, aparece; al volver a ser elegible, se retira", () => {
    const { refresh } = mount({ initial: VALID_CONFIG });
    expectNoSavedAccountsAlert(saveBtn());
    refresh({ accounts: withTitle(PLAN, LABOR[0]) });
    expectAlertListing([PAYABLE_LABEL], [EXPENSE_LABEL]);
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
    refresh({ accounts: PLAN });
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("una cuenta elegida por el usuario que luego desaparece del plan también bloquea el guardado", async () => {
    const { refresh } = mount({ initial: BASE_CONFIG });
    pickByCode(box("rpePatronalAccountId"), EXTRA_1.code);
    expectNoSavedAccountsAlert(saveBtn());
    refresh({ accounts: without(PLAN, EXTRA_1) });
    expectAlertListing([field("rpePatronalAccountId").label]);
    expect(saveBtn().hasAttribute("disabled")).toBe(true);
    fireEvent.click(saveBtn());
    await flush();
    expect(savePayrollConfigAction).not.toHaveBeenCalled();
  });

  it("un refresco que deja todo igual (objetos nuevos) NO muestra la alerta", () => {
    const { refresh } = mount({ initial: VALID_CONFIG });
    refresh({ accounts: PLAN.map((a) => ({ ...a })) });
    expectNoSavedAccountsAlert(saveBtn());
  });

  it("OTRAS cuentas (las que no están guardadas) que pasan a título o desaparecen NO activan la alerta", () => {
    const { refresh } = mount({ initial: VALID_CONFIG });
    refresh({ accounts: withTitle(PLAN, EXTRA_1) });
    expectNoSavedAccountsAlert(saveBtn());
    refresh({ accounts: without(PLAN, EXTRA_2) });
    expectNoSavedAccountsAlert(saveBtn());
  });
});
