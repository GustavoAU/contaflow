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
import { isAccountComboboxOpen } from "./AccountCombobox";

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
  /** B1 · D2: botón «Quitar la cuenta» que llama onChange("") (campos opcionales). */
  clearable?: boolean;
  /** B1: las cuentas aún se están cargando (acción cliente): campo deshabilitado «Cargando cuentas…». */
  loading?: boolean;
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
describe("AccountCombobox — límite de la consulta (auditoría de seguridad, LOW-2)", () => {
  it("el campo limita el largo de lo que se puede teclear o pegar", async () => {
    const { input } = await renderControlled();
    expect(input.maxLength).toBe(64);
  });
});

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

// <<B1-BLOCK-START>>
// ═════════════════════════════════════════════════════════════════════════════════════════════════
// SPEC-012 · ENTREGA B1 · PASO 0 (modo RED) — extensión de AccountCombobox
//
// TDD SPEC — contrato ejecutable para el ui-agent. Lo que sigue FALLA hasta que el combobox cumpla:
//   D1  `value` que no es una cuenta de movimiento presente en `accounts` (título, id inexistente):
//       texto VACÍO, no se muestra como elegida y, si `value !== ""`, el input lleva
//       `aria-invalid="true"` aunque no se pase la prop; NUNCA llama a onChange por ese motivo.
//   D2  prop `clearable`: con valor (también huérfano) y sin `disabled`, un botón «Quitar la cuenta»
//       que llama onChange("") (mousedown con preventDefault; alcanzable con Tab).
//   D3  el input expone `data-state="open|closed"` y el módulo exporta
//       `isAccountComboboxOpen(target)` → true solo para un <input role="combobox"> con
//       `data-state="open"` (lo usa `onEscapeKeyDown` del AlertDialog de Radix).

type B1ComboboxModule = { isAccountComboboxOpen(target: EventTarget | null): boolean };

// GREEN (paso 2): import estático normal — `tsc` verifica que la firma real cumple B1ComboboxModule.
function isOpenFn(): B1ComboboxModule["isAccountComboboxOpen"] {
  return isAccountComboboxOpen;
}

