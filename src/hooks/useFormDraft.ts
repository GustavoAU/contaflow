/**
 * useFormDraft — Autosave de borradores en sessionStorage (Q1-3)
 *
 * Persiste el estado de un formulario cada AUTO_SAVE_INTERVAL_MS.
 * Al reabrir la página ofrece restaurar el borrador si existe uno.
 *
 * Uso:
 *   const { draft, saveDraft, clearDraft } = useFormDraft<MiEstado>("invoice-new");
 *   // Al cambiar campos importantes:
 *   useEffect(() => { const t = setTimeout(() => saveDraft(state), 30_000); return () => clearTimeout(t); }, [state]);
 *   // Al enviar exitosamente:
 *   clearDraft();
 */

"use client";

import { useState, useCallback } from "react";

export const DRAFT_AUTO_SAVE_MS = 30_000; // 30 segundos

const PREFIX = "cf-draft-";

export interface DraftEntry<T> {
  state: T;
  savedAt: string; // ISO
}

export function useFormDraft<T>(formKey: string) {
  const key = `${PREFIX}${formKey}`;

  function read(): DraftEntry<T> | null {
    try {
      if (typeof sessionStorage === "undefined") return null;
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as DraftEntry<T>;
    } catch {
      return null;
    }
  }

  const [draft, setDraft] = useState<DraftEntry<T> | null>(() => read());

  const saveDraft = useCallback(
    (state: T) => {
      try {
        if (typeof sessionStorage === "undefined") return;
        const entry: DraftEntry<T> = { state, savedAt: new Date().toISOString() };
        sessionStorage.setItem(key, JSON.stringify(entry));
        setDraft(entry);
      } catch {
        // sessionStorage no disponible (modo privado extremo) — fallo silencioso
      }
    },
    [key]
  );

  const clearDraft = useCallback(() => {
    try {
      if (typeof sessionStorage === "undefined") return;
      sessionStorage.removeItem(key);
      setDraft(null);
    } catch {
      // silencioso
    }
  }, [key]);

  return { draft, saveDraft, clearDraft };
}
