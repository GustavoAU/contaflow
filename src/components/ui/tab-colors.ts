// src/components/ui/tab-colors.ts
// Punto 5 del handoff de UI: ModuleTabs y SearchParamTabs tenían este mapa
// copiado palabra por palabra, y ya habían divergido (solo SearchParamTabs
// soporta badge). Fuente única para los dos.
//
// "primary" deriva del token de marca: es el default y no se desincroniza si
// mañana cambia --primary. El resto son acentos deliberados por módulo
// (fiscal en ámbar, contactos en esmeralda…).

export type TabColor = "primary" | "blue" | "emerald" | "amber" | "violet";

export const DEFAULT_TAB_COLOR: TabColor = "primary";

/** Borde inferior + texto del tab activo. */
export const TAB_ACTIVE: Record<TabColor, string> = {
  primary: "border-primary text-primary",
  blue:    "border-blue-500 text-blue-600",
  emerald: "border-emerald-500 text-emerald-600",
  amber:   "border-amber-500 text-amber-700",
  violet:  "border-violet-500 text-violet-600",
};

/** Contador dentro del tab activo. Antes estaba fijo en azul, así que unos
 *  tabs con color="violet" llevaban badge azul. */
export const TAB_ACTIVE_BADGE: Record<TabColor, string> = {
  primary: "bg-primary/10 text-primary",
  blue:    "bg-blue-100 text-blue-700",
  emerald: "bg-emerald-100 text-emerald-700",
  amber:   "bg-amber-100 text-amber-700",
  violet:  "bg-violet-100 text-violet-700",
};

/** Tab inactivo — idéntico en ambos componentes, sin variantes de color. */
export const TAB_INACTIVE =
  "border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300";

export const TAB_INACTIVE_BADGE = "bg-zinc-200 text-zinc-600";
