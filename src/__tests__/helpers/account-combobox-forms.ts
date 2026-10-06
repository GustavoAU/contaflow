// src/__tests__/helpers/account-combobox-forms.ts
//
// SPEC-012 (Entrega B1) — utilidades COMPARTIDAS por los tests de los formularios que migran del
// <select> nativo a `AccountCombobox`. Es un helper de TEST, no de producción.
//
// Se escribe contra ROLES, nombres accesibles y texto visible (como los tests de la Entrega A): nada
// de clases ni de detalles internos del combobox. Lo que el contrato NO fija (el texto exacto del
// error de «sin cuenta», el `aria-label` de cada instancia) se comprueba de forma tolerante y cada
// una de esas holguras está declarada en el comentario de la función.

import { fireEvent, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import type { Mock } from "vitest";

// ─── Plan de cuentas de los fixtures ─────────────────────────────────────────────────────────────

export type PlanAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  isPostable: boolean;
};

/** Título (encabezado, `isPostable = false`). El id lleva el prefijo `t:` para reconocerlo en un payload. */
export const titleAcc = (code: string, name: string, type: string): PlanAccount => ({
  id: `t:${code}`,
  code,
  name,
  type,
  isPostable: false,
});

/** Cuenta de movimiento (`isPostable = true`). El id lleva el prefijo `m:`. */
export const moveAcc = (code: string, name: string, type: string): PlanAccount => ({
  id: `m:${code}`,
  code,
  name,
  type,
  isPostable: true,
});

/** «código — nombre»: lo que muestra el combobox para una cuenta de movimiento (RN-12). */
export const labelOf = (a: Pick<PlanAccount, "code" | "name">) => `${a.code} — ${a.name}`;

/**
 * Plan con títulos de 1 a 4 niveles y cuentas de movimiento de TODOS los tipos. Los nombres de los
 * títulos van en MAYÚSCULAS y no se repiten con los de las cuentas (el helper `headerEl` los busca
 * por nombre, distinguiendo mayúsculas).
 */
export const PLAN: readonly PlanAccount[] = [
  titleAcc("1", "ACTIVO", "ASSET"),
  titleAcc("1.1", "CORRIENTE", "ASSET"),
  titleAcc("1.1.01", "DISPONIBLE", "ASSET"),
  titleAcc("1.1.01.01", "CAJAS", "ASSET"),
  moveAcc("1.1.01.01.001", "Caja Principal", "ASSET"),
  moveAcc("1.1.01.01.002", "Caja Chica", "ASSET"),
  titleAcc("1.1.01.02", "BANCOS", "ASSET"),
  moveAcc("1.1.01.02.001", "Banco Mercantil", "ASSET"),
  titleAcc("2", "PASIVO", "LIABILITY"),
  titleAcc("2.1", "EXIGIBLE", "LIABILITY"),
  titleAcc("2.1.01", "OBLIGACIONES", "LIABILITY"),
  titleAcc("2.1.01.01", "RETENCIONES", "LIABILITY"),
  moveAcc("2.1.01.01.001", "Retenciones por Pagar", "LIABILITY"),
  titleAcc("3", "PATRIMONIO", "EQUITY"),
  titleAcc("3.1", "CAPITALES", "EQUITY"),
  titleAcc("3.1.01", "APORTES", "EQUITY"),
  titleAcc("3.1.01.01", "CAPITAL", "EQUITY"),
  moveAcc("3.1.01.01.001", "Capital Social", "EQUITY"),
  moveAcc("3.1.01.01.002", "Reserva Legal", "EQUITY"),
  titleAcc("4", "INGRESOS", "REVENUE"),
  titleAcc("4.1", "OPERATIVOS", "REVENUE"),
  titleAcc("4.1.01", "VENTAS", "REVENUE"),
  titleAcc("4.1.01.01", "PRODUCTOS", "REVENUE"),
  moveAcc("4.1.01.01.001", "Ventas Gravadas", "REVENUE"),
  titleAcc("5", "GASTOS", "EXPENSE"),
  titleAcc("5.1", "ADMINISTRATIVOS", "EXPENSE"),
  titleAcc("5.1.01", "GENERALES", "EXPENSE"),
  titleAcc("5.1.01.01", "OFICINA", "EXPENSE"),
  moveAcc("5.1.01.01.001", "Papelería y Útiles", "EXPENSE"),
  moveAcc("5.1.01.01.002", "Gastos de Viaje", "EXPENSE"),
];

export const TITLES = PLAN.filter((a) => !a.isPostable);
export const MOVEMENTS = PLAN.filter((a) => a.isPostable);
export const TITLE_IDS = TITLES.map((a) => a.id);
export const ALL_TITLE_NAMES = TITLES.map((a) => a.name);

export const ofType = (accounts: readonly PlanAccount[], ...types: string[]) =>
  accounts.filter((a) => types.includes(a.type));

/** Las etiquetas de las cuentas de movimiento de `accounts`, en el orden recibido. */
export const movementLabels = (accounts: readonly PlanAccount[]) =>
  accounts.filter((a) => a.isPostable).map(labelOf);

// ─── jsdom ───────────────────────────────────────────────────────────────────────────────────────

