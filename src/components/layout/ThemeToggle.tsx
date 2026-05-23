"use client";

import { SunIcon, MoonIcon, MonitorIcon } from "lucide-react";
import { useTheme } from "./ThemeProvider";

type Theme = "light" | "dark" | "system";

const CYCLE: Theme[] = ["light", "dark", "system"];

const ICONS = {
  light:  SunIcon,
  dark:   MoonIcon,
  system: MonitorIcon,
} as const;

const LABELS = {
  light:  "Claro",
  dark:   "Oscuro",
  system: "Sistema",
} as const;

/**
 * ThemeToggle — cicla entre Claro / Oscuro / Sistema al hacer clic.
 * Integrado en el footer del Sidebar.
 */
export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const { theme, setTheme } = useTheme();

  function handleClick() {
    const idx = CYCLE.indexOf(theme);
    const next = CYCLE[(idx + 1) % CYCLE.length];
    setTheme(next);
  }

  const Icon = ICONS[theme];

  return (
    <button
      onClick={handleClick}
      title={`Tema: ${LABELS[theme]}. Clic para cambiar.`}
      aria-label={`Cambiar tema (actual: ${LABELS[theme]})`}
      className="flex items-center gap-2.5 w-full px-2 py-1.75 rounded-md text-13 font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors overflow-hidden whitespace-nowrap"
    >
      <Icon className="w-3.75 h-3.75 shrink-0" />
      {!collapsed && <span>{LABELS[theme]}</span>}
    </button>
  );
}
