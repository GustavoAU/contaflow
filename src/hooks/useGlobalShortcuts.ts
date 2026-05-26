// src/hooks/useGlobalShortcuts.ts
// Q3-6: Keyboard Navigation — hook genérico de atajos de teclado globales.
//
// Características:
// - Ignora atajos cuando el foco está en inputs/textarea/select/[contenteditable]
//   para no interferir con la escritura del usuario.
// - Soporta combinaciones con Ctrl, Meta (Cmd en Mac), Alt y Shift.
// - Idempotente: limpia el listener al desmontar el componente.
//
// Uso:
//   useGlobalShortcuts([
//     { key: "n", handler: () => navigate("/invoices/new"), description: "Nueva factura" },
//     { key: "s", ctrl: true, handler: submitForm, description: "Guardar borrador (Ctrl+S)" },
//   ]);

import { useEffect, useRef } from "react";

export type ShortcutConfig = {
  /** Tecla a capturar — case-insensitive */
  key: string;
  /** Requiere Ctrl (Windows) o Cmd (Mac) */
  ctrl?: boolean;
  /** Requiere Meta (Cmd en Mac, Win en Windows) */
  meta?: boolean;
  /** Requiere Alt / Option */
  alt?: boolean;
  /** Requiere Shift */
  shift?: boolean;
  /** Handler a ejecutar */
  handler: () => void;
  /** Descripción legible — usada para `aria-keyshortcuts` */
  description?: string;
};

/**
 * Determina si el foco está en un elemento donde el usuario podría estar escribiendo.
 * En ese caso, los atajos sin modificadores (Ctrl, Alt) NO deben dispararse.
 *
 * Acepta EventTarget | Element | null para manejar el caso en que e.target
 * sea el Document (que no es Element y no tiene tagName).
 */
function isTypingTarget(el: EventTarget | Element | null): boolean {
  // Guard: solo operar si es un Element de verdad (no Document, no null)
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  // Radix Select content, combobox, etc.
  const role = el.getAttribute("role");
  if (role === "combobox" || role === "listbox" || role === "option") return true;
  return false;
}

export function useGlobalShortcuts(shortcuts: ShortcutConfig[]): void {
  // Keep shortcuts in a ref to avoid stale closures without re-registering the listener
  const shortcutsRef = useRef<ShortcutConfig[]>(shortcuts);

  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const { key, ctrlKey, metaKey, altKey, shiftKey } = e;

      for (const sc of shortcutsRef.current) {
        const keyMatch = key.toLowerCase() === sc.key.toLowerCase();
        const ctrlMatch = sc.ctrl ? (ctrlKey || metaKey) : true;
        const metaMatch = sc.meta ? metaKey : true;
        const altMatch = sc.alt ? altKey : true;
        const shiftMatch = sc.shift ? shiftKey : true;

        // For shortcuts WITHOUT modifiers: skip if the user is typing.
        // Use document.activeElement instead of e.target because keyboard events
        // bubble to document and e.target may be the document itself, not the
        // focused input element.
        const hasModifier = sc.ctrl || sc.meta || sc.alt || sc.shift;
        if (!hasModifier && isTypingTarget(document.activeElement)) continue;

        // For shortcuts WITH Ctrl/Meta: prevent browser default (e.g. Ctrl+S save page)
        if ((sc.ctrl || sc.meta) && (ctrlKey || metaKey)) {
          e.preventDefault();
        }

        if (keyMatch && ctrlMatch && metaMatch && altMatch && shiftMatch) {
          // Additional guard: don't fire modifier-less shortcuts when modifier keys are pressed
          if (!hasModifier && (ctrlKey || metaKey || altKey)) continue;

          sc.handler();
          break; // First matching shortcut wins
        }
      }
    }

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []); // empty deps — shortcutsRef handles currency
}

/**
 * Genera el atributo aria-keyshortcuts a partir de un ShortcutConfig.
 * Ejemplo: { key: "n", ctrl: true } → "Control+n"
 */
export function ariaKeyShortcut(sc: Pick<ShortcutConfig, "key" | "ctrl" | "meta" | "alt" | "shift">): string {
  const parts: string[] = [];
  if (sc.ctrl) parts.push("Control");
  if (sc.meta) parts.push("Meta");
  if (sc.alt) parts.push("Alt");
  if (sc.shift) parts.push("Shift");
  parts.push(sc.key);
  return parts.join("+");
}
