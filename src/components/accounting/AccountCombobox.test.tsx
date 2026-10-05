// @vitest-environment jsdom
// src/components/accounting/AccountCombobox.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Todo lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase
// (único cambio permitido en el paso 2: sustituir el import dinámico por un import estático).
//
// SPEC-012 (Entrega A, paso 1, modo RED) — comportamiento del combobox de cuenta.
// Cubre CA-5 (opción activa inicial), CA-9 (títulos no elegibles), CA-12..CA-15, CA-18 y los estados
// vacío / sin resultados / tope de 100 con el copy exacto de la SPEC §8.
//
// Se escribe contra ROLES, nombres accesibles y atributos ARIA: nada de clases, ni de Radix, ni de
// detalles internos. Excepción declarada: la sangría por nivel de los encabezados (`indentOf`), que
// necesita ALGUNA señal medible; admite `data-depth`/`aria-level`, un estilo en línea o una clase
// `pl-*`/`ps-*`/`ml-*`. Recomendado: `data-depth={depth}` en cada fila.
//
// Modo RED: `./AccountCombobox` aún no existe (lo crea el ui-agent). Se carga con un import dinámico
// de especificador no literal y se tipan sus props con el contrato de la SPEC §7, de modo que `tsc` no
// falle y cada caso falle por su propia razón. En GREEN se puede pasar a
// `import { AccountCombobox } from "./AccountCombobox"`.

import { useState } from "react";
import type { ComponentType } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { AccountCombobox } from "./AccountCombobox";

// ─── Contrato (SPEC §7) ──────────────────────────────────────────────────────────────────────────

