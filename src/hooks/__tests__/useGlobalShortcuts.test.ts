// @vitest-environment jsdom
// src/hooks/__tests__/useGlobalShortcuts.test.ts
// Q3-6: Tests para useGlobalShortcuts + ariaKeyShortcut

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useGlobalShortcuts, ariaKeyShortcut, type ShortcutConfig } from "../useGlobalShortcuts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pressKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  document.dispatchEvent(event);
}

function createInput(): HTMLInputElement {
  const el = document.createElement("input");
  document.body.appendChild(el);
  el.focus();
  return el;
}

// ── useGlobalShortcuts ────────────────────────────────────────────────────────

describe("useGlobalShortcuts", () => {
  beforeEach(() => {
    // Clean DOM
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("llama el handler cuando se presiona la tecla correcta", () => {
    const handler = vi.fn();
    const shortcuts: ShortcutConfig[] = [{ key: "n", handler }];

    renderHook(() => useGlobalShortcuts(shortcuts));
    pressKey("n");

    expect(handler).toHaveBeenCalledOnce();
  });

  it("NO dispara shortcut sin modificador cuando el foco está en un input", () => {
    const handler = vi.fn();
    const shortcuts: ShortcutConfig[] = [{ key: "n", handler }];

    createInput(); // foco en input
    renderHook(() => useGlobalShortcuts(shortcuts));
    pressKey("n");

    expect(handler).not.toHaveBeenCalled();
  });

  it("NO dispara shortcut sin modificador cuando el foco está en textarea", () => {
    const handler = vi.fn();
    const shortcuts: ShortcutConfig[] = [{ key: "s", handler }];

    const el = document.createElement("textarea");
    document.body.appendChild(el);
    el.focus();
    renderHook(() => useGlobalShortcuts(shortcuts));
    pressKey("s");

    expect(handler).not.toHaveBeenCalled();
  });

  it("dispara shortcut Ctrl+S incluso en un input", () => {
    const handler = vi.fn();
    const shortcuts: ShortcutConfig[] = [{ key: "s", ctrl: true, handler }];

    createInput(); // foco en input
    renderHook(() => useGlobalShortcuts(shortcuts));
    pressKey("s", { ctrlKey: true });

    expect(handler).toHaveBeenCalledOnce();
  });

  it("case-insensitive: 'N' y 'n' disparan la misma shortcut", () => {
    const handler = vi.fn();
    const shortcuts: ShortcutConfig[] = [{ key: "n", handler }];

    renderHook(() => useGlobalShortcuts(shortcuts));
    pressKey("N");

    expect(handler).toHaveBeenCalledOnce();
  });

  it("NO dispara shortcut sin modificador cuando se presionan Ctrl+tecla", () => {
    const handler = vi.fn();
    const shortcuts: ShortcutConfig[] = [{ key: "n", handler }];

    renderHook(() => useGlobalShortcuts(shortcuts));
    pressKey("n", { ctrlKey: true });

    expect(handler).not.toHaveBeenCalled();
  });

  it("dispara el primer shortcut que coincide (orden importa)", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const shortcuts: ShortcutConfig[] = [
      { key: "n", handler: handler1 },
      { key: "n", handler: handler2 },
    ];

    renderHook(() => useGlobalShortcuts(shortcuts));
    pressKey("n");

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).not.toHaveBeenCalled();
  });

  it("múltiples shortcuts funcionan independientemente", () => {
    const handlerN = vi.fn();
    const handlerS = vi.fn();
    const shortcuts: ShortcutConfig[] = [
      { key: "n", handler: handlerN },
      { key: "s", ctrl: true, handler: handlerS },
    ];

    renderHook(() => useGlobalShortcuts(shortcuts));
    pressKey("n");
    pressKey("s", { ctrlKey: true });

    expect(handlerN).toHaveBeenCalledOnce();
    expect(handlerS).toHaveBeenCalledOnce();
  });

  it("shortcut con Alt funciona", () => {
    const handler = vi.fn();
    const shortcuts: ShortcutConfig[] = [{ key: "n", alt: true, handler }];

    renderHook(() => useGlobalShortcuts(shortcuts));
    pressKey("n", { altKey: true });

    expect(handler).toHaveBeenCalledOnce();
  });

  it("limpia el listener al desmontar (no memory leak)", () => {
    const handler = vi.fn();
    const shortcuts: ShortcutConfig[] = [{ key: "n", handler }];

    const { unmount } = renderHook(() => useGlobalShortcuts(shortcuts));
    unmount();
    pressKey("n");

    expect(handler).not.toHaveBeenCalled();
  });
});

// ── ariaKeyShortcut ───────────────────────────────────────────────────────────

describe("ariaKeyShortcut", () => {
  it("tecla simple sin modificador", () => {
    expect(ariaKeyShortcut({ key: "n" })).toBe("n");
  });

  it("Control+s", () => {
    expect(ariaKeyShortcut({ key: "s", ctrl: true })).toBe("Control+s");
  });

  it("Control+Enter", () => {
    expect(ariaKeyShortcut({ key: "Enter", ctrl: true })).toBe("Control+Enter");
  });

  it("Alt+n", () => {
    expect(ariaKeyShortcut({ key: "n", alt: true })).toBe("Alt+n");
  });

  it("Shift+N", () => {
    expect(ariaKeyShortcut({ key: "N", shift: true })).toBe("Shift+N");
  });

  it("Control+Shift+s", () => {
    expect(ariaKeyShortcut({ key: "s", ctrl: true, shift: true })).toBe("Control+Shift+s");
  });
});
