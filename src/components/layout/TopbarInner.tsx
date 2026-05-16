"use client";

import { cn } from "@/lib/utils";
import { BcvRateWidget } from "@/components/layout/BcvRateWidget";
import { UserButton } from "@clerk/nextjs";
import type { UserRole } from "@/lib/nav-items";

// ─── Etiqueta de rol ──────────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, string> = {
  OWNER:          "Propietario",
  ADMIN:          "Administrador",
  ACCOUNTANT:     "Contador",
  ADMINISTRATIVE: "Administrativo",
  VIEWER:         "Lector",
  SENIAT:         "Auditor SENIAT",
};

const ROLE_STYLES: Record<UserRole, string> = {
  OWNER:          "bg-violet-50 text-violet-700 border-violet-200",
  ADMIN:          "bg-blue-50   text-blue-700   border-blue-200",
  ACCOUNTANT:     "bg-emerald-50 text-emerald-700 border-emerald-200",
  ADMINISTRATIVE: "bg-amber-50  text-amber-700  border-amber-200",
  VIEWER:         "bg-zinc-100  text-zinc-600   border-zinc-200",
  SENIAT:         "bg-red-50    text-red-700    border-red-200",
};

// ─── TopbarInner ──────────────────────────────────────────────────────────────

type TopbarInnerProps = {
  companyId?: string;
  companyName?: string;
  userRole?: UserRole;
  notificationSlot?: React.ReactNode;
};

export function TopbarInner({
  companyId,
  companyName,
  userRole = "ACCOUNTANT",
  notificationSlot,
}: TopbarInnerProps) {
  return (
    <header className="h-14 bg-white border-b border-zinc-200 flex items-center gap-3 px-5 shrink-0">

      {/* Empresa + rol */}
      {companyName && (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <svg
            className="w-[14px] h-[14px] text-zinc-400 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span className="text-[13px] font-semibold text-zinc-700 truncate">
            {companyName}
          </span>
          <span
            className={cn(
              "text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0",
              ROLE_STYLES[userRole]
            )}
          >
            {ROLE_LABELS[userRole]}
          </span>
        </div>
      )}

      {/* Sin empresa: spacer */}
      {!companyName && <div className="flex-1" />}

      {/* Tasa BCV */}
      {companyId && <BcvRateWidget companyId={companyId} />}

      {/* Notificaciones (slot externo) */}
      {notificationSlot}

      {/* Avatar Clerk */}
      <UserButton />
    </header>
  );
}
