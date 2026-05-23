// src/components/layout/Navbar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Menu, X } from "lucide-react";
import { getNavItems, type UserRole } from "@/lib/nav-items";
import { BcvRateWidget } from "@/components/layout/BcvRateWidget";
import { usePageTransition } from "@/components/layout/PageTransitionProvider";

function TransitionLink({
  href,
  className,
  children,
  onNavigate,
}: {
  href: string;
  className: string;
  children: React.ReactNode;
  onNavigate?: () => void;
}) {
  const { navigate } = usePageTransition();
  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault();
          onNavigate?.();
          navigate(href);
        }
      }}
    >
      {children}
    </Link>
  );
}

type NavbarProps = {
  companyId?: string;
  companyName?: string;
  plan?: string;
  userRole?: UserRole;
  notificationSlot?: React.ReactNode;
  /** Grants activos para el rol: array de strings "ROLE:module" */
  grantedModules?: string[];
};

export function Navbar({ companyId, companyName, userRole = "ACCOUNTANT", notificationSlot, grantedModules }: NavbarProps) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const grants = new Set(grantedModules ?? []);
  const { primary, sections } = companyId
    ? getNavItems(userRole, companyId, grants)
    : { primary: [], sections: [] };

  const allSecondaryItems = sections.flatMap((s) => s.items);
  const allItems = [...primary, ...allSecondaryItems];

  const isActive = (href: string) =>
    href === `/company/${companyId}`
      ? pathname === href
      : pathname.startsWith(href);

  const hasActiveSecondary = allSecondaryItems.some((item) => isActive(item.href));

  return (
    <header className="border-b bg-white dark:bg-zinc-950">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        {/* Logo */}
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
          <span className="text-xl font-bold tracking-tight">
            Conta<span className="text-blue-600">Flow</span>
          </span>
          {companyName && (
            <span className="text-muted-foreground hidden text-sm lg:block">— {companyName}</span>
          )}
        </Link>

        {/* Nav desktop */}
        <nav className="hidden items-center gap-1 md:flex">
          {primary.map((item) => {
            const Icon = item.icon;
            return (
              <TransitionLink
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive(item.href)
                    ? "bg-blue-50 text-blue-600"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </TransitionLink>
            );
          })}

          {/* Dropdown "Más" con secciones */}
          {sections.length > 0 && (
            <div className="relative" ref={moreRef}>
              <button
                onClick={() => setMoreOpen((v) => !v)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  hasActiveSecondary
                    ? "bg-blue-50 text-blue-600"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                )}
              >
                Más
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", moreOpen && "rotate-180")}
                />
              </button>

              {moreOpen && (
                <div className="absolute top-full right-0 z-50 mt-1 w-52 rounded-lg border bg-white py-1 shadow-lg dark:bg-zinc-950">
                  {sections.map((section, sIdx) => (
                    <div key={section.group}>
                      {/* Separador de sección */}
                      {sIdx > 0 && <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />}
                      <p className="px-3 pt-1.5 pb-0.5 text-10 font-semibold uppercase tracking-wider text-zinc-400">
                        {section.group}
                      </p>
                      {section.items.map((navItem) => {
                        const Icon = navItem.icon;
                        if (navItem.comingSoon) {
                          return (
                            <div
                              key={navItem.href}
                              className="flex items-center justify-between px-3 py-2 text-sm font-medium text-zinc-400 cursor-not-allowed"
                            >
                              <span className="flex items-center gap-2">
                                <Icon className="h-4 w-4" />
                                {navItem.label}
                              </span>
                              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-10 font-medium text-zinc-500 dark:bg-zinc-800">
                                Pronto
                              </span>
                            </div>
                          );
                        }
                        return (
                          <TransitionLink
                            key={navItem.href}
                            href={navItem.href}
                            onNavigate={() => setMoreOpen(false)}
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors",
                              isActive(navItem.href)
                                ? "bg-blue-50 text-blue-600"
                                : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                            )}
                          >
                            <Icon className="h-4 w-4" />
                            {navItem.label}
                          </TransitionLink>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Derecha: tasa BCV + notificaciones + usuario + hamburguesa mobile */}
        <div className="flex items-center gap-3">
          {companyId && <BcvRateWidget companyId={companyId} />}
          {notificationSlot}
          <UserButton />
          {companyId && (
            <button
              className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100 md:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Menú"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          )}
        </div>
      </div>

      {/* Drawer mobile */}
      {mobileOpen && companyId && (
        <div className="border-t bg-white px-4 pb-4 md:hidden dark:bg-zinc-950">
          <nav className="mt-2 flex flex-col gap-1">
            {/* Primarios */}
            {primary.map((navItem) => {
              const Icon = navItem.icon;
              return (
                <TransitionLink
                  key={navItem.href}
                  href={navItem.href}
                  onNavigate={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive(navItem.href)
                      ? "bg-blue-50 text-blue-600"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {navItem.label}
                </TransitionLink>
              );
            })}
            {/* Secciones */}
            {sections.map((section, sIdx) => (
              <div key={section.group}>
                {(sIdx > 0 || primary.length > 0) && (
                  <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
                )}
                <p className="px-3 pt-1 pb-0.5 text-10 font-semibold uppercase tracking-wider text-zinc-400">
                  {section.group}
                </p>
                {section.items.map((navItem) => {
                  const Icon = navItem.icon;
                  if (navItem.comingSoon) {
                    return (
                      <div
                        key={navItem.href}
                        className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium text-zinc-400"
                      >
                        <span className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          {navItem.label}
                        </span>
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-10 font-medium text-zinc-500 dark:bg-zinc-800">
                          Pronto
                        </span>
                      </div>
                    );
                  }
                  return (
                    <TransitionLink
                      key={navItem.href}
                      href={navItem.href}
                      onNavigate={() => setMobileOpen(false)}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                        isActive(navItem.href)
                          ? "bg-blue-50 text-blue-600"
                          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {navItem.label}
                    </TransitionLink>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
