// src/components/ui/ModuleTabs.tsx
// Pestañas de navegación entre secciones del mismo módulo.
// Usa usePageTransition para que la barra de progreso superior sea visible
// al cambiar de pestaña (igual que TransitionLink en Navbar).
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { usePageTransition } from "@/components/layout/PageTransitionProvider";

export type ModuleTab = {
  label: string;
  href: string;
};

type Props = {
  tabs: ModuleTab[];
  color?: "primary" | "blue" | "amber" | "emerald" | "violet";
  className?: string;
};

// "primary" deriva del token — no repite un morado literal que se desincronice
// del brand. amber/emerald siguen siendo acentos deliberados por modulo.
const ACTIVE: Record<string, string> = {
  primary: "border-primary text-primary",
  blue:    "border-blue-500 text-blue-600",
  amber:   "border-amber-500 text-amber-700",
  emerald: "border-emerald-500 text-emerald-600",
  violet:  "border-violet-500 text-violet-600",
};

export function ModuleTabs({ tabs, color = "primary", className }: Props) {
  const pathname = usePathname();
  const { navigate } = usePageTransition();
  const activeStyle = ACTIVE[color] ?? ACTIVE.primary;

  return (
    <nav
      aria-label="Sección"
      className={cn("flex border-b border-zinc-200", className)}
    >
      {tabs.map((tab) => {
        const isActive =
          pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            onClick={(e) => {
              if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                navigate(tab.href);
              }
            }}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
              isActive
                ? activeStyle
                : "border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
