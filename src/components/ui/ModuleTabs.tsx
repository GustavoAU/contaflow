// src/components/ui/ModuleTabs.tsx
// Pestañas de navegación entre secciones del mismo módulo.
// Usa usePageTransition para que la barra de progreso superior sea visible
// al cambiar de pestaña (igual que TransitionLink en Navbar).
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { TAB_ACTIVE, TAB_INACTIVE, DEFAULT_TAB_COLOR, type TabColor } from "./tab-colors";
import { usePageTransition } from "@/components/layout/PageTransitionProvider";

export type ModuleTab = {
  label: string;
  href: string;
};

type Props = {
  tabs: ModuleTab[];
  color?: TabColor;
  className?: string;
};

export function ModuleTabs({ tabs, color = DEFAULT_TAB_COLOR, className }: Props) {
  const pathname = usePathname();
  const { navigate } = usePageTransition();
  const activeStyle = TAB_ACTIVE[color] ?? TAB_ACTIVE[DEFAULT_TAB_COLOR];

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
              isActive ? activeStyle : TAB_INACTIVE
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
