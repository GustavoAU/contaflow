// src/components/ui/SearchParamTabs.tsx
// Tabs basados en URL search params, compatible con Server Components.
// currentValue viene del servidor (searchParams), evitando necesidad de Suspense.
// Usa usePageTransition para activar la barra de progreso al cambiar de pestaña.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
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
  color?: "primary" | "blue" | "emerald" | "amber" | "violet";
  className?: string;
};

const ACTIVE_STYLES: Record<string, string> = {
  primary: "border-primary text-primary",
  blue:    "border-blue-500 text-blue-600",
  emerald: "border-emerald-500 text-emerald-600",
  amber:   "border-amber-500 text-amber-700",
  violet:  "border-violet-500 text-violet-600",
};

// El badge del tab activo estaba fijo en azul: unos tabs con color="violet"
// llevaban contador azul. Ahora sale del mismo prop `color`.
const ACTIVE_BADGE: Record<string, string> = {
  primary: "bg-primary/10 text-primary",
  blue:    "bg-blue-100 text-blue-700",
  emerald: "bg-emerald-100 text-emerald-700",
  amber:   "bg-amber-100 text-amber-700",
  violet:  "bg-violet-100 text-violet-700",
};

export function SearchParamTabs({
  tabs,
  currentValue,
  paramKey = "tab",
  color = "primary",
  className,
}: Props) {
  const pathname    = usePathname();
  const { navigate } = usePageTransition();
  const activeStyle  = ACTIVE_STYLES[color] ?? ACTIVE_STYLES.primary;
  const activeBadge  = ACTIVE_BADGE[color]  ?? ACTIVE_BADGE.primary;

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
              isActive
                ? activeStyle
                : "border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300"
            )}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className={cn(
                "rounded-full px-1.5 py-0.5 text-10 font-bold leading-none",
                isActive ? activeBadge : "bg-zinc-200 text-zinc-600"
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
