"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  LogOut,
  Settings,
  ShieldCheck,
  PlusIcon,
  LayoutGrid,
} from "lucide-react";
import { getNavItems, type UserRole } from "@/lib/nav-items";
import { usePageTransition } from "@/components/layout/PageTransitionProvider";
import { CompanyAvatar } from "@/components/company/CompanyAvatar";
import type { LucideIcon } from "lucide-react";

const STORAGE_KEY = "cf-sidebar-collapsed";

const ROLE_LABELS: Record<UserRole, string> = {
  OWNER:          "Propietario",
  ADMIN:          "Administrador",
  ACCOUNTANT:     "Contador",
  ADMINISTRATIVE: "Administrativo",
  VIEWER:         "Lector",
  SENIAT:         "SENIAT",
};

// ─── NavLink ──────────────────────────────────────────────────────────────────

function NavLink({
  href,
  className,
  title,
  children,
  onNavigate,
}: {
  href: string;
  className: string;
  title?: string;
  children: React.ReactNode;
  onNavigate?: () => void;
}) {
  const { navigate } = usePageTransition();
  return (
    <Link
      href={href}
      className={className}
      title={title}
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

// ─── SidebarItem ──────────────────────────────────────────────────────────────

function SidebarItem({
  href,
  Icon,
  label,
  active,
  collapsed,
  badge,
  disabled,
}: {
  href: string;
  Icon: LucideIcon;
  label: string;
  active: boolean;
  collapsed: boolean;
  badge?: string;
  disabled?: boolean;
}) {
  const cls = cn(
    "flex items-center gap-2.5 w-full px-2 py-[7px] rounded-md text-[13px] font-medium",
    "transition-colors overflow-hidden whitespace-nowrap",
    collapsed && "justify-center",
    active
      ? "bg-blue-50 text-blue-600 font-semibold"
      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
    disabled && "pointer-events-none opacity-40"
  );

  const inner = (
    <>
      <Icon className="w-[15px] h-[15px] shrink-0" />
      {!collapsed && (
        <span className="overflow-hidden text-ellipsis flex-1">{label}</span>
      )}
      {!collapsed && badge && (
        <span className="ml-auto text-[10px] font-bold bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full shrink-0">
          {badge}
        </span>
      )}
    </>
  );

  if (disabled) {
    return (
      <div className={cls} title={collapsed ? label : undefined}>
        {inner}
      </div>
    );
  }

  return (
    <NavLink href={href} className={cls} title={collapsed ? label : undefined}>
      {inner}
    </NavLink>
  );
}

// ─── LogoutButton ─────────────────────────────────────────────────────────────

function LogoutButton({ collapsed }: { collapsed: boolean }) {
  const { signOut } = useClerk();
  return (
    <button
      onClick={() => signOut({ redirectUrl: "/sign-in" })}
      title={collapsed ? "Cerrar sesión" : undefined}
      className={cn(
        "flex items-center gap-2.5 w-full px-2 py-[7px] rounded-md text-[13px] font-medium",
        "text-zinc-500 hover:bg-red-50 hover:text-red-600 transition-colors",
        "overflow-hidden whitespace-nowrap",
        collapsed && "justify-center"
      )}
    >
      <LogOut className="w-[15px] h-[15px] shrink-0" />
      {!collapsed && <span>Cerrar sesión</span>}
    </button>
  );
}

// ─── CompanySwitcher ──────────────────────────────────────────────────────────

type CompanyEntry = { id: string; name: string; role: UserRole };

function CompanySwitcher({
  companies,
  currentCompanyId,
  collapsed,
}: {
  companies: CompanyEntry[];
  currentCompanyId: string;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const { navigate } = usePageTransition();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest("[data-co-sw]")) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setDropPos({
        top: r.bottom + 4,
        left: collapsed ? r.right + 8 : r.left,
        width: collapsed ? 228 : r.width,
      });
    }
    setOpen((v) => !v);
  };

  const goTo = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  const current = companies.find((c) => c.id === currentCompanyId);
  if (!current) return null;

  return (
    <div data-co-sw className="px-2 py-2 border-b border-zinc-100 shrink-0">
      <button
        ref={btnRef}
        onClick={handleToggle}
        title={collapsed ? current.name : undefined}
        aria-label="Cambiar empresa"
        className={cn(
          "flex items-center gap-2 w-full rounded-md px-1.5 py-1.5",
          "hover:bg-zinc-100 transition-colors text-left",
          collapsed && "justify-center"
        )}
      >
        <CompanyAvatar id={current.id} name={current.name} size="sm" />
        {!collapsed && (
          <>
            <span className="flex-1 text-[13px] font-semibold text-zinc-800 truncate leading-tight min-w-0">
              {current.name}
            </span>
            <ChevronDown
              className={cn(
                "w-3.5 h-3.5 text-zinc-400 shrink-0 transition-transform duration-150",
                open && "rotate-180"
              )}
            />
          </>
        )}
      </button>

      {open &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            data-co-sw
            style={{
              position: "fixed",
              top: dropPos.top,
              left: dropPos.left,
              width: Math.max(dropPos.width, 228),
              zIndex: 9999,
            }}
            className="bg-white border border-zinc-200 rounded-xl shadow-xl py-1.5 overflow-hidden"
          >
            <p className="px-3 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-[1px] text-zinc-400">
              Mis Empresas
            </p>

            {companies.map((co) => (
              <button
                key={co.id}
                onClick={() => goTo(`/company/${co.id}`)}
                className={cn(
                  "flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors",
                  co.id === currentCompanyId ? "bg-blue-50" : "hover:bg-zinc-50"
                )}
              >
                <CompanyAvatar id={co.id} name={co.name} size="xs" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-zinc-800 truncate leading-tight">
                    {co.name}
                  </p>
                  <p className="text-[11px] text-zinc-400">{ROLE_LABELS[co.role]}</p>
                </div>
                {co.id === currentCompanyId && (
                  <Check className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                )}
              </button>
            ))}

            <div className="h-px bg-zinc-100 my-1" />

            <button
              onClick={() => goTo("/company/new")}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-zinc-500 hover:bg-zinc-50 transition-colors"
            >
              <PlusIcon className="w-3.5 h-3.5 shrink-0" />
              Agregar empresa
            </button>
            <button
              onClick={() => goTo("/dashboard")}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-zinc-500 hover:bg-zinc-50 transition-colors"
            >
              <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
              Ver todas las empresas
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

type SidebarProps = {
  companyId?: string;
  userRole?: UserRole;
  grantedModules?: string[];
  companies?: CompanyEntry[];
};

export function Sidebar({
  companyId,
  userRole = "ACCOUNTANT",
  grantedModules,
  companies = [],
}: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "true") setCollapsed(true);
    } catch {}
  }, []);

  const toggle = () =>
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {}
      return next;
    });

  const grants = new Set(grantedModules ?? []);
  const { primary, sections } = companyId
    ? getNavItems(userRole, companyId, grants)
    : { primary: [], sections: [] };

  const isActive = (href: string) =>
    href === `/company/${companyId}`
      ? pathname === href
      : pathname.startsWith(href);

  return (
    <aside
      className={cn(
        "flex flex-col sticky top-0 h-screen bg-white border-r border-zinc-200",
        "transition-[width] duration-200 ease-in-out overflow-hidden shrink-0",
        collapsed ? "w-14" : "w-[232px]"
      )}
    >
      {/* Logo + collapse toggle */}
      <div className="flex items-center gap-2 h-14 px-3.5 border-b border-zinc-200 shrink-0">
        <Link
          href="/dashboard"
          className="w-7 h-7 bg-blue-500 rounded-lg grid place-items-center text-white text-[14px] shrink-0 shadow-[0_2px_8px_rgba(59,130,246,.3)] hover:bg-blue-600 transition-colors"
          title="ContaFlow"
        >
          ⚡
        </Link>

        {!collapsed && (
          <Link
            href="/dashboard"
            className="font-extrabold text-[15px] tracking-tight whitespace-nowrap overflow-hidden hover:opacity-80 transition-opacity"
          >
            Conta<span className="text-blue-500">Flow</span>
          </Link>
        )}

        <button
          onClick={toggle}
          title={collapsed ? "Expandir menú" : "Colapsar menú"}
          aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
          className={cn(
            "w-6 h-6 rounded-md border border-zinc-200 bg-zinc-50 grid place-items-center",
            "hover:bg-zinc-100 transition-colors shrink-0",
            !collapsed && "ml-auto"
          )}
        >
          {collapsed
            ? <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
            : <ChevronLeft  className="w-3.5 h-3.5 text-zinc-500" />}
        </button>
      </div>

      {/* Company switcher */}
      {companyId && companies.length > 0 && (
        <CompanySwitcher
          companies={companies}
          currentCompanyId={companyId}
          collapsed={collapsed}
        />
      )}

      {/* Nav scrollable */}
      <nav
        className={cn(
          "flex-1 overflow-y-auto overflow-x-hidden py-1.5",
          "[scrollbar-width:thin] [scrollbar-color:theme(colors.zinc.200)_transparent]"
        )}
        aria-label="Navegación principal"
      >
        {/* Items primarios */}
        <div className="px-2">
          {primary.map((item) => (
            <SidebarItem
              key={item.href}
              href={item.href}
              Icon={item.icon}
              label={item.label}
              active={isActive(item.href)}
              collapsed={collapsed}
            />
          ))}
        </div>

        {/* Secciones agrupadas */}
        {sections.map((section) => (
          <div key={section.group} className="px-2">
            <div className="h-px bg-zinc-100 mx-1 my-1.5" />
            {!collapsed && (
              <p className="px-2 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-[0.85px] text-zinc-400">
                {section.group}
              </p>
            )}
            {section.items.map((item) => (
              <SidebarItem
                key={item.href}
                href={item.href}
                Icon={item.icon}
                label={item.label}
                active={isActive(item.href)}
                collapsed={collapsed}
                disabled={item.comingSoon}
                badge={item.comingSoon ? "Pronto" : undefined}
              />
            ))}
          </div>
        ))}

        {/* Configuración + Auditoría — siguen al último ítem del nav */}
        {companyId && (
          <div className="px-2">
            <div className="h-px bg-zinc-100 mx-1 my-1.5" />
            <SidebarItem
              href={`/company/${companyId}/settings`}
              Icon={Settings}
              label="Configuración"
              active={pathname.startsWith(`/company/${companyId}/settings`)}
              collapsed={collapsed}
            />
            <SidebarItem
              href={`/company/${companyId}/audit-log`}
              Icon={ShieldCheck}
              label="Auditoría"
              active={pathname.startsWith(`/company/${companyId}/audit-log`)}
              collapsed={collapsed}
            />
          </div>
        )}
      </nav>

      {/* Footer: solo logout — siempre visible al fondo */}
      <div className="px-2 py-2 border-t border-zinc-100 shrink-0">
        <LogoutButton collapsed={collapsed} />
      </div>
    </aside>
  );
}
