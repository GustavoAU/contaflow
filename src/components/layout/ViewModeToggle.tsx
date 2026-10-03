"use client";
// src/components/layout/ViewModeToggle.tsx
// Toggle Modo Sistema / Modo Gerencial en el sidebar.
// Solo visible para OWNER y ADMIN. Persiste la preferencia como cookie
// httpOnly; el cambio se propaga con router.refresh().

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseIcon, LayoutDashboardIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { setViewModeAction } from "@/modules/settings/actions/view-mode.actions";
import type { ViewMode } from "@/lib/view-mode";

type Props = {
  current: ViewMode;
  collapsed: boolean;
};

export function ViewModeToggle({ current, collapsed }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const isGerente = current === "gerente";

  const toggle = () => {
    const next: ViewMode = isGerente ? "sistema" : "gerente";
    startTransition(async () => {
      await setViewModeAction(next);
      router.refresh();
    });
  };

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      aria-label={
        isGerente
          ? "Cambiar a Modo Sistema (contador)"
          : "Cambiar a Modo Gerencial (vista simplificada)"
      }
      title={collapsed ? (isGerente ? "Modo Gerencial" : "Modo Sistema") : undefined}
      className={cn(
        "text-13 flex w-full items-center gap-2.5 rounded-md px-2 py-1.75 font-medium",
        "overflow-hidden whitespace-nowrap transition-colors",
        "disabled:cursor-wait disabled:opacity-60",
        // WCAG 2.4.7: indicador de foco visible
        "outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-1",
        collapsed && "justify-center",
        isGerente
          ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-950/70"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      )}
    >
      {isGerente ? (
        <BriefcaseIcon className="h-3.75 w-3.75 shrink-0" />
      ) : (
        <LayoutDashboardIcon className="h-3.75 w-3.75 shrink-0" />
      )}
      {!collapsed && (
        <span className="flex-1 overflow-hidden text-left text-ellipsis">
          {isGerente ? "Modo Gerencial" : "Modo Sistema"}
        </span>
      )}
    </button>
  );
}
