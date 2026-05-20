"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { BcvRateWidget } from "@/components/layout/BcvRateWidget";
import { CompanyAvatar } from "@/components/company/CompanyAvatar";
import { UserButton } from "@clerk/nextjs";
import { AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import type { UserRole } from "@/lib/nav-items";

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

  return (
    <div className="hidden sm:flex items-center gap-2 shrink-0">
      {period.isStale ? (
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden />
      ) : (
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden />
      )}

      <span
        className={cn(
          "text-[13px] font-medium",
          period.isStale ? "text-amber-300" : "text-emerald-300"
        )}
        title={period.isStale ? "Período con más de 30 días abierto — se recomienda cerrar" : "Período contable al día"}
      >
        Período: {monthLabel}
        {period.isStale && (
          <span className="text-amber-400/80 font-normal"> — {daysLabel}</span>
        )}
      </span>

      {period.isStale && (
        <Link
          href={`/company/${companyId}/periods`}
          className="flex items-center gap-1 text-[11px] font-semibold text-amber-300 hover:text-white border border-amber-400/40 hover:border-amber-300 rounded px-2 py-0.5 transition-colors shrink-0"
          title="Ir a gestión de períodos"
        >
          Cerrar período
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
  notificationSlot?: React.ReactNode;
  activePeriod?: { year: number; month: number; daysOpen: number; isStale: boolean } | null;
};

export function TopbarInner({
  companyId,
  companyName,
  userRole = "ACCOUNTANT",
  notificationSlot,
  activePeriod,
}: TopbarInnerProps) {
  return (
    <header className="sticky top-0 z-40 h-12 bg-slate-800 flex items-center gap-3 px-4 shrink-0">

      {/* Empresa — avatar + nombre + rol */}
      {companyName && companyId && (
        <div className="flex items-center gap-2 min-w-0">
          <CompanyAvatar id={companyId} name={companyName} size="xs" />
          <span className="truncate text-[15px] font-semibold text-white leading-tight max-w-[220px]">
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
  );
}