type AccountOption = { id: string; code: string; name: string; isPostable: boolean };
type AccountComboboxProps = {
  accounts: readonly AccountOption[];
  value: string;
  onChange: (accountId: string) => void;
  id?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

async function loadCombobox(): Promise<ComponentType<AccountComboboxProps>> {
  return AccountCombobox;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────

const t = (code: string, name: string): AccountOption => ({
  id: `t:${code}`,
  code,
  name,
  isPostable: false,
});
const m = (code: string, name: string): AccountOption => ({
  id: `m:${code}`,
  code,
  name,
  isPostable: true,
});

/** Nombres de los títulos en MAYÚSCULAS y de una sola palabra, distintos de los de las cuentas. */
const PLAN: readonly AccountOption[] = [
  t("1", "ACTIVO"),
  t("1.1", "CORRIENTE"),
  t("1.1.01", "DISPONIBLE"),
  t("1.1.01.01", "CAJAS"),
  m("1.1.01.01.001", "Caja Principal"),
  m("1.1.01.01.002", "Caja Chica"),
  t("1.1.01.02", "BANCOS"),
  m("1.1.01.02.001", "Banco Mercantil"),
  t("2", "PASIVO"),
  t("2.1", "EXIGIBLE"),
  t("2.1.01", "OBLIGACIONES"),
  t("2.1.01.01", "PROVEEDORES"),
  m("2.1.01.01.001", "Proveedores Nacionales"),
];

const TITLE_NAMES = [
  "ACTIVO",
  "CORRIENTE",
  "DISPONIBLE",
  "CAJAS",
  "BANCOS",
  "PASIVO",
  "EXIGIBLE",
  "OBLIGACIONES",
  "PROVEEDORES",
];

const CAJA_P = "1.1.01.01.001 — Caja Principal";
const CAJA_C = "1.1.01.01.002 — Caja Chica";
const BANCO = "1.1.01.02.001 — Banco Mercantil";
const PROV = "2.1.01.01.001 — Proveedores Nacionales";
const ALL_OPTIONS = [CAJA_P, CAJA_C, BANCO, PROV];

const ID_CAJA_P = "m:1.1.01.01.001";
const ID_CAJA_C = "m:1.1.01.01.002";
const ID_BANCO = "m:1.1.01.02.001";
const ID_PROV = "m:2.1.01.01.001";
const MOVEMENT_IDS = [ID_CAJA_P, ID_CAJA_C, ID_BANCO, ID_PROV];
const TITLE_IDS = PLAN.filter((a) => !a.isPostable).map((a) => a.id);

/** La coincidencia exacta («110101002») NO es la primera en orden de código. */
const EXACT_PLAN: readonly AccountOption[] = [
  t("1", "ACTIVO"),
  t("1.1", "CORRIENTE"),
  t("1.1.01", "DISPONIBLE"),
  t("1.1.01.01", "CAJAS"),
  m("1.1.01.01.001", "Ajuste 110101002"),
  m("1.1.01.01.002", "Caja Chica"),
  m("1.1.01.01.003", "Caja Grande"),
];
const AJUSTE = "1.1.01.01.001 — Ajuste 110101002";
const CHICA = "1.1.01.01.002 — Caja Chica";
const GRANDE = "1.1.01.01.003 — Caja Grande";

/** ADR-059: los nombres de títulos y de cuentas SE REPITEN; lo único es el código. */
const DUP_PLAN: readonly AccountOption[] = [
  t("1", "ACTIVO"),
  t("1.1", "CORRIENTE"),
  t("1.1.01", "OTROS"),
  t("1.1.01.01", "OTROS"),
  m("1.1.01.01.001", "Caja"),
  t("1.1.02", "OTROS"),
  t("1.1.02.01", "OTROS"),
  m("1.1.02.01.001", "Caja"),
];

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** `count` cuentas «Cuenta NNN» bajo `groups` títulos (los encabezados NO deben contar para el tope). */
function manyAccounts(count: number, groups = 1): AccountOption[] {
  const out: AccountOption[] = [t("1", "ACTIVO"), t("1.1", "CORRIENTE"), t("1.1.01", "DISPONIBLE")];
  const perGroup = Math.ceil(count / groups);
  let made = 0;
  for (let g = 1; g <= groups && made < count; g++) {
    out.push(t(`1.1.01.${pad(g, 2)}`, `GRUPO ${pad(g, 2)}`));
    for (let n = 1; n <= perGroup && made < count; n++, made++) {
      out.push(m(`1.1.01.${pad(g, 2)}.${pad(n, 3)}`, `Cuenta ${pad(g, 2)}-${pad(n, 3)}`));
    }
  }
  return out;
}

const PLACEHOLDER = "Buscar por código o nombre…";
const CAP_NOTICE = "Mostrando las primeras 100. Escribe más para afinar.";
const NO_ACCOUNTS = "No hay cuentas disponibles";

// ─── jsdom ───────────────────────────────────────────────────────────────────────────────────────

beforeAll(() => {
  // jsdom no implementa lo que un listbox con scroll hacia la opción activa (o un Popper) suele usar.
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

afterEach(cleanup);

// ─── Helpers de render ───────────────────────────────────────────────────────────────────────────

type ExtraProps = Partial<Omit<AccountComboboxProps, "accounts" | "value" | "onChange">>;

/** Uso real: el padre guarda el valor que emite `onChange` (como el `field` de react-hook-form). */
async function renderControlled({
  initial = "",
  accounts = PLAN,
  ...props
}: ExtraProps & { initial?: string; accounts?: readonly AccountOption[] } = {}) {
  const Combobox = await loadCombobox();
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <Combobox
        aria-label="Cuenta"
        {...props}
        accounts={accounts}
        value={value}
        onChange={(id) => {
          onChange(id);
          setValue(id);
        }}
      />
    );
  }
  const utils = render(<Harness />);
  return { ...utils, onChange, input: screen.getByRole("combobox") as HTMLInputElement };
}

/** Valor fijado por el test (para probar cambios externos con `rerender`). */
async function renderPlain(value: string, accounts: readonly AccountOption[] = PLAN) {
  const Combobox = await loadCombobox();
  const onChange = vi.fn();
  const ui = (v: string) => (
    <Combobox aria-label="Cuenta" accounts={accounts} value={v} onChange={onChange} />
  );
  const utils = render(ui(value));
  return {
    ...utils,
    onChange,
    input: screen.getByRole("combobox") as HTMLInputElement,
    setValue: (v: string) => utils.rerender(ui(v)),
  };
}

// ─── Helpers de interacción y consulta ───────────────────────────────────────────────────────────

const typeInto = (input: HTMLElement, text: string) =>
  fireEvent.change(input, { target: { value: text } });
const press = (input: HTMLElement, key: string) => fireEvent.keyDown(input, { key });

/** Eventos de ratón sin mover el foco (para comprobar que un encabezado no reacciona a ninguno). */
function pressMouse(el: Element) {
  fireEvent.mouseDown(el);
  fireEvent.mouseUp(el);
  fireEvent.click(el);
}

/**
 * Clic como lo hace un navegador: si `mousedown` NO se cancela, el foco sale del input (blur) antes
 * del `click`. Un selector que cierra la lista en el blur sin proteger el clic NO llega a elegir.
 */
function clickLikeBrowser(target: Element, input: HTMLElement) {
  const notCanceled = fireEvent.mouseDown(target);
  if (notCanceled) fireEvent.blur(input);
  fireEvent.mouseUp(target);
  fireEvent.click(target);
}

const bodyText = () => document.body.textContent ?? "";
const optionLabels = () => screen.queryAllByRole("option").map((o) => o.textContent?.trim());
const optionEl = (label: string) => screen.getByRole("option", { name: label });

function activeOption(input: HTMLElement): HTMLElement | null {
  const id = input.getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
}
const activeLabel = (input: HTMLElement) => activeOption(input)?.textContent?.trim() ?? null;

/** Encabezado de un título por su NOMBRE (único y en mayúsculas en los fixtures). */
function headerEl(name: string): HTMLElement | null {
  const root = screen.queryByRole("listbox") ?? document.body;
  return within(root as HTMLElement).queryByText(new RegExp(`\\b${name}\\b`));
}
const visibleTitleNames = () => TITLE_NAMES.filter((n) => headerEl(n) !== null);

const isBefore = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
function expectInDocumentOrder(...els: Element[]) {
  for (let i = 0; i < els.length - 1; i++) expect(isBefore(els[i], els[i + 1])).toBe(true);
}

/** `n` de «{n} cuentas» en la región aria-live="polite" (acepta «1 cuenta»). */
function announcedCount(): number | null {
  const region = document.querySelector('[aria-live="polite"]');
  const found = /(\d+)\s+cuentas?/i.exec(region?.textContent ?? "");
  return found ? Number(found[1]) : null;
}

function lengthPx(raw: string): number | null {
  const found = /^(-?\d+(?:\.\d+)?)(px|rem|em)?$/.exec(raw.trim());
  if (!found) return null;
  return Number(found[1]) * (found[2] === "rem" || found[2] === "em" ? 16 : 1);
}

/** Señal de sangría de un encabezado (ver el comentario de cabecera). `null` = no hay señal medible. */
function indentOf(el: HTMLElement): number | null {
  const list = el.closest('[role="listbox"]');
  for (let node: HTMLElement | null = el; node && node !== list; node = node.parentElement) {
    const attr =
      node.getAttribute("data-depth") ??
      node.getAttribute("data-level") ??
      node.getAttribute("aria-level");
    if (attr !== null && !Number.isNaN(Number(attr))) return Number(attr);
    for (const raw of [
      node.style.paddingLeft,
      node.style.marginLeft,
      node.style.paddingInlineStart,
      node.style.marginInlineStart,
      node.style.textIndent,
    ]) {
      const px = raw ? lengthPx(raw) : null;
      if (px !== null) return px;
    }
    const cls = node.getAttribute("class") ?? "";
    const fromClass =
      /(?:^|\s)(?:pl|ps|ml|ms)-\[(\d+(?:\.\d+)?)(?:px|rem|em)?\]/.exec(cls) ??
      /(?:^|\s)(?:pl|ps|ml|ms)-(\d+(?:\.\d+)?)(?=\s|$)/.exec(cls);
    if (fromClass) return Number(fromClass[1]);
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox — render y estados (CA-15, CA-18, RN-21)", () => {
  it("es un <input role=combobox> cerrado: aria-expanded=false, sin lista montada, vacío y con el placeholder por defecto", async () => {
    const { input } = await renderControlled();
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.placeholder).toBe(PLACEHOLDER);
    expect(input.value).toBe("");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("respeta un placeholder personalizado", async () => {
    const { input } = await renderControlled({ placeholder: "Elige una cuenta" });
    expect(input.placeholder).toBe("Elige una cuenta");
  });

  it("pasa aria-label (nombre accesible) e id al input", async () => {
    const { input } = await renderControlled({ "aria-label": "Cuenta, línea 1", id: "cuenta-1" });
    expect(screen.getByRole("combobox", { name: "Cuenta, línea 1" })).toBe(input);
    expect(input.id).toBe("cuenta-1");
  });

  it("aplica className en el DOM", async () => {
    const { container } = await renderControlled({ className: "mi-clase-de-prueba" });
    expect(container.querySelector(".mi-clase-de-prueba")).not.toBeNull();
  });

  it("CA-18: disabled se refleja en el input y la lista no se abre", async () => {
    const { input } = await renderControlled({ disabled: true });
    expect(input.disabled).toBe(true);
    fireEvent.click(input);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("sin disabled, el input está habilitado", async () => {
    const { input } = await renderControlled();
    expect(input.disabled).toBe(false);
  });

  it("CA-18: aria-invalid=true se refleja en el input; sin la prop (o con false) no queda marcado como inválido", async () => {
    const invalid = await renderControlled({ "aria-invalid": true });
    expect(invalid.input.getAttribute("aria-invalid")).toBe("true");
    cleanup();

    const valid = await renderControlled();
    expect(valid.input.getAttribute("aria-invalid")).not.toBe("true");
    cleanup();

    const explicitFalse = await renderControlled({ "aria-invalid": false });
    expect(explicitFalse.input.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("sin cuentas en la entrada: el campo queda deshabilitado y dice «No hay cuentas disponibles»", async () => {
    const { input } = await renderControlled({ accounts: [] });
    expect(input.disabled).toBe(true);
    expect(bodyText().includes(NO_ACCOUNTS) || input.placeholder === NO_ACCOUNTS).toBe(true);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox — texto del valor (CA-15, RN-20)", () => {
  it("value vacío → texto vacío", async () => {
    const { input } = await renderPlain("");
    expect(input.value).toBe("");
  });

  it.each([
    [ID_CAJA_P, CAJA_P],
    [ID_CAJA_C, CAJA_C],
    [ID_BANCO, BANCO],
    [ID_PROV, PROV],
  ])("CA-15: value=%s muestra «código — nombre»", async (id, label) => {
    const { input } = await renderPlain(id);
    expect(input.value).toBe(label);
  });

  it("CA-15 / RN-20: un cambio externo de value actualiza el texto (autoselección, reset del formulario)", async () => {
    const { input, setValue } = await renderPlain("");
    setValue(ID_BANCO);
    expect(input.value).toBe(BANCO);
    setValue(ID_PROV);
    expect(input.value).toBe(PROV);
    setValue("");
    expect(input.value).toBe("");
    setValue(ID_CAJA_P);
    expect(input.value).toBe(CAJA_P);
  });

  it("un cambio externo mientras la lista está abierta y hay texto tecleado también se refleja al salir", async () => {
    const { input, setValue } = await renderPlain(ID_CAJA_P);
    fireEvent.focus(input);
    typeInto(input, "banco");
    setValue(ID_PROV);
    fireEvent.blur(input);
    await waitFor(() => expect(input.value).toBe(PROV));
  });

  it("un value que no corresponde a ninguna cuenta ofrecida no rompe y deja el campo vacío", async () => {
    const { input } = await renderPlain("no-existe");
    expect(input.value).toBe("");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox — apertura y jerarquía (RN-6, CA-6)", () => {
  it.each([
    ["al enfocar", (i: HTMLElement) => fireEvent.focus(i)],
    ["al hacer clic", (i: HTMLElement) => fireEvent.click(i)],
    ["al escribir", (i: HTMLElement) => typeInto(i, "caja")],
  ])("se abre %s: aparece un listbox y aria-expanded=true", async (_name, open) => {
    const { input } = await renderControlled();
    open(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("enfocar y luego hacer clic (lo que hace un navegador al pulsar el campo) deja la lista abierta", async () => {
    const { input } = await renderControlled();
    fireEvent.focus(input);
    fireEvent.click(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("después de cerrar con Esc, un clic en el campo vuelve a abrir la lista", async () => {
    const { input } = await renderControlled();
    fireEvent.focus(input);
    press(input, "Escape");
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("CA-6: sin consulta muestra la jerarquía completa: cada título como encabezado y cada cuenta, en orden de código", async () => {
    const { input } = await renderControlled();
    fireEvent.focus(input);
    expect(optionLabels()).toEqual(ALL_OPTIONS);
    expect(visibleTitleNames()).toEqual(TITLE_NAMES);
    expectInDocumentOrder(
      headerEl("ACTIVO")!,
      headerEl("CORRIENTE")!,
      headerEl("DISPONIBLE")!,
      headerEl("CAJAS")!,
      optionEl(CAJA_P),
      optionEl(CAJA_C),
      headerEl("BANCOS")!,
      optionEl(BANCO),
      headerEl("PASIVO")!,
      headerEl("EXIGIBLE")!,
      headerEl("OBLIGACIONES")!,
      headerEl("PROVEEDORES")!,
      optionEl(PROV)
    );
  });

  it("CA-6 / RN-8: los encabezados se sangran por nivel (1 < 2 < 3 < 4 segmentos del código)", async () => {
    const { input } = await renderControlled();
    fireEvent.focus(input);
    const indents = ["ACTIVO", "CORRIENTE", "DISPONIBLE", "CAJAS"].map((n) =>
      indentOf(headerEl(n)!)
    );
    expect(
      indents.every((v) => v !== null),
      "no se pudo medir la sangría: expón data-depth (o aria-level, un estilo en línea o una clase pl-*) en el encabezado"
    ).toBe(true);
    const [l1, l2, l3, l4] = indents as number[];
    expect(l1).toBeLessThan(l2);
    expect(l2).toBeLessThan(l3);
    expect(l3).toBeLessThan(l4);
    // dos títulos del mismo nivel (CAJAS y BANCOS) tienen la misma sangría
    expect(indentOf(headerEl("BANCOS")!)).toBe(l4);
    // y un título del nivel 1 de otra rama, igual que ACTIVO
    expect(indentOf(headerEl("PASIVO")!)).toBe(l1);
  });

  it("abrir con una cuenta ya elegida no filtra por el texto mostrado: la lista sale completa", async () => {
    const { input } = await renderControlled({ initial: ID_CAJA_P });
    expect(input.value).toBe(CAJA_P);
    fireEvent.focus(input);
    expect(optionLabels()).toEqual(ALL_OPTIONS);
    expect(bodyText()).not.toContain("No hay cuentas que coincidan");
  });

  it("la lista no se monta hasta que se abre, y se desmonta al cerrarse (la grilla de asientos tiene varias filas)", async () => {
    const { input } = await renderControlled();
    expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(0);
    fireEvent.focus(input);
    expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(1);
    fireEvent.blur(input);
    await waitFor(() => expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(0));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox — filtrado al teclear (RN-1..RN-4, RN-9, CA-10)", () => {
  it("CA-10: «caja» deja Caja Principal y Caja Chica bajo la cadena de encabezados ACTIVO › CORRIENTE › DISPONIBLE › CAJAS", async () => {
    const { input } = await renderControlled();
    typeInto(input, "caja");
    expect(optionLabels()).toEqual([CAJA_P, CAJA_C]);
    expect(visibleTitleNames()).toEqual(["ACTIVO", "CORRIENTE", "DISPONIBLE", "CAJAS"]);
    expectInDocumentOrder(
      headerEl("ACTIVO")!,
      headerEl("CORRIENTE")!,
      headerEl("DISPONIBLE")!,
      headerEl("CAJAS")!,
      optionEl(CAJA_P),
      optionEl(CAJA_C)
    );
  });

  it("RN-9: los títulos sin cuentas coincidentes debajo no aparecen (BANCOS, PASIVO…)", async () => {
    const { input } = await renderControlled();
    typeInto(input, "principal");
    expect(optionLabels()).toEqual([CAJA_P]);
    for (const hidden of ["BANCOS", "PASIVO", "EXIGIBLE", "OBLIGACIONES", "PROVEEDORES"]) {
      expect(headerEl(hidden), hidden).toBeNull();
    }
  });

  it("el código sin puntos encuentra la cuenta: «110101001» deja una sola cuenta con sus 4 encabezados de contexto", async () => {
    const { input } = await renderControlled();
    typeInto(input, "110101001");
    expect(optionLabels()).toEqual([CAJA_P]);
    expect(visibleTitleNames()).toEqual(["ACTIVO", "CORRIENTE", "DISPONIBLE", "CAJAS"]);
  });

  it("el código con puntos equivale: «1.1.01.01.001»", async () => {
    const { input } = await renderControlled();
    typeInto(input, "1.1.01.01.001");
    expect(optionLabels()).toEqual([CAJA_P]);
  });

  it("«1» deja las cuentas del activo (no las del pasivo), en orden de código", async () => {
    const { input } = await renderControlled();
    typeInto(input, "1");
    expect(optionLabels()).toEqual([CAJA_P, CAJA_C, BANCO]);
    expect(headerEl("PASIVO")).toBeNull();
    expect(headerEl("ACTIVO")).not.toBeNull();
  });

  it("al ir tecleando el código, la lista se va acotando: 1 → 11 → 1101 → 110101 → 1101010 → 110101001", async () => {
    const { input } = await renderControlled();
    const counts: number[] = [];
    for (const q of ["1", "11", "1101", "110101", "1101010", "110101001"]) {
      typeInto(input, q);
      counts.push(optionLabels().length);
    }
    expect(counts).toEqual([3, 3, 3, 2, 2, 1]);
  });

  it("RN-1: «CAJÁ » (mayúsculas, tilde y espacio) da lo mismo que «caja»", async () => {
    const { input } = await renderControlled();
    typeInto(input, "CAJÁ ");
    expect(optionLabels()).toEqual([CAJA_P, CAJA_C]);
  });

  it("RN-3: varias palabras en cualquier orden — «principal caja» deja Caja Principal", async () => {
    const { input } = await renderControlled();
    typeInto(input, "principal caja");
    expect(optionLabels()).toEqual([CAJA_P]);
  });

  it("RN-10: «cajas» (nombre del título) muestra todas las cuentas de ese grupo", async () => {
    const { input } = await renderControlled();
    typeInto(input, "cajas");
    expect(optionLabels()).toEqual([CAJA_P, CAJA_C]);
    expect(headerEl("CAJAS")).not.toBeNull();
    expect(headerEl("BANCOS")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox — nombres repetidos (ADR-059: solo el código es único)", () => {
  it("muestra TODOS los encabezados y todas las cuentas aunque compartan nombre (y sin claves repetidas de React)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { input } = await renderControlled({ accounts: DUP_PLAN });
      fireEvent.focus(input);
      expect(optionLabels()).toEqual(["1.1.01.01.001 — Caja", "1.1.02.01.001 — Caja"]);
      expect(within(screen.getByRole("listbox")).getAllByText(/OTROS/)).toHaveLength(4);
      const keyWarnings = consoleError.mock.calls.filter((call) =>
        /same key|unique "key"/i.test(String(call[0]))
      );
      expect(keyWarnings).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("elegir la segunda «Caja» emite el id de ESA cuenta (no el de la primera con el mismo nombre)", async () => {
    const { input, onChange } = await renderControlled({ accounts: DUP_PLAN });
    fireEvent.focus(input);
    clickLikeBrowser(optionEl("1.1.02.01.001 — Caja"), input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("m:1.1.02.01.001");
    expect(input.value).toBe("1.1.02.01.001 — Caja");
  });

  it("una consulta por el nombre repetido trae las dos cuentas, cada una bajo su cadena de títulos", async () => {
    const { input } = await renderControlled({ accounts: DUP_PLAN });
    typeInto(input, "caja");
    expect(optionLabels()).toEqual(["1.1.01.01.001 — Caja", "1.1.02.01.001 — Caja"]);
    expect(within(screen.getByRole("listbox")).getAllByText(/OTROS/)).toHaveLength(4);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox — los títulos no se pueden elegir (CA-9, RN-8)", () => {
  it("los encabezados no son role=option: la lista ofrece solo las 4 cuentas de movimiento", async () => {
    const { input } = await renderControlled();
    fireEvent.focus(input);
    expect(screen.getAllByRole("option")).toHaveLength(MOVEMENT_IDS.length);
    for (const name of TITLE_NAMES) {
      const el = headerEl(name)!;
      expect(el, name).not.toBeNull();
      expect(el.closest('[role="option"]'), name).toBeNull();
      expect(el.getAttribute("role"), name).not.toBe("option");
    }
  });

  it.each(TITLE_NAMES)("clic sobre el encabezado «%s» no llama a onChange", async (name) => {
    const { input, onChange } = await renderControlled();
    fireEvent.focus(input);
    const el = headerEl(name)!;
    expect(el).not.toBeNull();
    pressMouse(el);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("clic sobre un encabezado de contexto (con la lista filtrada) tampoco elige nada", async () => {
    const { input, onChange } = await renderControlled();
    typeInto(input, "caja");
    for (const name of ["CAJAS", "DISPONIBLE", "ACTIVO"]) {
      const el = headerEl(name); // si la lista se cerró tras el primer clic, no hay más que pulsar
      expect(el !== null || name !== "CAJAS").toBe(true);
      if (el) pressMouse(el);
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("↓ y ↑ saltan los encabezados: de Caja Chica a Banco Mercantil (se salta BANCOS) y de Banco a Proveedores (se saltan 4)", async () => {
    const { input } = await renderControlled();
    fireEvent.focus(input);
    expect(activeLabel(input)).toBe(CAJA_P);
    press(input, "ArrowDown");
    expect(activeLabel(input)).toBe(CAJA_C);
    press(input, "ArrowDown");
    expect(activeLabel(input)).toBe(BANCO);
    press(input, "ArrowDown");
    expect(activeLabel(input)).toBe(PROV);
    press(input, "ArrowUp");
    expect(activeLabel(input)).toBe(BANCO);
    press(input, "ArrowUp");
    expect(activeLabel(input)).toBe(CAJA_C);
    press(input, "ArrowUp");
    expect(activeLabel(input)).toBe(CAJA_P);
  });

  it("recorriendo con las flechas más allá de los extremos, la opción activa es SIEMPRE una cuenta, nunca un encabezado", async () => {
    const { input, onChange } = await renderControlled();
    fireEvent.focus(input);
    for (const key of [...Array(7).fill("ArrowDown"), ...Array(9).fill("ArrowUp")]) {
      press(input, key);
      const active = activeOption(input);
      expect(active, `tras ${key}`).not.toBeNull();
      expect(active!.getAttribute("role")).toBe("option");
      expect(ALL_OPTIONS).toContain(active!.textContent?.trim());
    }
    press(input, "Enter");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(MOVEMENT_IDS).toContain(onChange.mock.calls[0][0]);
    expect(TITLE_IDS).not.toContain(onChange.mock.calls[0][0]);
  });

  it("nunca se emite el id de un título, hagas lo que hagas con el teclado y el ratón sobre ellos", async () => {
    const { input, onChange } = await renderControlled();
    fireEvent.focus(input);
    for (const name of TITLE_NAMES) {
      const el = headerEl(name); // si la lista se cerró tras un clic, no hay más que pulsar
      if (el) pressMouse(el);
    }
    press(input, "ArrowUp");
    press(input, "Tab"); // varias cuentas: no elige
    expect(onChange).not.toHaveBeenCalled();
    typeInto(input, "1.1.01"); // coincide el TÍTULO 1.1.01: sus cuentas salen, pero el título no es elegible
    press(input, "Enter");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(MOVEMENT_IDS).toContain(onChange.mock.calls[0][0]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox — opción activa y teclado (CA-5, CA-13, RN-13)", () => {
  it("al abrir, la opción activa es la primera cuenta seleccionable", async () => {
    const { input } = await renderControlled();
    fireEvent.focus(input);
    expect(activeLabel(input)).toBe(CAJA_P);
  });

  it("CA-5: si el código tecleado coincide exactamente con una cuenta, esa es la opción activa inicial y la lista NO se reordena", async () => {
    const { input } = await renderControlled({ accounts: EXACT_PLAN });
    typeInto(input, "110101002");
    expect(optionLabels()).toEqual([AJUSTE, CHICA]); // orden de código: la exacta (002) va segunda
    expect(activeLabel(input)).toBe(CHICA);
  });

  it("CA-5: Enter sobre la coincidencia exacta emite el id de esa cuenta", async () => {
    const { input, onChange } = await renderControlled({ accounts: EXACT_PLAN });
    typeInto(input, "110101002");
    press(input, "Enter");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("m:1.1.01.01.002");
  });

  it("CA-5: sin coincidencia exacta de cuenta (aunque coincida el código de un TÍTULO), la activa es la primera seleccionable", async () => {
    const { input } = await renderControlled({ accounts: EXACT_PLAN });
    typeInto(input, "110101"); // = código del título CAJAS; ninguna cuenta tiene ese código
    expect(optionLabels()).toEqual([AJUSTE, CHICA, GRANDE]);
    expect(activeLabel(input)).toBe(AJUSTE);
  });

  it("al cambiar la consulta, la opción activa vuelve a la regla inicial", async () => {
    const { input } = await renderControlled({ accounts: EXACT_PLAN });
    typeInto(input, "110101");
    press(input, "ArrowDown");
    press(input, "ArrowDown");
    expect(activeLabel(input)).toBe(GRANDE);
    typeInto(input, "110101002");
    expect(activeLabel(input)).toBe(CHICA);
    typeInto(input, "110101");
    expect(activeLabel(input)).toBe(AJUSTE);
  });

  it("CA-13: ↓ y ↑ cambian aria-activedescendant", async () => {
    const { input } = await renderControlled();
    typeInto(input, "caja");
    const first = input.getAttribute("aria-activedescendant");
    expect(first).toBeTruthy();
    press(input, "ArrowDown");
    const second = input.getAttribute("aria-activedescendant");
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    press(input, "ArrowUp");
    expect(input.getAttribute("aria-activedescendant")).toBe(first);
  });

  it("CA-13: Enter elige la opción activa: onChange(id) una vez, cierra la lista y muestra «código — nombre»", async () => {
    const { input, onChange } = await renderControlled();
    typeInto(input, "caja");
    press(input, "ArrowDown");
    expect(activeLabel(input)).toBe(CAJA_C);
    press(input, "Enter");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(ID_CAJA_C);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.value).toBe(CAJA_C);
  });

  it("CA-13: Esc cierra la lista sin emitir onChange", async () => {
    const { input, onChange } = await renderControlled();
    typeInto(input, "caja");
    expect(screen.getByRole("listbox")).toBeTruthy();
    press(input, "Escape");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("CA-13: Esc con una cuenta ya elegida no cambia el valor: al salir del campo el texto es el de esa cuenta", async () => {
    const { input, onChange } = await renderControlled({ initial: ID_CAJA_P });
    fireEvent.focus(input);
    typeInto(input, "banco");
    press(input, "Escape");
    fireEvent.blur(input);
    await waitFor(() => expect(input.value).toBe(CAJA_P));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Esc con la lista ya cerrada no hace nada (ni lanza ni emite)", async () => {
    const { input, onChange } = await renderControlled();
    expect(() => press(input, "Escape")).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("escribir (aunque el código sea exacto) NO elige nada: solo Enter/Tab/clic emiten", async () => {
    const { input, onChange } = await renderControlled();
    typeInto(input, "110101001");
    typeInto(input, "1.1.01.01.001");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Enter con la lista abierta cancela el evento (no envía el formulario que contiene al selector)", async () => {
    const Combobox = await loadCombobox();
    const onSubmit = vi.fn((e: { preventDefault(): void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Combobox aria-label="Cuenta" accounts={PLAN} value="" onChange={() => {}} />
      </form>
    );
    const input = screen.getByRole("combobox");
    typeInto(input, "caja");
    const notCanceled = fireEvent.keyDown(input, { key: "Enter" });
    expect(notCanceled).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox — un solo resultado: Enter/Tab lo eligen (CA-12, RN-14)", () => {
  it("Enter elige la única cuenta aunque haya encabezados de contexto", async () => {
    const { input, onChange } = await renderControlled();
    typeInto(input, "110101001");
    expect(visibleTitleNames().length).toBeGreaterThan(0);
    press(input, "Enter");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(ID_CAJA_P);
    expect(input.value).toBe(CAJA_P);
  });

  it("Tab elige la única cuenta aunque haya encabezados de contexto, y NO cancela el evento (el foco sigue)", async () => {
    const { input, onChange } = await renderControlled();
    typeInto(input, "210101001");
    expect(optionLabels()).toEqual([PROV]);
    expect(visibleTitleNames()).toEqual(["PASIVO", "EXIGIBLE", "OBLIGACIONES", "PROVEEDORES"]);
    const notCanceled = fireEvent.keyDown(input, { key: "Tab" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(ID_PROV);
    expect(notCanceled).toBe(true);
    expect(input.value).toBe(PROV);
  });

  it("Tab con VARIAS cuentas no elige nada y no cancela el evento", async () => {
    const { input, onChange } = await renderControlled();
    typeInto(input, "caja");
    expect(optionLabels()).toHaveLength(2);
    const notCanceled = fireEvent.keyDown(input, { key: "Tab" });
    expect(onChange).not.toHaveBeenCalled();
    expect(notCanceled).toBe(true);
  });

  it("Tab con la lista completa (sin consulta) no elige nada", async () => {
    const { input, onChange } = await renderControlled();
    fireEvent.focus(input);
    press(input, "Tab");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Tab con la lista cerrada no emite nada", async () => {
    const { input, onChange } = await renderControlled();
    press(input, "Tab");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Tab sin resultados no elige nada", async () => {
    const { input, onChange } = await renderControlled();
    typeInto(input, "zzz");
    press(input, "Tab");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Enter sin resultados no emite nada", async () => {
    const { input, onChange } = await renderControlled();
    typeInto(input, "zzz");
    press(input, "Enter");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("CA-12: el contador anuncia solo cuentas de movimiento: 4 sin consulta, 2 con «caja», 1 con el código", async () => {
    const { input } = await renderControlled();
    fireEvent.focus(input);
    expect(announcedCount()).toBe(ALL_OPTIONS.length);
    typeInto(input, "caja");
    expect(announcedCount()).toBe(2); // y hay 6 filas: 4 encabezados + 2 cuentas
    typeInto(input, "110101001");
    expect(announcedCount()).toBe(1); // y hay 5 filas
  });

  it("la región aria-live es polite", async () => {
    const { input } = await renderControlled();
    fireEvent.focus(input);
    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox — sin resultados (CA-8, RN-16)", () => {
  it("muestra «No hay cuentas que coincidan con «zzz»» y ninguna opción ni encabezado", async () => {
    const { input } = await renderControlled();
    typeInto(input, "zzz");
    expect(bodyText()).toContain("No hay cuentas que coincidan con «zzz»");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(visibleTitleNames()).toEqual([]);
  });

  it("el mensaje aparece solo cuando no hay coincidencias", async () => {
    const { input } = await renderControlled();
    typeInto(input, "caja");
    expect(bodyText()).not.toContain("No hay cuentas que coincidan");
    typeInto(input, "caja banco");
    expect(bodyText()).toContain("No hay cuentas que coincidan con «caja banco»");
    typeInto(input, "banco");
    expect(bodyText()).not.toContain("No hay cuentas que coincidan");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox — tope de 100 cuentas (RN-7, CA-7)", () => {
  const countOptions = () => document.querySelectorAll('[role="option"]').length;

  it("más de 100 coincidencias: se muestran 100 y el aviso «Mostrando las primeras 100. Escribe más para afinar.»", async () => {
    const { input } = await renderControlled({ accounts: manyAccounts(130) });
    typeInto(input, "cuenta");
    expect(countOptions()).toBe(100);
    expect(bodyText()).toContain(CAP_NOTICE);
    expect(announcedCount()).toBe(100);
  });

  it("se muestran las PRIMERAS 100 en orden de código", async () => {
    const { input } = await renderControlled({ accounts: manyAccounts(130) });
    typeInto(input, "cuenta");
    const labels = optionLabels();
    expect(labels[0]).toBe("1.1.01.01.001 — Cuenta 01-001");
    expect(labels.at(-1)).toBe("1.1.01.01.100 — Cuenta 01-100");
  });

  it("exactamente 100 coincidencias: se muestran las 100 y NO hay aviso", async () => {
    const { input } = await renderControlled({ accounts: manyAccounts(100) });
    typeInto(input, "cuenta");
    expect(countOptions()).toBe(100);
    expect(bodyText()).not.toContain(CAP_NOTICE);
  });

  it("menos de 100: sin aviso", async () => {
    const { input } = await renderControlled({ accounts: manyAccounts(40) });
    typeInto(input, "cuenta");
    expect(countOptions()).toBe(40);
    expect(bodyText()).not.toContain(CAP_NOTICE);
  });

  it("los encabezados no cuentan para el tope: 100 cuentas repartidas en 25 grupos se muestran completas y sin aviso", async () => {
    const { input } = await renderControlled({ accounts: manyAccounts(100, 25) });
    typeInto(input, "cuenta");
    expect(countOptions()).toBe(100);
    expect(bodyText()).not.toContain(CAP_NOTICE);
    expect(bodyText()).toContain("GRUPO 25"); // 100 cuentas + 25 grupos + 3 títulos = 128 filas
  });

  it("el aviso desaparece al afinar la consulta", async () => {
    const { input } = await renderControlled({ accounts: manyAccounts(130) });
    typeInto(input, "cuenta");
    expect(bodyText()).toContain(CAP_NOTICE);
    typeInto(input, "cuenta 01-125");
    expect(bodyText()).not.toContain(CAP_NOTICE);
    expect(optionLabels()).toEqual(["1.1.01.01.125 — Cuenta 01-125"]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox — elegir con el ratón (RN-17)", () => {
  it("clic en una opción (como lo hace un navegador: el foco sale del input antes del click) emite onChange(id), cierra y muestra el texto", async () => {
    const { input, onChange } = await renderControlled();
    fireEvent.focus(input);
    clickLikeBrowser(optionEl(BANCO), input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(ID_BANCO);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.value).toBe(BANCO);
  });

  it("clic en una opción de una lista filtrada", async () => {
    const { input, onChange } = await renderControlled();
    typeInto(input, "caja");
    clickLikeBrowser(optionEl(CAJA_C), input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(ID_CAJA_C);
    expect(input.value).toBe(CAJA_C);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox — salir del campo (CA-14, RN-15)", () => {
  it("CA-14: con una cuenta elegida, teclear algo y salir sin elegir restaura «código — nombre» y cierra la lista", async () => {
    const { input, onChange } = await renderControlled({ initial: ID_CAJA_P });
    fireEvent.focus(input);
    typeInto(input, "banco");
    expect(input.value).toBe("banco");
    fireEvent.blur(input);
    await waitFor(() => expect(input.value).toBe(CAJA_P));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("CA-14: sin cuenta elegida, el texto libre se borra al salir (queda vacío)", async () => {
    const { input, onChange } = await renderControlled();
    fireEvent.focus(input);
    typeInto(input, "texto que no es una cuenta");
    fireEvent.blur(input);
    await waitFor(() => expect(input.value).toBe(""));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("salir del campo con una consulta que SÍ tiene una única coincidencia no la elige (solo Enter/Tab lo hacen)", async () => {
    const { input, onChange } = await renderControlled();
    fireEvent.focus(input);
    typeInto(input, "110101001");
    fireEvent.blur(input);
    await waitFor(() => expect(input.value).toBe(""));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("salir sin haber tecleado deja el texto de la cuenta elegida como estaba", async () => {
    const { input, onChange } = await renderControlled({ initial: ID_PROV });
    fireEvent.focus(input);
    fireEvent.blur(input);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(input.value).toBe(PROV);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("después de elegir una cuenta, salir deja la cuenta nueva (no la anterior)", async () => {
    const { input } = await renderControlled({ initial: ID_CAJA_P });
    fireEvent.focus(input);
    typeInto(input, "banco");
    press(input, "Enter");
    fireEvent.blur(input);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(input.value).toBe(BANCO);
  });

  it("se puede volver a abrir y elegir otra cuenta después de haber elegido una", async () => {
    const { input, onChange } = await renderControlled();
    typeInto(input, "110101001");
    press(input, "Enter");
    fireEvent.focus(input);
    typeInto(input, "210101001");
    press(input, "Enter");
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([ID_CAJA_P, ID_PROV]);
    expect(input.value).toBe(PROV);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox — foco y varias instancias (grilla de asientos)", () => {
  it("el foco no se pierde al elegir con Enter", async () => {
    const { input } = await renderControlled();
    act(() => input.focus());
    expect(document.activeElement).toBe(input);
    typeInto(input, "110101001");
    press(input, "Enter");
    expect(document.activeElement).toBe(input);
  });

  it("el foco no se pierde al cerrar con Esc", async () => {
    const { input } = await renderControlled();
    act(() => input.focus());
    typeInto(input, "caja");
    press(input, "Escape");
    expect(document.activeElement).toBe(input);
  });

  it("dos selectores en la misma pantalla: solo monta lista el abierto, y los ids de lista y de opciones no se repiten", async () => {
    const Combobox = await loadCombobox();
    render(
      <>
        <Combobox aria-label="Cuenta, línea 1" accounts={PLAN} value="" onChange={() => {}} />
        <Combobox aria-label="Cuenta, línea 2" accounts={PLAN} value="" onChange={() => {}} />
      </>
    );
    const [first, second] = screen.getAllByRole("combobox") as HTMLInputElement[];
    expect(screen.queryAllByRole("listbox")).toHaveLength(0);

    fireEvent.focus(first);
    expect(screen.getAllByRole("listbox")).toHaveLength(1);

    fireEvent.focus(second); // fireEvent no mueve el foco: las dos quedan abiertas a la vez
    const lists = screen.getAllByRole("listbox");
    expect(lists).toHaveLength(2);
    const listIds = lists.map((l) => l.id);
    expect(listIds.every(Boolean)).toBe(true);
    expect(new Set(listIds).size).toBe(2);
    expect(first.getAttribute("aria-controls")).toBe(lists[0].id);
    expect(second.getAttribute("aria-controls")).toBe(lists[1].id);

    const optionIds = [...document.querySelectorAll('[role="option"]')].map((o) => o.id);
    expect(optionIds.every(Boolean)).toBe(true);
    expect(new Set(optionIds).size).toBe(optionIds.length);
  });

  it("dos selectores son independientes: elegir en uno no cambia el texto del otro", async () => {
    const Combobox = await loadCombobox();
    function Pair() {
      const [a, setA] = useState("");
      const [b, setB] = useState("");
      return (
        <>
          <Combobox aria-label="Cuenta, línea 1" accounts={PLAN} value={a} onChange={setA} />
          <Combobox aria-label="Cuenta, línea 2" accounts={PLAN} value={b} onChange={setB} />
        </>
      );
    }
    render(<Pair />);
    const [first, second] = screen.getAllByRole("combobox") as HTMLInputElement[];
    typeInto(first, "110101001");
    press(first, "Enter");
    typeInto(second, "210101001");
    press(second, "Enter");
    expect(first.value).toBe(CAJA_P);
    expect(second.value).toBe(PROV);
  });
});
