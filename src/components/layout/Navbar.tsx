// src/components/layout/Navbar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  BookOpen,
  FileText,
  BarChart3,
  Settings,
  ScanIcon,
  FileSpreadsheetIcon,
  ReceiptIcon,
  BanknoteIcon,
  ChevronDown,
  Menu,
  X,
} from "lucide-react";

type NavbarProps = {
  companyId?: string;
  companyName?: string;
  plan?: string;
};

export function Navbar({ companyId, companyName }: NavbarProps) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Solo click fuera — sin useEffect de pathname
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const PRIMARY_ITEMS = companyId
    ? [
        { label: t("dashboard"), href: `/company/${companyId}`, icon: LayoutDashboard },
        { label: t("accounts"), href: `/company/${companyId}/accounts`, icon: BookOpen },
        { label: t("transactions"), href: `/company/${companyId}/transactions`, icon: FileText },
        { label: t("reports"), href: `/company/${companyId}/reports`, icon: BarChart3 },
      ]
    : [];

  const SECONDARY_ITEMS = companyId
    ? [
        { label: "Retenciones", href: `/company/${companyId}/retentions`, icon: ReceiptIcon },
        { label: "IGTF", href: `/company/${companyId}/igtf`, icon: BanknoteIcon },
        { label: "Escanear", href: `/company/${companyId}/invoices/upload`, icon: ScanIcon },
        { label: "Importar", href: `/company/${companyId}/import`, icon: FileSpreadsheetIcon },
        { label: t("settings"), href: `/company/${companyId}/settings`, icon: Settings },
      ]
    : [];

  const ALL_ITEMS = [...PRIMARY_ITEMS, ...SECONDARY_ITEMS];

  const isActive = (href: string) =>
    href === `/company/${companyId}` ? pathname === href : pathname.startsWith(href);

  const hasActiveSecondary = SECONDARY_ITEMS.some((item) => isActive(item.href));

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
          {/* Items primarios */}
          {PRIMARY_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
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
              </Link>
            );
          })}

          {/* Dropdown "Más" */}
          {SECONDARY_ITEMS.length > 0 && (
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
                <div className="absolute top-full right-0 z-50 mt-1 w-48 rounded-lg border bg-white py-1 shadow-lg dark:bg-zinc-950">
                  {SECONDARY_ITEMS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMoreOpen(false)} // ← cierra al navegar
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors",
                          isActive(item.href)
                            ? "bg-blue-50 text-blue-600"
                            : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Derecha: usuario + hamburguesa mobile */}
        <div className="flex items-center gap-3">
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
            {ALL_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)} // ← cierra al navegar
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive(item.href)
                      ? "bg-blue-50 text-blue-600"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </header>
  );
}
