"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type ModuleTab = {
  label: string;
  href: string;
};

type Props = {
  tabs: ModuleTab[];
  color?: "blue" | "amber" | "emerald" | "violet";
  className?: string;
};

const ACTIVE: Record<string, string> = {
  blue:    "border-blue-500 text-blue-600",
  amber:   "border-amber-500 text-amber-700",
  emerald: "border-emerald-500 text-emerald-600",
  violet:  "border-violet-500 text-violet-600",
};

export function ModuleTabs({ tabs, color = "blue", className }: Props) {
  const pathname = usePathname();
  const activeStyle = ACTIVE[color] ?? ACTIVE.blue;

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
