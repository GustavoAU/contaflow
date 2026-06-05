// src/modules/dashboard/components/ManagerApprovalInbox.tsx
// Q3-4: Mobile-first — caso de uso "Gerente aprueba documentos en móvil".
// Muestra corridas de nómina en DRAFT pendientes de aprobación + otras tareas
// de gestión, con tap targets ≥44px (WCAG 2.5.8) para uso desde teléfono.
// Solo visible para OWNER/ADMIN (requiere ROLES.ADMIN_ONLY a nivel de acción).

import Link from "next/link";
import {
  ClipboardCheckIcon,
  UsersIcon,
  WalletCardsIcon,
  ChevronRightIcon,
  CheckCircle2Icon,
  SunIcon,
} from "lucide-react";
import type { PayrollRunRow } from "@/modules/payroll/services/PayrollRunService";

export type ApprovalInboxData = {
  draftPayrollRuns: PayrollRunRow[];
  draftBudgetsCount: number;
  pendingVacationRequestsCount: number;
};

type Props = {
  companyId: string;
  data: ApprovalInboxData;
};

// ── Money formatter (matches page.tsx fmtBs pattern) ─────────────────────────

function fmtAmount(value: string | number): string {
  const n = Number(value);
  if (isNaN(n)) return "—";
  return n.toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " Bs.";
}

// ── Approval card ─────────────────────────────────────────────────────────────

function ApprovalCard({
  href,
  icon: Icon,
  iconBg,
  title,
  subtitle,
  meta,
  cta,
}: {
  href: string;
  icon: React.ElementType;
  iconBg: string;
  title: string;
  subtitle: string;
  meta?: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border bg-white p-4 transition-colors hover:bg-zinc-50 active:bg-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-1"
      style={{ minHeight: "64px" }} // WCAG 2.5.8: target ≥44px — 64px for comfortable mobile use
    >
      {/* Icono */}
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconBg}`}>
        <Icon className="h-5 w-5" />
      </div>

      {/* Texto */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-zinc-800 leading-tight truncate">{title}</p>
        <p className="mt-0.5 text-xs text-zinc-500 truncate">{subtitle}</p>
        {meta && <p className="mt-0.5 text-xs font-medium text-blue-600">{meta}</p>}
      </div>

      {/* CTA arrow */}
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-xs font-semibold text-blue-600 hidden sm:block">{cta}</span>
        <ChevronRightIcon className="h-4 w-4 text-zinc-400" />
      </div>
    </Link>
  );
}

// ── ManagerApprovalInbox ──────────────────────────────────────────────────────

export function ManagerApprovalInbox({ companyId, data }: Props) {
  const { draftPayrollRuns, draftBudgetsCount, pendingVacationRequestsCount } = data;
  const totalItems = draftPayrollRuns.length + draftBudgetsCount + pendingVacationRequestsCount;

  if (totalItems === 0) return null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
          <ClipboardCheckIcon className="h-4 w-4 text-blue-500" aria-hidden />
          Aprobaciones pendientes
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
            {totalItems}
          </span>
        </h2>
        <Link
          href={`/company/${companyId}/payroll/runs`}
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          Ver nóminas →
        </Link>
      </div>

      {/* Payroll runs in DRAFT */}
      {draftPayrollRuns.map((run) => {
        // periodStart is "YYYY-MM-DD" — extract "YYYY-MM" for display
        const periodLabel = run.periodStart ? run.periodStart.slice(0, 7) : "—";
        const net = fmtAmount(run.totalNet ?? "0");
        return (
          <ApprovalCard
            key={run.id}
            href={`/company/${companyId}/payroll/runs/${run.id}`}
            icon={UsersIcon}
            iconBg="bg-amber-50 text-amber-600"
            title={`Nómina ${periodLabel}`}
            subtitle={`${run.employeeCount ?? 0} empleado${(run.employeeCount ?? 0) !== 1 ? "s" : ""}`}
            meta={`Neto total: ${net}`}
            cta="Aprobar"
          />
        );
      })}

      {/* Draft budgets needing activation */}
      {draftBudgetsCount > 0 && (
        <ApprovalCard
          href={`/company/${companyId}/budgets`}
          icon={WalletCardsIcon}
          iconBg="bg-violet-50 text-violet-600"
          title={`${draftBudgetsCount} presupuesto${draftBudgetsCount !== 1 ? "s" : ""} en borrador`}
          subtitle="Pendientes de activación"
          cta="Revisar"
        />
      )}

      {/* Vacation requests pending approval */}
      {pendingVacationRequestsCount > 0 && (
        <ApprovalCard
          href={`/company/${companyId}/payroll/vacation-requests`}
          icon={SunIcon}
          iconBg="bg-amber-50 text-amber-600"
          title={`${pendingVacationRequestsCount} solicitud${pendingVacationRequestsCount !== 1 ? "es" : ""} de vacaciones`}
          subtitle="Pendientes de aprobación"
          cta="Revisar"
        />
      )}

      {/* Empty state for next check */}
      {totalItems === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-green-100 bg-green-50 px-4 py-3">
          <CheckCircle2Icon className="h-4 w-4 text-green-500 shrink-0" />
          <p className="text-sm text-green-700">Sin aprobaciones pendientes</p>
        </div>
      )}
    </div>
  );
}
