// src/lib/view-mode.ts
// Cookie helper para el modo de vista (Sistema vs. Gerencial).
// Sin cambios de schema — el modo es una preferencia de sesión.

import { cookies } from "next/headers";

export type ViewMode = "sistema" | "gerente";
export const VIEW_MODE_COOKIE = "cf-view-mode";

/**
 * Lee el modo de vista actual desde la cookie.
 * Solo llamable en Server Components y Server Actions (usa next/headers).
 * Default: "sistema" (vista completa de contador).
 */
export async function getViewMode(): Promise<ViewMode> {
  const store = await cookies();
  const val = store.get(VIEW_MODE_COOKIE)?.value;
  return val === "gerente" ? "gerente" : "sistema";
}