/** Llamar desde `beforeAll`: jsdom no implementa lo que usan el listbox y los diálogos de Radix. */
export function stubJsdomForListbox() {
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
}

// ─── Localizar los controles ─────────────────────────────────────────────────────────────────────

/**
 * Los `<input role="combobox">` de la pantalla (los `AccountCombobox`). Los `<select>` nativos y los
 * disparadores de Radix Select también son `combobox` pero NO son `<input>`; por eso se filtra por tag.
 */
export function accountComboboxes(): HTMLInputElement[] {
  return screen
    .queryAllByRole("combobox")
    .filter((el): el is HTMLInputElement => el.tagName === "INPUT");
}

/** Falla con un mensaje claro si el formulario no usa N `AccountCombobox` (hoy usa `<select>` nativo). */
export function expectAccountComboboxes(expected: number, where: string): HTMLInputElement[] {
  const inputs = accountComboboxes();
  if (inputs.length !== expected) {
    throw new Error(
      `${where}: se esperaban ${expected} <input role="combobox"> (AccountCombobox) y hay ${inputs.length}` +
        ` (¿sigue siendo un <select> nativo?)`
    );
  }
  return inputs;
}

/** Nombres accesibles (calculados, no solo `aria-label`) de los `AccountCombobox` en pantalla. */
export function accessibleNames(): string[] {
  const names: string[] = [];
  screen.queryAllByRole("combobox", {
    name: (accessibleName, element) => {
      if (element.tagName === "INPUT") names.push(accessibleName);
      return true;
    },
  });
  return names;
}

// ─── Interacción ─────────────────────────────────────────────────────────────────────────────────

export const typeInto = (input: HTMLElement, text: string) =>
  fireEvent.change(input, { target: { value: text } });
export const press = (input: HTMLElement, key: string) => fireEvent.keyDown(input, { key });

/** Eventos de ratón sobre un elemento que NO es una opción (un encabezado): ninguno debe elegir nada. */
export function pressMouse(el: Element) {
  fireEvent.mouseDown(el);
  fireEvent.mouseUp(el);
  fireEvent.click(el);
}

/** Abre la lista como lo hace el usuario: enfoca y hace clic en el campo. */
export function openList(input: HTMLElement) {
  fireEvent.focus(input);
  fireEvent.click(input);
}

/** Elige una cuenta como el contador: teclea su código (con o sin puntos) y pulsa Enter. */
export function pickByCode(input: HTMLElement, code: string) {
  fireEvent.focus(input);
  typeInto(input, code);
  press(input, "Enter");
}

const listboxes = () => screen.queryAllByRole("listbox");

/** Textos de las OPCIONES de la lista abierta (no los `<option>` de un `<select>` nativo vecino). */
export function listedOptionLabels(): string[] {
  const lists = listboxes();
  if (lists.length === 0) return [];
  return within(lists[0])
    .queryAllByRole("option")
    .map((o) => o.textContent?.trim() ?? "");
}

/** Encabezado de un título de la lista abierta, buscado por su NOMBRE (único y en mayúsculas). */
export function headerEl(name: string): HTMLElement | null {
  const lists = listboxes();
  if (lists.length === 0) return null;
  return within(lists[0]).queryByText(new RegExp(`\\b${name}\\b`));
}

/** Nombres de títulos (entre `names`) que la lista abierta muestra como encabezado. */
export function visibleHeaderNames(names: readonly string[] = ALL_TITLE_NAMES): string[] {
  return names.filter((n) => headerEl(n) !== null);
}

/**
 * Abre la lista y pulsa (ratón) cada encabezado de `names`. Un título NO se puede elegir: tras cada
 * clic la lista puede seguir abierta o no, pero el campo debe quedar sin valor.
 */
export function pressEveryHeader(input: HTMLInputElement, names: readonly string[]) {
  openList(input);
  for (const name of names) {
    const el = headerEl(name);
    if (el) pressMouse(el);
  }
}

// ─── «Sin cuenta»: el error que el contrato no fija con texto exacto ─────────────────────────────

function visibleTexts(): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? "").trim();
    if (text) out.push(text);
  }
  return out;
}

/** Foto del texto visible ANTES de enviar, para saber qué texto aparece después. */
export const snapshotTexts = visibleTexts;

/** Textos que aparecieron en pantalla desde `before` (multiconjunto: un texto repetido cuenta una vez). */
export function newTextsSince(before: readonly string[]): string[] {
  const remaining = [...before];
  const added: string[] = [];
  for (const text of visibleTexts()) {
    const index = remaining.indexOf(text);
    if (index >= 0) remaining.splice(index, 1);
    else added.push(text);
  }
  return added;
}

/**
 * ¿El formulario avisó que falta la cuenta? El texto exacto NO está en el contrato (ambigüedad
 * declarada en el reporte): se acepta un `toast.error(...)` o un texto NUEVO en pantalla (banner,
 * alerta, mensaje de campo) que mencione «cuenta».
 */
export function accountErrorShown(before: readonly string[], toastError?: Mock): boolean {
  const toasted = toastError?.mock.calls.some((call) => /cuenta/i.test(String(call[0]))) ?? false;
  return toasted || newTextsSince(before).some((text) => /cuenta/i.test(text));
}
