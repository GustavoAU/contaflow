// @vitest-environment jsdom
// src/components/accounting/AccountCombobox.a11y.test.tsx
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Todo lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase
// (único cambio permitido en el paso 2: sustituir el import dinámico por un import estático).
//
// SPEC-012 CA-17 (Entrega A, paso 1, modo RED) — accesibilidad del combobox de cuenta:
//  · axe sin violaciones serious/critical en el componente cerrado y abierto (con encabezados),
//  · y el patrón ARIA combobox (SPEC §8): role=combobox, aria-expanded, aria-controls → listbox,
//    aria-activedescendant → option, encabezados SIN role=option, aria-live="polite".
//
// Como el resto de a11y del repo (SPEC-002 RN-6), axe se corre sobre `document.body` para cubrir
// también una lista que se renderice en un portal. `color-contrast` está desactivado en el helper
// (jsdom no calcula estilos): por eso hay además una guarda estática contra los grises de bajo
// contraste en los encabezados (SPEC §8: ≥ 4.5:1).
//
// Modo RED: `./AccountCombobox` aún no existe; se carga con import dinámico no literal (ver
// AccountCombobox.test.tsx). En GREEN se puede pasar a un import estático.

import type { ComponentType } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoSeriousA11yViolations } from "@/__tests__/a11y";

import { AccountCombobox } from "./AccountCombobox";

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

afterEach(cleanup);

async function renderCombobox(
  props: Partial<AccountComboboxProps> = {}
): Promise<{ input: HTMLInputElement }> {
  const Combobox = await loadCombobox();
  render(<Combobox aria-label="Cuenta" accounts={PLAN} value="" onChange={() => {}} {...props} />);
  return { input: screen.getByRole("combobox") as HTMLInputElement };
}

const typeInto = (input: HTMLElement, text: string) =>
  fireEvent.change(input, { target: { value: text } });
const press = (input: HTMLElement, key: string) => fireEvent.keyDown(input, { key });

