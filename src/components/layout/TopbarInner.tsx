"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { BcvRateWidget } from "@/components/layout/BcvRateWidget";
import { CompanyAvatar } from "@/components/company/CompanyAvatar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { UserButton } from "@clerk/nextjs";
import { Search } from "lucide-react";
import { getNavItems, type UserRole } from "@/lib/nav-items";
import { usePageTransition } from "@/components/layout/PageTransitionProvider";

// ─── Role label / badge ───────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, string> = {
  OWNER:          "Propietario",
  ADMIN:          "Administrador",
  ACCOUNTANT:     "Contador",
  ADMINISTRATIVE: "Administrativo",
  VIEWER:         "Lector",
  SENIAT:         "Auditor SENIAT",
};

const ROLE_STYLES: Record<UserRole, string> = {
  OWNER:          "bg-violet-500/20 text-violet-300 border-violet-500/30",
  ADMIN:          "bg-blue-500/20   text-blue-300   border-blue-500/30",
  ACCOUNTANT:     "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  ADMINISTRATIVE: "bg-amber-500/20  text-amber-300  border-amber-500/30",
  VIEWER:         "bg-white/10      text-slate-300  border-white/20",
  SENIAT:         "bg-red-500/20    text-red-300    border-red-500/30",
};

// ─── TopbarInner ──────────────────────────────────────────────────────────────

type TopbarInnerProps = {
  companyId?: string;
  companyName?: string;
  userRole?: UserRole;
  grantedModules?: string[];
  notificationSlot?: React.ReactNode;
  /** @deprecated — ya no se muestra en el header; el layout sigue pasándolo por compatibilidad */
  activePeriod?: { year: number; month: number; daysOpen: number; isStale: boolean } | null;
};

export function TopbarInner({
  companyId,
  companyName,
  userRole = "ACCOUNTANT",
  grantedModules,
  notificationSlot,
  activePeriod: _activePeriod, // recibido por compatibilidad, no usado en header
}: TopbarInnerProps) {
  const grants = new Set(grantedModules ?? []);
  const { primary: navPrimary, sections: navSections } = companyId
    ? getNavItems(userRole, companyId, grants)
    : { primary: [], sections: [] };
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const paletteOpenRef = useRef(false);
  const { navigate } = usePageTransition();

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  // Keep ref in sync to avoid stale closure in keyboard handler
  useEffect(() => { paletteOpenRef.current = paletteOpen; }, [paletteOpen]);

  useEffect(() => {
    // Q3-6: helpers para validar si el foco está en un campo de escritura
    function isTypingTarget(el: Element | null): boolean {
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    }

    function handler(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+/ → toggle command palette
      if (ctrl && e.key === "/") {
        e.preventDefault();
        setPaletteOpen(o => !o);
        return;
      }

      // Esc → close palette (also handled inside palette; this catches edge cases)
      if (e.key === "Escape" && paletteOpenRef.current) {
        setPaletteOpen(false);
        return;
      }

      // Ctrl+Enter → submit the active form (skip when palette is open)
      if (ctrl && e.key === "Enter" && !paletteOpenRef.current) {
        const active = document.activeElement;
        const form = active?.closest("form") ?? document.querySelector("form");
        const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]:not([disabled])');
        if (submit) {
          e.preventDefault();
          submit.click();
        }
        return;
      }

      // Ctrl+S → guardar borrador (mismo efecto que Ctrl+Enter)
      // aria-keyshortcuts="Control+s" documentado en botones submit de formularios fiscales
      if (ctrl && e.key === "s" && !paletteOpenRef.current) {
        const active = document.activeElement;
        const form = active?.closest("form") ?? document.querySelector("form");
        const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]:not([disabled])');
        if (submit) {
          e.preventDefault();
          submit.click();
        }
        return;
      }

      // Q3-6: "n" → nueva factura (solo si no se está escribiendo en un campo)
      // aria-keyshortcuts="n" — shortcut de teclado global para creación rápida
      if (e.key === "n" && !ctrl && !e.altKey && !paletteOpenRef.current) {
        if (isTypingTarget(document.activeElement)) return;
        if (companyId) {
          e.preventDefault();
          navigate(`/company/${companyId}/invoices/new`);
        }
        return;
      }
    }

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [companyId, navigate]); // navigate es estable (useCallback), companyId raramente cambia

  return (
    <>
      <header className="sticky top-0 z-40 h-14 bg-slate-800 flex items-center gap-3 px-4 shrink-0">

        {/* Empresa — avatar + nombre + rol */}
        {companyName && companyId && (
          <div className="flex items-center gap-2 min-w-0">
            <CompanyAvatar id={companyId} name={companyName} size="xs" />
            <span className="truncate text-sm font-semibold text-white leading-tight max-w-40 lg:max-w-52" title={companyName}>
              {companyName}
            </span>
            <span
              className={cn(
                "hidden lg:inline-flex text-10 font-bold px-2 py-0.5 rounded-full border shrink-0",
                ROLE_STYLES[userRole]
              )}
            >
              {ROLE_LABELS[userRole]}
            </span>
          </div>
        )}

        {/* Sin empresa: spacer */}
        {!companyName && <div className="flex-1" />}

        {/* Spacer empuja derecha */}
        <div className="flex-1" />

        {/* Command palette trigger */}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="hidden md:flex items-center gap-2 rounded-md border border-slate-600 bg-slate-700/50 px-2.5 py-1 text-xs text-slate-300 hover:text-slate-200 hover:border-slate-500 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-800"
          title="Abrir paleta de comandos"
          aria-label="Abrir paleta de comandos"
          aria-keyshortcuts="Control+/"
        >
          <Search className="h-3.5 w-3.5" aria-hidden />
          <span>Buscar</span>
          <kbd className="rounded bg-slate-600 px-1 py-0.5 text-10 font-mono not-italic">
            Ctrl+/
          </kbd>
        </button>

        {/* Tasa BCV */}
        {companyId && <BcvRateWidget companyId={companyId} variant="dark" />}

        {/* Notificaciones (slot externo) */}
        {notificationSlot}

        {/* Avatar Clerk */}
        <UserButton
          appearance={{
            elements: {
              userButtonAvatarBox: "ring-1 ring-white/20",
            },
          }}
        />
      </header>

      {/* Command palette — portaled to body so it overlays everything */}
      {mounted && createPortal(
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          sections={navSections}
          primary={navPrimary}
        />,
        document.body
      )}
    </>
  );
}