const TITLE_CAJAS_ID = "t:1.1.01.01";
const TITLE_ACTIVO_ID = "t:1";
const CLEAR_NAME = "Quitar la cuenta";
const clearButton = () => screen.queryByRole("button", { name: CLEAR_NAME });
const dataState = (el: HTMLElement) => el.getAttribute("data-state");
const flush = () => act(async () => {});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox B1 · D1 — value huérfano (título o id inexistente)", () => {
  it.each([
    ["un título de 4 niveles (CAJAS)", TITLE_CAJAS_ID],
    ["un título de nivel 1 (ACTIVO)", TITLE_ACTIVO_ID],
    ["un id que no está en `accounts`", "no-existe"],
  ])(
    "value = %s → texto vacío y aria-invalid=true aunque la prop no se pase",
    async (_name, value) => {
      const { input } = await renderPlain(value);
      expect(input.value).toBe("");
      expect(input.getAttribute("aria-invalid")).toBe("true");
    }
  );

  it("el título huérfano NO se muestra como elegido: ni el código ni el nombre aparecen en el campo", async () => {
    const { input } = await renderPlain(TITLE_CAJAS_ID);
    expect(input.value).not.toContain("CAJAS");
    expect(input.value).not.toContain("1.1.01.01");
  });

  it("value = «» (sin selección, el caso normal) NO se marca como inválido", async () => {
    const { input } = await renderPlain("");
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("value = cuenta de movimiento válida: muestra «código — nombre» y NO es inválido", async () => {
    const { input } = await renderPlain(ID_CAJA_P);
    expect(input.value).toBe(CAJA_P);
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("la prop aria-invalid=true sigue funcionando con un valor válido", async () => {
    const { input } = await renderControlled({ initial: ID_CAJA_P, "aria-invalid": true });
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("sin cuentas en `accounts` y un value no vacío: inválido y vacío (no hay nada que mostrar)", async () => {
    const { input } = await renderPlain("m:fantasma", []);
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("NUNCA llama a onChange por ese motivo: ni al montar, ni al enfocar, ni al salir del campo", async () => {
    const { input, onChange } = await renderPlain(TITLE_CAJAS_ID);
    await flush();
    fireEvent.focus(input);
    await flush();
    fireEvent.blur(input);
    await flush();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("tampoco con un id inexistente ni al cambiar entre valores huérfanos", async () => {
    const { input, onChange, setValue } = await renderPlain("no-existe");
    await flush();
    setValue(TITLE_ACTIVO_ID);
    await flush();
    setValue("otro-que-no-existe");
    await flush();
    fireEvent.focus(input);
    fireEvent.blur(input);
    await flush();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("al abrir la lista con un título huérfano, el título sigue siendo un encabezado (no una opción) y el campo sigue vacío", async () => {
    const { input, onChange } = await renderPlain(TITLE_CAJAS_ID);
    fireEvent.focus(input);
    expect(screen.getAllByRole("option")).toHaveLength(MOVEMENT_IDS.length);
    expect(headerEl("CAJAS")?.closest('[role="option"]') ?? null).toBeNull();
    expect(input.value).toBe("");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("transiciones por cambio externo: válido → título (vacío + inválido) → válido (texto + válido) → «» (vacío + válido)", async () => {
    const { input, setValue } = await renderPlain(ID_CAJA_P);
    expect(input.value).toBe(CAJA_P);
    expect(input.getAttribute("aria-invalid")).not.toBe("true");

    setValue(TITLE_CAJAS_ID);
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-invalid")).toBe("true");

    setValue(ID_BANCO);
    expect(input.value).toBe(BANCO);
    expect(input.getAttribute("aria-invalid")).not.toBe("true");

    setValue("");
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("salir del campo con un título huérfano restaura el texto VACÍO (no el nombre del título) y sigue inválido", async () => {
    const { input } = await renderPlain(TITLE_CAJAS_ID);
    fireEvent.focus(input);
    typeInto(input, "banco");
    fireEvent.blur(input);
    await waitFor(() => expect(input.value).toBe(""));
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("elegir una cuenta válida desde un valor huérfano emite onChange(id) una vez y deja de ser inválido", async () => {
    const { input, onChange } = await renderControlled({ initial: TITLE_CAJAS_ID });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.focus(input);
    clickLikeBrowser(optionEl(CAJA_C), input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(ID_CAJA_C);
    expect(input.value).toBe(CAJA_C);
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox B1 · D2 — prop `clearable` (campos opcionales)", () => {
  it("con clearable y una cuenta elegida aparece un botón «Quitar la cuenta»", async () => {
    await renderControlled({ initial: ID_CAJA_P, clearable: true });
    const button = screen.getByRole("button", { name: CLEAR_NAME });
    expect(button.tagName === "BUTTON" || button.getAttribute("role") === "button").toBe(true);
  });

  it("clic en el botón llama onChange(«») exactamente una vez", async () => {
    const { onChange } = await renderControlled({ initial: ID_CAJA_P, clearable: true });
    fireEvent.click(screen.getByRole("button", { name: CLEAR_NAME }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("al vaciar, el campo queda sin texto y el botón desaparece (ya no hay nada que quitar)", async () => {
    const { input } = await renderControlled({ initial: ID_BANCO, clearable: true });
    expect(input.value).toBe(BANCO);
    fireEvent.click(screen.getByRole("button", { name: CLEAR_NAME }));
    expect(input.value).toBe("");
    expect(clearButton()).toBeNull();
  });

  it("sin la prop clearable NO hay botón, aunque haya una cuenta elegida", async () => {
    await renderControlled({ initial: ID_CAJA_P });
    expect(clearButton()).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("con clearable pero SIN valor no hay botón", async () => {
    await renderControlled({ initial: "", clearable: true });
    expect(clearButton()).toBeNull();
  });

  it("con clearable y `disabled` no hay botón, aunque haya valor", async () => {
    await renderControlled({ initial: ID_CAJA_P, clearable: true, disabled: true });
    expect(clearButton()).toBeNull();
  });

  it.each([
    ["un título", TITLE_CAJAS_ID],
    ["un id que no existe", "no-existe"],
  ])(
    "con un valor huérfano (%s) el botón SÍ aparece: es la única forma de limpiar una configuración vieja",
    async (_name, value) => {
      const { onChange, input } = await renderControlled({ initial: value, clearable: true });
      expect(input.value).toBe("");
      fireEvent.click(screen.getByRole("button", { name: CLEAR_NAME }));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("");
      expect(clearButton()).toBeNull();
    }
  );

  it("mousedown se cancela (preventDefault): pulsarlo no le quita el foco al campo", async () => {
    await renderControlled({ initial: ID_CAJA_P, clearable: true });
    const notCanceled = fireEvent.mouseDown(screen.getByRole("button", { name: CLEAR_NAME }));
    expect(notCanceled).toBe(false);
  });

  it("un clic «como lo hace el navegador» (blur solo si mousedown NO se cancela) también vacía una sola vez", async () => {
    const { input, onChange } = await renderControlled({ initial: ID_CAJA_P, clearable: true });
    clickLikeBrowser(screen.getByRole("button", { name: CLEAR_NAME }), input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("es alcanzable con Tab: no lleva tabindex=-1", async () => {
    await renderControlled({ initial: ID_CAJA_P, clearable: true });
    const button = screen.getByRole("button", { name: CLEAR_NAME });
    expect(button.getAttribute("tabindex")).not.toBe("-1");
    expect(button.tabIndex).toBeGreaterThanOrEqual(0);
  });

  it("no cambia el patrón del combobox: sigue habiendo UN solo role=combobox y el botón no es una opción", async () => {
    const { input } = await renderControlled({ initial: ID_CAJA_P, clearable: true });
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    fireEvent.focus(input);
    const button = screen.getByRole("button", { name: CLEAR_NAME });
    expect(button.closest('[role="listbox"]')).toBeNull();
    expect(button.getAttribute("role")).not.toBe("option");
    expect(screen.getAllByRole("option")).toHaveLength(MOVEMENT_IDS.length);
  });

  it("con la lista abierta y texto tecleado, el botón sigue vaciando el valor elegido", async () => {
    const { input, onChange } = await renderControlled({ initial: ID_CAJA_P, clearable: true });
    fireEvent.focus(input);
    typeInto(input, "banco");
    fireEvent.click(screen.getByRole("button", { name: CLEAR_NAME }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("vaciar el TEXTO y salir NO limpia (RN-15): el botón es la única vía; el valor se restaura sin onChange", async () => {
    const { input, onChange } = await renderControlled({ initial: ID_CAJA_P, clearable: true });
    fireEvent.focus(input);
    typeInto(input, "");
    fireEvent.blur(input);
    await waitFor(() => expect(input.value).toBe(CAJA_P));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("elegir otra cuenta con el botón presente no lo hace desaparecer y emite el id (no «»)", async () => {
    const { input, onChange } = await renderControlled({ initial: ID_CAJA_P, clearable: true });
    fireEvent.focus(input);
    clickLikeBrowser(optionEl(BANCO), input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(ID_BANCO);
    expect(clearButton()).not.toBeNull();
  });

  it("dos selectores clearable en la misma pantalla: cada botón vacía SOLO el suyo", async () => {
    const Combobox = await loadCombobox();
    const onA = vi.fn();
    const onB = vi.fn();
    render(
      <>
        <Combobox
          aria-label="Cuenta A"
          accounts={PLAN}
          value={ID_CAJA_P}
          onChange={onA}
          clearable
        />
        <Combobox aria-label="Cuenta B" accounts={PLAN} value={ID_BANCO} onChange={onB} clearable />
      </>
    );
    const buttons = screen.getAllByRole("button", { name: CLEAR_NAME });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(onB).toHaveBeenCalledWith("");
    expect(onA).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox B1 · D3 — data-state e isAccountComboboxOpen (Esc dentro de un AlertDialog)", () => {
  it("cerrado: data-state=closed (el atributo existe desde el inicio)", async () => {
    const { input } = await renderControlled();
    expect(dataState(input)).toBe("closed");
  });

  it.each([
    ["al enfocar", (i: HTMLElement) => fireEvent.focus(i)],
    ["al hacer clic", (i: HTMLElement) => fireEvent.click(i)],
    ["al escribir", (i: HTMLElement) => typeInto(i, "caja")],
    ["con ↓", (i: HTMLElement) => press(i, "ArrowDown")],
  ])("%s → data-state=open", async (_name, open) => {
    const { input } = await renderControlled();
    open(input);
    expect(dataState(input)).toBe("open");
  });

  it("Esc con la lista abierta → data-state=closed", async () => {
    const { input } = await renderControlled();
    fireEvent.focus(input);
    expect(dataState(input)).toBe("open");
    press(input, "Escape");
    expect(dataState(input)).toBe("closed");
  });

  it("salir del campo → data-state=closed", async () => {
    const { input } = await renderControlled();
    fireEvent.focus(input);
    fireEvent.blur(input);
    await waitFor(() => expect(dataState(input)).toBe("closed"));
  });

  it("elegir una cuenta con Enter o con clic → data-state=closed", async () => {
    const { input } = await renderControlled();
    typeInto(input, "110101001");
    press(input, "Enter");
    expect(dataState(input)).toBe("closed");

    fireEvent.focus(input);
    clickLikeBrowser(optionEl(BANCO), input);
    expect(dataState(input)).toBe("closed");
  });

  it("con el aviso «No hay cuentas que coincidan» visible el estado sigue siendo open (aunque aria-expanded sea false)", async () => {
    const { input } = await renderControlled();
    typeInto(input, "zzz");
    expect(bodyText()).toContain("No hay cuentas que coincidan");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(dataState(input)).toBe("open");
    press(input, "Escape");
    expect(dataState(input)).toBe("closed");
  });

  it("disabled: ni el clic ni el foco lo abren → data-state=closed", async () => {
    const { input } = await renderControlled({ disabled: true });
    fireEvent.focus(input);
    fireEvent.click(input);
    expect(dataState(input)).toBe("closed");
  });

  it("sin cuentas, o con solo títulos (campo deshabilitado por dentro) → data-state=closed", async () => {
    const empty = await renderControlled({ accounts: [] });
    fireEvent.focus(empty.input);
    expect(dataState(empty.input)).toBe("closed");
    cleanup();

    const titles = await renderControlled({ accounts: PLAN.filter((a) => !a.isPostable) });
    fireEvent.focus(titles.input);
    fireEvent.click(titles.input);
    expect(dataState(titles.input)).toBe("closed");
  });
});

describe("AccountCombobox B1 · D3 — isAccountComboboxOpen: ¿el evento viene de un AccountCombobox con la lista abierta?", () => {
  const make = (tag: string, attrs: Record<string, string>) => {
    const el = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    return el;
  };

  it("true solo para <input role=combobox data-state=open>", () => {
    const isOpen = isOpenFn();
    expect(isOpen(make("input", { role: "combobox", "data-state": "open" }))).toBe(true);
  });

  it("false con data-state=closed o sin data-state", () => {
    const isOpen = isOpenFn();
    expect(isOpen(make("input", { role: "combobox", "data-state": "closed" }))).toBe(false);
    expect(isOpen(make("input", { role: "combobox" }))).toBe(false);
    expect(isOpen(make("input", { role: "combobox", "aria-expanded": "true" }))).toBe(false);
  });

  it("false si no es un <input> (el disparador de Radix Select también es role=combobox y tiene data-state=open)", () => {
    const isOpen = isOpenFn();
    expect(isOpen(make("button", { role: "combobox", "data-state": "open" }))).toBe(false);
    expect(isOpen(make("div", { role: "combobox", "data-state": "open" }))).toBe(false);
    expect(isOpen(make("select", { role: "combobox", "data-state": "open" }))).toBe(false);
  });

  it("false si es un <input> sin role=combobox", () => {
    const isOpen = isOpenFn();
    expect(isOpen(make("input", { "data-state": "open" }))).toBe(false);
    expect(isOpen(make("input", { role: "textbox", "data-state": "open" }))).toBe(false);
  });

  it("false para null y para destinos que no son elementos (document, window, nodo de texto)", () => {
    const isOpen = isOpenFn();
    expect(isOpen(null)).toBe(false);
    expect(isOpen(document)).toBe(false);
    expect(isOpen(window)).toBe(false);
    expect(isOpen(document.createTextNode("texto"))).toBe(false);
    expect(isOpen(document.body)).toBe(false);
  });

  it("sobre un AccountCombobox real: false cerrado, true abierto, false tras Esc", async () => {
    const isOpen = isOpenFn();
    const { input } = await renderControlled();
    expect(isOpen(input)).toBe(false);
    fireEvent.focus(input);
    expect(isOpen(input)).toBe(true);
    press(input, "Escape");
    expect(isOpen(input)).toBe(false);
  });

  it("sobre un AccountCombobox real con el aviso de «sin coincidencias» visible también es true", async () => {
    const isOpen = isOpenFn();
    const { input } = await renderControlled();
    typeInto(input, "zzz");
    expect(isOpen(input)).toBe(true);
  });

  it("con dos selectores, solo el que tiene la lista abierta da true", async () => {
    const isOpen = isOpenFn();
    const Combobox = await loadCombobox();
    render(
      <>
        <Combobox aria-label="Cuenta A" accounts={PLAN} value="" onChange={() => {}} />
        <Combobox aria-label="Cuenta B" accounts={PLAN} value="" onChange={() => {}} />
      </>
    );
    const [a, b] = screen.getAllByRole("combobox");
    fireEvent.focus(b);
    expect(isOpen(a)).toBe(false);
    expect(isOpen(b)).toBe(true);
  });
});

describe("AccountCombobox — cargando las cuentas (loading)", () => {
  it("con `loading` el campo está deshabilitado, ocupado y dice «Cargando cuentas…» (no «No hay cuentas disponibles»)", async () => {
    const { input } = await renderControlled({ loading: true, accounts: [] });
    expect(input.disabled).toBe(true);
    expect(input.getAttribute("aria-busy")).toBe("true");
    expect(input.placeholder).toBe("Cargando cuentas…");
    expect(screen.queryByText(NO_ACCOUNTS)).toBeNull();
  });

  it("con `loading` no abre la lista aunque ya haya cuentas (se está revalidando)", async () => {
    const { input } = await renderControlled({ loading: true });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "caja" } });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("sin `loading` no hay aria-busy y, con cuentas, el campo está habilitado", async () => {
    const { input } = await renderControlled();
    expect(input.disabled).toBe(false);
    expect(input.getAttribute("aria-busy")).toBeNull();
    expect(input.placeholder).toBe(PLACEHOLDER);
  });

  it("al terminar la carga (loading pasa a false) con cuentas el campo se habilita", async () => {
    const Combobox = await loadCombobox();
    const ui = (loading: boolean) => (
      <Combobox
        aria-label="Cuenta"
        accounts={PLAN}
        value=""
        onChange={() => {}}
        loading={loading}
      />
    );
    const { rerender } = render(ui(true));
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    rerender(ui(false));
    expect(input.disabled).toBe(false);
    expect(input.getAttribute("aria-busy")).toBeNull();
  });

  it("al terminar la carga SIN cuentas de movimiento vuelve «No hay cuentas disponibles»", async () => {
    const Combobox = await loadCombobox();
    const ui = (loading: boolean) => (
      <Combobox aria-label="Cuenta" accounts={[]} value="" onChange={() => {}} loading={loading} />
    );
    const { rerender } = render(ui(true));
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.placeholder).toBe("Cargando cuentas…");
    rerender(ui(false));
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe(NO_ACCOUNTS);
  });
});