function headerEl(name: string): HTMLElement | null {
  const root = screen.queryByRole("listbox") ?? document.body;
  const re = new RegExp(`\\b${name}\\b`);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (re.test(node.textContent ?? "")) return node.parentElement;
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox — axe (CA-17)", () => {
  it("cerrado y vacío: sin violaciones serious/critical", async () => {
    await renderCombobox();
    await expectNoSeriousA11yViolations(document.body);
  });

  it("cerrado con una cuenta elegida: sin violaciones", async () => {
    await renderCombobox({ value: "m:1.1.01.01.001" });
    await expectNoSeriousA11yViolations(document.body);
  });

  it("abierto con la jerarquía completa (títulos como encabezados + cuentas): sin violaciones", async () => {
    const { input } = await renderCombobox();
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    await expectNoSeriousA11yViolations(document.body);
  });

  it("abierto y filtrado («caja», con encabezados de contexto): sin violaciones", async () => {
    const { input } = await renderCombobox();
    typeInto(input, "caja");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await expectNoSeriousA11yViolations(document.body);
  });

  it("abierto con una opción activa tras navegar con el teclado: sin violaciones", async () => {
    const { input } = await renderCombobox();
    fireEvent.focus(input);
    press(input, "ArrowDown");
    press(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBeTruthy();
    await expectNoSeriousA11yViolations(document.body);
  });

  it("abierto sin resultados: sin violaciones (aria-expanded=true exige aria-controls: sin lista, aria-expanded=false)", async () => {
    const { input } = await renderCombobox();
    typeInto(input, "zzz");
    expect(document.body.textContent).toContain("No hay cuentas que coincidan con «zzz»");
    await expectNoSeriousA11yViolations(document.body);
  });

  it("sin cuentas disponibles (deshabilitado): sin violaciones", async () => {
    await renderCombobox({ accounts: [] });
    await expectNoSeriousA11yViolations(document.body);
  });

  it("con aria-invalid (error de validación): sin violaciones", async () => {
    await renderCombobox({ "aria-invalid": true });
    await expectNoSeriousA11yViolations(document.body);
  });

  it("varios selectores en la misma página (grilla de asientos), uno abierto: sin violaciones", async () => {
    const Combobox = await loadCombobox();
    render(
      <div>
        <Combobox aria-label="Cuenta, línea 1" accounts={PLAN} value="" onChange={() => {}} />
        <Combobox aria-label="Cuenta, línea 2" accounts={PLAN} value="" onChange={() => {}} />
        <Combobox aria-label="Cuenta, línea 3" accounts={PLAN} value="" onChange={() => {}} />
      </div>
    );
    fireEvent.focus(screen.getAllByRole("combobox")[1]);
    expect(screen.getAllByRole("listbox")).toHaveLength(1);
    await expectNoSeriousA11yViolations(document.body);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountCombobox — patrón ARIA combobox (SPEC §8)", () => {
  it("cerrado: role=combobox con nombre accesible y aria-expanded=false", async () => {
    const { input } = await renderCombobox({ "aria-label": "Cuenta, línea 1" });
    expect(screen.getByRole("combobox", { name: "Cuenta, línea 1" })).toBe(input);
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("abierto: aria-expanded=true y aria-controls apunta al listbox que existe", async () => {
    const { input } = await renderCombobox();
    fireEvent.focus(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const controls = input.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    const list = document.getElementById(controls!);
    expect(list).not.toBeNull();
    expect(list!.getAttribute("role")).toBe("listbox");
    expect(list).toBe(screen.getByRole("listbox"));
  });

  it("aria-activedescendant apunta a un option que existe dentro del listbox, y se mueve con las flechas", async () => {
    const { input } = await renderCombobox();
    fireEvent.focus(input);
    const list = screen.getByRole("listbox");

    const seen: string[] = [];
    for (const key of [null, "ArrowDown", "ArrowDown", "ArrowDown", "ArrowUp"]) {
      if (key) press(input, key);
      const id = input.getAttribute("aria-activedescendant");
      expect(id, `tras ${key ?? "abrir"}`).toBeTruthy();
      const active = document.getElementById(id!);
      expect(active).not.toBeNull();
      expect(active!.getAttribute("role")).toBe("option");
      expect(list.contains(active)).toBe(true);
      seen.push(id!);
    }
    // Caja Principal → Caja Chica → Banco → Proveedores → Banco
    expect(seen[1]).not.toBe(seen[0]);
    expect(seen[2]).not.toBe(seen[1]);
    expect(seen[3]).not.toBe(seen[2]);
    expect(seen[4]).toBe(seen[2]);
  });

  it("cada option tiene un id único y vive dentro del listbox", async () => {
    const { input } = await renderCombobox();
    fireEvent.focus(input);
    const list = screen.getByRole("listbox");
    const options = [...document.querySelectorAll('[role="option"]')] as HTMLElement[];
    expect(options).toHaveLength(4);
    const ids = options.map((o) => o.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    for (const option of options) expect(list.contains(option)).toBe(true);
  });

  it("los encabezados de título NO son role=option y son role=presentation/none/group (no se ofrecen como elegibles)", async () => {
    const { input } = await renderCombobox();
    fireEvent.focus(input);
    const list = screen.getByRole("listbox");
    for (const name of TITLE_NAMES) {
      const el = headerEl(name);
      expect(el, name).not.toBeNull();
      expect(list.contains(el), name).toBe(true);
      expect(el!.closest('[role="option"]'), name).toBeNull();
      const roleOwner = el!.closest("[role]");
      expect(["presentation", "none", "group"], name).toContain(roleOwner?.getAttribute("role"));
    }
  });

  it("los encabezados no usan grises de bajo contraste (AA ≥ 4.5:1; jsdom no calcula contraste)", async () => {
    const { input } = await renderCombobox();
    fireEvent.focus(input);
    // Solo clases sin prefijo de variante (`dark:` etc. no aplican sobre el fondo claro de la lista).
    const lowContrast =
      /(?:^|\s)text-(?:gray|zinc|slate|neutral|stone)-(?:50|100|200|300|400)(?:\s|$)|(?:^|\s)opacity-(?:[0-9]|[1-6][0-9]|70)(?:\s|$)/;
    for (const name of TITLE_NAMES) {
      const el = headerEl(name)!;
      for (let node: HTMLElement | null = el; node; node = node.parentElement) {
        if (node === screen.getByRole("listbox")) break;
        expect(
          node.getAttribute("class") ?? "",
          `${name} (<${node.tagName.toLowerCase()}>)`
        ).not.toMatch(lowContrast);
      }
    }
  });

  it("hay una región aria-live=polite que anuncia «{n} cuentas»", async () => {
    const { input } = await renderCombobox();
    fireEvent.focus(input);
    const live = () => document.querySelector('[aria-live="polite"]')?.textContent ?? "";
    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(live()).toMatch(/4\s+cuentas?/i);
    typeInto(input, "caja");
    expect(live()).toMatch(/2\s+cuentas?/i);
  });

  it("al cerrarse con Esc, aria-expanded vuelve a false y aria-activedescendant no queda apuntando a un id inexistente", async () => {
    const { input } = await renderCombobox();
    fireEvent.focus(input);
    expect(input.getAttribute("aria-activedescendant")).toBeTruthy();
    press(input, "Escape");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    const dangling = input.getAttribute("aria-activedescendant");
    if (dangling) expect(document.getElementById(dangling)).not.toBeNull();
    await expectNoSeriousA11yViolations(document.body);
  });

  it("deshabilitado e inválido se anuncian con los atributos nativos/ARIA", async () => {
    const { input } = await renderCombobox({ disabled: true, "aria-invalid": true });
    expect(input.disabled).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });
});
