"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { BcvRateWidget } from "@/components/layout/BcvRateWidget";
import { CompanyAvatar } from "@/components/company/CompanyAvatar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { UserButton } from "@clerk/nextjs";
import { AlertTriangle, CheckCircle2, ArrowRight, Search } from "lucide-react";
import { getNavItems, type UserRole } from "@/lib/nav-items";

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

// ─── Period badge ─────────────────────────────────────────────────────────────

const MONTHS_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function PeriodBadge({
  companyId,
  period,
}: {
  companyId: string;
  period: { year: number; month: number; daysOpen: number; isStale: boolean };
}) {
  const monthLabel = `${MONTHS_SHORT[period.month - 1]} ${period.year}`;
  const daysLabel  = period.daysOpen === 0
    ? "abierto hoy"
    : period.daysOpen === 1
      ? "1 día abierto"
      : `${period.daysOpen} días abierto`;

  const daysShort = period.daysOpen === 0 ? "hoy" : `${period.daysOpen}d`;

  return (
    <div className="hidden sm:flex items-center gap-1.5 shrink-0">
      {period.isStale ? (
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden />
      ) : (
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden />
      )}

      <span
        className={cn(
          "text-[13px] font-medium whitespace-nowrap",
          period.isStale ? "text-amber-300" : "text-emerald-300"
        )}
        title={period.isStale
          ? `Período ${monthLabel} — ${daysLabel} (se recomienda cerrar)`
          : `Período ${monthLabel} al día`}
      >
        {monthLabel}
        {period.isStale && (
          <span className="text-amber-400/80 font-normal"> · {daysShort}</span>
        )}
      </span>

      {period.isStale && (
        <Link
          href={`/company/${companyId}/periods`}
          className="hidden xl:flex items-center gap-1 text-[11px] font-semibold text-amber-300 hover:text-white border border-amber-400/40 hover:border-amber-300 rounded px-2 py-0.5 transition-colors shrink-0"
          title="Ir a gestión de períodos"
        >
          Cerrar
          <ArrowRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}

// ─── TopbarInner ──────────────────────────────────────────────────────────────

type TopbarInnerProps = {
  companyId?: string;
  companyName?: string;
  userRole?: UserRole;
  grantedModules?: string[];
  notificationSlot?: React.ReactNode;
  activePeriod?: { year: number; month: number; daysOpen: number; isStale: boolean } | null;
};

export function TopbarInner({
  companyId,
  companyName,
  userRole = "ACCOUNTANT",
  grantedModules,
  notificationSlot,
  activePeriod,
}: TopbarInnerProps) {
  const grants = new Set(grantedModules ?? []);
  const { primary: navPrimary, sections: navSections } = companyId
    ? getNavItems(userRole, companyId, grants)
    : { primary: [], sections: [] };
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const paletteOpenRef = useRef(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  // Keep ref in sync to avoid stale closure in keyboard handler
  useEffect(() => { paletteOpenRef.current = paletteOpen; }, [paletteOpen]);

  useEffect(() => {
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
      }
    }

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []); // empty deps — paletteOpenRef handles currency without re-registering

  return (
    <>
      <header className="sticky top-0 z-40 h-14 bg-slate-800 flex items-center gap-3 px-4 shrink-0">

        {/* Empresa — avatar + nombre + rol */}
        {companyName && companyId && (
          <div className="flex items-center gap-2 min-w-0">
            <CompanyAvatar id={companyId} name={companyName} size="xs" />
            <span className="truncate text-[14px] font-semibold text-white leading-tight max-w-40 lg:max-w-52" title={companyName}>
              {companyName}
            </span>
            <span
              className={cn(
                "hidden lg:inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0",
                ROLE_STYLES[userRole]
              )}
            >
              {ROLE_LABELS[userRole]}
            </span>
          </div>
        )}

        {/* Sin empresa: spacer */}
        {!companyName && <div className="flex-1" />}

        {/* Separador vertical */}
        {companyName && activePeriod && (
          <div className="w-px h-5 bg-slate-600 shrink-0" aria-hidden />
        )}

        {/* Período activo */}
        {activePeriod && companyId && (
          <PeriodBadge companyId={companyId} period={activePeriod} />
        )}

        {/* Spacer empuja derecha */}
        <div className="flex-1" />

        {/* Command palette trigger */}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="hidden md:flex items-center gap-2 rounded-md border border-slate-600 bg-slate-700/50 px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
          title="Abrir paleta de comandos"
          aria-label="Abrir paleta de comandos"
          aria-keyshortcuts="Control+/"
        >
          <Search className="h-3.5 w-3.5" aria-hidden />
          <span>Buscar</span>
          <kbd className="rounded bg-slate-600 px-1 py-0.5 text-[10px] font-mono not-italic">
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
