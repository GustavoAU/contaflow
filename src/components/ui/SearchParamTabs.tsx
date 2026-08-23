// src/components/ui/SearchParamTabs.tsx
// Tabs basados en URL search params, compatible con Server Components.
// currentValue viene del servidor (searchParams), evitando necesidad de Suspense.
// Usa usePageTransition para activar la barra de progreso al cambiar de pestaña.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  TAB_ACTIVE, TAB_ACTIVE_BADGE, TAB_INACTIVE, TAB_INACTIVE_BADGE,
  DEFAULT_TAB_COLOR, type TabColor,
} from "./tab-colors";
import { usePageTransition } from "@/components/layout/PageTransitionProvider";

export type SearchParamTab = {
  value: string;
  label: string;
  /** Número a mostrar como badge en el tab (ej. pendientes) */
  badge?: number;
  /** Ocultar el tab — útil para control basado en rol desde el servidor */
  show?: boolean;
};

type Props = {
  tabs: SearchParamTab[];
  /** Valor activo actual — proviene del searchParams del servidor */
  currentValue: string;
  paramKey?: string;
  color?: TabColor;
  className?: string;
};

export function SearchParamTabs({
  tabs,
  currentValue,
  paramKey = "tab",
  color = DEFAULT_TAB_COLOR,
  className,
}: Props) {
  const pathname    = usePathname();
  const { navigate } = usePageTransition();
  const activeStyle = TAB_ACTIVE[color] ?? TAB_ACTIVE[DEFAULT_TAB_COLOR];
  const activeBadge = TAB_ACTIVE_BADGE[color] ?? TAB_ACTIVE_BADGE[DEFAULT_TAB_COLOR];

  const visibleTabs = tabs.filter((t) => t.show !== false);

  return (
    <nav
      aria-label="Sección"
      className={cn("flex border-b border-zinc-200", className)}
    >
      {visibleTabs.map((tab) => {
        const isActive = tab.value === currentValue;
        const href = `${pathname}?${paramKey}=${tab.value}`;

        return (
          <Link
            key={tab.value}
            href={href}
            aria-current={isActive ? "page" : undefined}
            onClick={(e) => {
              if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                navigate(href);
              }
            }}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
              isActive ? activeStyle : TAB_INACTIVE
            )}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className={cn(
                "rounded-full px-1.5 py-0.5 text-10 font-bold leading-none",
                isActive ? activeBadge : TAB_INACTIVE_BADGE
              )}>
                {tab.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
