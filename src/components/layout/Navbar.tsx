// src/components/layout/Navbar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { LayoutDashboard, BookOpen, FileText, BarChart3, Settings } from "lucide-react";

type NavbarProps = {
  companyId?: string;
  companyName?: string;
};

export function Navbar({ companyId, companyName }: NavbarProps) {
  const pathname = usePathname();
  const t = useTranslations("nav");

  const NAV_ITEMS = companyId
    ? [
        { label: t("dashboard"), href: `/company/${companyId}`, icon: LayoutDashboard },
        { label: t("accounts"), href: `/company/${companyId}/accounts`, icon: BookOpen },
        { label: t("transactions"), href: `/company/${companyId}/transactions`, icon: FileText },
        { label: t("reports"), href: `/company/${companyId}/reports`, icon: BarChart3 },
        { label: t("settings"), href: `/company/${companyId}/settings`, icon: Settings },
      ]
    : [];

  return (
    <header className="border-b bg-white dark:bg-zinc-950">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight">
            Conta<span className="text-blue-600">Flow</span>
          </span>
          {companyName && (
            <span className="text-muted-foreground hidden text-sm md:block">— {companyName}</span>
          )}
        </Link>

        {/* Nav links */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === `/company/${companyId}`
                ? pathname === item.href
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Usuario */}
        <div className="flex items-center gap-3">
          <UserButton />
        </div>
      </div>
    </header>
  );
}
