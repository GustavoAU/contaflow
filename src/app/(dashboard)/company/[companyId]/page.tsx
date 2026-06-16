// src/app/(dashboard)/company/[companyId]/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { fmtBs } from "@/lib/fmt-ven";
import { getUserCompaniesAction } from "@/modules/auth/actions/user.actions";
import { getDashboardMetricsAction } from "@/modules/accounting/actions/dashboard.actions";
import { getKpiDashboardAction } from "@/modules/analytics/actions/kpi-dashboard.actions";
import { ExecutiveKpiPanel } from "@/modules/analytics/components/ExecutiveKpiPanel";
import {
  BookOpenIcon,
  FileTextIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  ScaleIcon,
  CalendarIcon,
  PlusIcon,
  AlertCircleIcon,
  ReceiptTextIcon,
  WalletIcon,
  LandmarkIcon,
  PackageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SetupWizardTrigger } from "@/components/onboarding/SetupWizardTrigger";
import { ROLE_LABELS, canAccess, ROLES } from "@/lib/auth-helpers";
import type { UserRole } from "@/lib/nav-items";
import { getPendingTasksAction } from "@/modules/dashboard/actions/pending-tasks.actions";
import { PendingTasksWidget } from "@/modules/dashboard/components/PendingTasksWidget";
import { getVacationAlertsAction } from "@/modules/payroll/actions/nom-d.actions";
import { getP2034CountersAction } from "@/modules/analytics/actions/p2034-counters.actions";
import { P2034Widget } from "@/modules/analytics/components/P2034Widget";
import { PaymentSuccessToast } from "@/components/billing/PaymentSuccessToast";
import { FiscalDeadlineWidget } from "@/modules/dashboard/components/FiscalDeadlineWidget";
import { ManagerApprovalInbox } from "@/modules/dashboard/components/ManagerApprovalInbox";
import { getPayrollRunsAction } from "@/modules/payroll/actions/payroll-run.actions";
import { listBudgetsAction } from "@/modules/budgets/actions/budget.actions";
import { VacationRequestService } from "@/modules/payroll/services/VacationRequestService";
import { DespachoOnboardingBanner } from "@/modules/despacho/components/DespachoOnboardingBanner";
import { getDespachoStatusAction } from "@/modules/despacho/actions/despacho.actions";
import { getSubscriptionState } from "@/modules/billing/services/SubscriptionService";

type Props = {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ payment?: string }>;
};

const MONTH_NAMES = [
  "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// ─── Badge de rol ─────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<UserRole, string> = {
  OWNER:          "bg-purple-100 text-purple-700",
  ADMIN:          "bg-blue-100 text-blue-700",
  ACCOUNTANT:     "bg-green-100 text-green-700",
  ADMINISTRATIVE: "bg-amber-100 text-amber-700",
  VIEWER:         "bg-zinc-100 text-zinc-600",
  SENIAT:         "bg-red-100 text-red-700",
};

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_COLORS[role]}`}>
      {ROLE_LABELS[role]}
    </span>
  );
}

// ─── CTAs según rol ───────────────────────────────────────────────────────────

function DashboardCTA({ role, companyId }: { role: UserRole; companyId: string }) {
  if (role === "ADMINISTRATIVE") {
    return (
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/company/${companyId}/invoices`} className="gap-2">
            <ReceiptTextIcon className="h-4 w-4" />
            Facturas
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href={`/company/${companyId}/payments`} className="gap-2">
            <WalletIcon className="h-4 w-4" />
            Registrar Pago
          </Link>
        </Button>
      </div>
    );
  }

  if (role === "VIEWER") {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={`/company/${companyId}/reports`} className="gap-2">
          <ScaleIcon className="h-4 w-4" />
          Ver Reportes
        </Link>
      </Button>
    );
  }

  // OWNER, ADMIN, ACCOUNTANT
  return (
    <div className="flex gap-2">
      <Button asChild>
        <Link href={`/company/${companyId}/transactions/new`} className="gap-2">
          <PlusIcon className="h-4 w-4" />
          Nuevo Asiento
        </Link>
      </Button>
      {(role === "OWNER" || role === "ADMIN") && (
        <Button asChild variant="outline">
          <Link href={`/company/${companyId}/invoices`} className="gap-2">
            <ReceiptTextIcon className="h-4 w-4" />
            Facturas
          </Link>
        </Button>
      )}
    </div>
  );
}

// ─── Accesos rápidos por rol ──────────────────────────────────────────────────

function QuickAccess({ role, companyId }: { role: UserRole; companyId: string }) {
  type QuickLink = { label: string; href: string; icon: React.ElementType; color: string };

  const accountingLinks: QuickLink[] = [
    { label: "Asientos", href: `/company/${companyId}/transactions`, icon: FileTextIcon, color: "text-purple-500" },
    { label: "Plan de Cuentas", href: `/company/${companyId}/accounts`, icon: BookOpenIcon, color: "text-blue-500" },
    { label: "Libros IVA", href: `/company/${companyId}/invoices`, icon: ReceiptTextIcon, color: "text-green-500" },
    { label: "Retenciones", href: `/company/${companyId}/retentions`, icon: FileTextIcon, color: "text-orange-500" },
    { label: "Conciliación", href: `/company/${companyId}/bank-reconciliation`, icon: LandmarkIcon, color: "text-indigo-500" },
    { label: "Declaración IVA", href: `/company/${companyId}/iva-declaration`, icon: ScaleIcon, color: "text-red-500" },
    { label: "Cal. Fiscal", href: `/company/${companyId}/fiscal-calendar`, icon: CalendarIcon, color: "text-cyan-500" },
  ];

  const operationsLinks: QuickLink[] = [
    { label: "Facturas", href: `/company/${companyId}/invoices`, icon: ReceiptTextIcon, color: "text-green-500" },
    { label: "Pagos", href: `/company/${companyId}/payments`, icon: WalletIcon, color: "text-blue-500" },
    { label: "Por Cobrar", href: `/company/${companyId}/receivables`, icon: TrendingUpIcon, color: "text-emerald-500" },
    { label: "Por Pagar", href: `/company/${companyId}/payables`, icon: TrendingDownIcon, color: "text-red-500" },
    { label: "Conciliación", href: `/company/${companyId}/bank-reconciliation`, icon: LandmarkIcon, color: "text-indigo-500" },
    { label: "Inventario", href: "#", icon: PackageIcon, color: "text-zinc-400" },
  ];

  const links =
    role === "ADMINISTRATIVE"
      ? operationsLinks
      : role === "VIEWER"
        ? accountingLinks.slice(0, 4)
        : accountingLinks;

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase tracking-wider">
        Accesos rápidos
      </h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
        {links.map((link) => {
          const Icon = link.icon;
          const isDisabled = link.href === "#";
          if (isDisabled) {
            return (
              <div
                key={link.label}
                className="flex flex-col items-center gap-1.5 rounded-lg border bg-white p-3 opacity-50 cursor-not-allowed"
              >
                <Icon className={`h-5 w-5 ${link.color}`} />
                <span className="text-center text-xs text-zinc-500">{link.label}</span>
                {/* WCAG 1.4.3: text-zinc-600 (7.4:1 sobre zinc-100) reemplaza text-zinc-400 (2.55:1) */}
                <span className="rounded bg-zinc-100 px-1 text-9 text-zinc-600">Pronto</span>
              </div>
            );
          }
          return (
            <Link
              key={link.label}
              href={link.href}
              className="flex flex-col items-center gap-1.5 rounded-lg border bg-white p-3 transition-colors hover:bg-blue-50 hover:border-blue-200 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-1"
            >
              <Icon className={`h-5 w-5 ${link.color}`} />
              <span className="text-center text-xs text-zinc-600">{link.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default async function CompanyDashboardPage({ params, searchParams }: Props) {
  const { companyId } = await params;
  const { payment } = await searchParams;

  const companies = await getUserCompaniesAction();
  const company = companies.find((c) => c.id === companyId);
  if (!company) redirect("/dashboard");

  const role = (company.role ?? "ACCOUNTANT") as UserRole;

  const metricsResult = await getDashboardMetricsAction(companyId);
  if (!metricsResult.success) redirect("/dashboard");

  const m = metricsResult.data;
  const showAccountingMetrics = role !== "ADMINISTRATIVE";
  const showKpis = canAccess(role, ROLES.ACCOUNTING);

  // Fetch KPI data for accounting roles (non-blocking — falls back gracefully)
  const kpiResult = showKpis ? await getKpiDashboardAction(companyId) : null;

  // Fetch pending tasks for ACCOUNTING+ roles (non-blocking — falls back gracefully)
  const pendingTasksResult = showKpis ? await getPendingTasksAction(companyId) : null;

  // Fetch vacation alerts + payroll drafts + budgets + vacation requests for ADMIN+ roles only
  const isAdmin = canAccess(role, ROLES.ADMIN_ONLY);
  const [vacationAlertsResult, p2034Result, payrollRunsResult, budgetsResult, pendingVacationCount] = await Promise.all([
    isAdmin ? getVacationAlertsAction(companyId) : Promise.resolve(null),
    isAdmin ? getP2034CountersAction(companyId) : Promise.resolve(null),
    // Q3-4 ManagerApprovalInbox: corridas de nómina DRAFT para aprobación del gerente
    isAdmin ? getPayrollRunsAction(companyId) : Promise.resolve(null),
    isAdmin ? listBudgetsAction(companyId) : Promise.resolve(null),
    isAdmin ? VacationRequestService.pendingCount(companyId) : Promise.resolve(0),
  ]);
  const vacationAlerts = vacationAlertsResult?.success ? vacationAlertsResult.data : [];
  const p2034Data = p2034Result?.success ? p2034Result.data : [];
  // Q3-4: approvalInboxData — corridas DRAFT + presupuestos DRAFT
  const draftPayrollRuns = payrollRunsResult?.success
    ? payrollRunsResult.data.filter((r) => r.status === "DRAFT")
    : [];
  const draftBudgetsCount = budgetsResult?.success
    ? budgetsResult.data.filter((b) => b.status === "DRAFT").length
    : 0;
  const pendingVacationRequestsCount = pendingVacationCount ?? 0;

  // Fetch despacho status para banner onboarding (ADR-034) — solo si es DESPACHO y OWNER/ADMIN
  const despachoStatus =
    company.scopeProfile === "DESPACHO" && isAdmin
      ? await getDespachoStatusAction(companyId)
      : null;
  const showDespachoOnboarding =
    despachoStatus?.success && !despachoStatus.despachoTier;

  // Estado de suscripción — banner de solo lectura si venció
  const subscriptionState = await getSubscriptionState(companyId);

  const openDays = m.activePeriod
    // eslint-disable-next-line react-hooks/purity -- Server Component, no re-render risk
    ? Math.floor((Date.now() - new Date(m.activePeriod.openedAt).getTime()) / 86_400_000)
    : 0;
  const isStale = openDays > 30;
  // Detectar si el período activo está retrasado respecto al calendario actual
  const nowDate = new Date();
  const calMonth = nowDate.getMonth() + 1;
  const calYear = nowDate.getFullYear();
  const isPeriodBehind = m.activePeriod && (
    m.activePeriod.year < calYear ||
    (m.activePeriod.year === calYear && m.activePeriod.month < calMonth)
  );

  return (
    <div className="space-y-6">
      <PaymentSuccessToast payment={payment} />

      {/* ─── Encabezado ─────────────────────────────────────────────────── */}
      {/* Q3-4: flex-col en mobile, flex-row a partir de sm */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight truncate">{company.name}</h1>
            <RoleBadge role={role} />
            {/* Pill de período — siempre visible junto al nombre de empresa */}
            {showAccountingMetrics && m.activePeriod && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0 ${
                isPeriodBehind
                  ? "bg-red-100 text-red-700"
                  : isStale
                  ? "bg-amber-100 text-amber-700"
                  : "bg-green-100 text-green-700"
              }`}>
                <CalendarIcon className="h-3 w-3" />
                {MONTH_NAMES[m.activePeriod.month]} {m.activePeriod.year}
                {isPeriodBehind && " · VENCIDO"}
              </span>
            )}
          </div>
          {company.rif && <p className="text-muted-foreground mt-0.5 text-sm">RIF: {company.rif}</p>}
        </div>
        {/* Q3-4: flex-wrap para que los botones apilen si no caben en mobile */}
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          {/* Guía de configuración — visible para OWNER/ADMIN */}
          {(role === "OWNER" || role === "ADMIN") && (
            <SetupWizardTrigger
              companyId={companyId}
              companyName={company.name}
              companyRif={company.rif ?? null}
              hasAccounts={m.totalAccounts > 0}
              hasPeriod={!!m.activePeriod}
            />
          )}
          <DashboardCTA role={role} companyId={companyId} />
        </div>
      </div>

      {/* ─── Alerta: sin período abierto (solo contable) ─────────────────── */}
      {showAccountingMetrics && !m.activePeriod && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertCircleIcon className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">No hay período contable abierto</p>
            <p className="mt-0.5 text-xs text-amber-700">
              No podrás registrar asientos hasta abrir un período.
            </p>
          </div>
          {(role === "OWNER" || role === "ADMIN") && (
            <Button
              asChild
              size="sm"
              variant="outline"
              className="border-amber-300 text-amber-700 hover:bg-amber-100"
            >
              <Link href={`/company/${companyId}/settings`}>Abrir Período</Link>
            </Button>
          )}
        </div>
      )}

      {/* ─── Período activo ──────────────────────────────────────────────── */}
      {showAccountingMetrics && m.activePeriod && (isPeriodBehind ? (
          /* CRÍTICO: período retrasado — el usuario podría registrar en el mes incorrecto */
          <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3">
            <AlertCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-800">
                Atención: estás registrando en{" "}
                <strong>{MONTH_NAMES[m.activePeriod.month]} {m.activePeriod.year}</strong>,
                no en {MONTH_NAMES[calMonth]} {calYear}
              </p>
              <p className="mt-0.5 text-xs text-red-700">
                El período contable activo es {MONTH_NAMES[m.activePeriod.month]}.
                Todos los asientos y facturas nuevos se registrarán en ese mes.
                Cierra el período y abre {MONTH_NAMES[calMonth]} para operar correctamente.
              </p>
            </div>
            {(role === "OWNER" || role === "ADMIN") && (
              <Button
                asChild
                size="sm"
                className="shrink-0 bg-red-600 text-white hover:bg-red-700 border-0"
              >
                <Link href={`/company/${companyId}/settings`}>Cerrar Período</Link>
              </Button>
            )}
          </div>
        ) : isStale ? (
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertCircleIcon className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">
                Período {MONTH_NAMES[m.activePeriod.month]} {m.activePeriod.year} lleva {openDays} días abierto
              </p>
              <p className="mt-0.5 text-xs text-amber-700">
                Los períodos contables deben cerrarse al finalizar el mes para garantizar la integridad de los reportes.
              </p>
            </div>
            {(role === "OWNER" || role === "ADMIN") && (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="border-amber-300 text-amber-700 hover:bg-amber-100 shrink-0"
              >
                <Link href={`/company/${companyId}/settings`}>Cerrar Período</Link>
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <CalendarIcon className="h-5 w-5 shrink-0 text-green-600" />
            <p className="text-sm font-medium text-green-800">
              Período activo: {MONTH_NAMES[m.activePeriod.month]} {m.activePeriod.year}
            </p>
          </div>
        )
      )}

      {/* ─── Banner: Despacho sin tier activo (ADR-034) ─────────────────── */}
      {showDespachoOnboarding && (
        <DespachoOnboardingBanner companyId={companyId} />
      )}

      {/* ─── Banner: suscripción vencida (solo lectura) ─────────────────── */}
      {subscriptionState.isExpired && (
        <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950/30">
          <AlertCircleIcon className="h-5 w-5 shrink-0 text-red-600 mt-0.5 dark:text-red-400" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">
              Suscripción vencida — modo solo lectura
            </p>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-400">
              Puedes ver y exportar tus datos, pero no crear facturas, retenciones ni operaciones nuevas. Renueva tu plan para volver a operar.
            </p>
          </div>
          {isAdmin && (
            <Link
              href={`/company/${companyId}/upgrade`}
              className="shrink-0 self-center rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              Renovar plan
            </Link>
          )}
        </div>
      )}

      {/* ─── Alerta: vacaciones por agotar ──────────────────────────────── */}
      {vacationAlerts.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
          <AlertCircleIcon className="h-5 w-5 shrink-0 text-orange-500 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-orange-800">
              {vacationAlerts.length === 1
                ? "Un empleado tiene vacaciones por agotarse"
                : `${vacationAlerts.length} empleados tienen vacaciones por agotarse`}
            </p>
            <ul className="mt-1 space-y-0.5">
              {vacationAlerts.map((a) => (
                <li key={a.employeeId} className="text-xs text-orange-700">
                  {a.fullName} —{" "}
                  {a.remaining === 0
                    ? "sin días restantes"
                    : `${a.remaining} día${a.remaining !== 1 ? "s" : ""} restante${a.remaining !== 1 ? "s" : ""}`}{" "}
                  de {a.entitlement} días anuales
                </li>
              ))}
            </ul>
          </div>
          <a
            href={`/company/${companyId}/payroll/vacations`}
            className="shrink-0 text-xs font-medium text-orange-700 hover:underline"
          >
            Ver vacaciones →
          </a>
        </div>
      )}

      {/* ─── Calendario fiscal SENIAT ────────────────────────────────────── */}
      {showKpis && company.rif && (
        <FiscalDeadlineWidget
          companyId={companyId}
          rif={company.rif}
          isSpecialContributor={company.isSpecialContributor ?? false}
        />
      )}

      {/* ─── Accesos rápidos ─────────────────────────────────────────────── */}
      <QuickAccess role={role} companyId={companyId} />

      {/* ─── Métricas contables (OWNER, ADMIN, ACCOUNTANT, VIEWER) ──────── */}
      {showAccountingMetrics && (
        <>
          {/* Utilidad Neta — hero card: lo más importante, primero y más grande */}
          {(() => {
            const netPositive = Number(m.netIncome) >= 0;
            return (
              <div className={`rounded-lg border p-6 ${netPositive ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-sm font-medium ${netPositive ? "text-green-700" : "text-red-700"}`}>
                      Utilidad Neta del Período
                    </p>
                    {/* Q3-4: text-2xl en mobile, text-4xl en sm+ */}
                    <p className={`mt-1 text-2xl sm:text-4xl font-extrabold tracking-tight ${netPositive ? "text-green-700" : "text-red-700"}`}>
                      {fmtBs(m.netIncome)}
                    </p>
                    <p className={`mt-2 text-xs ${netPositive ? "text-green-600" : "text-red-600"}`}>
                      Ingresos {fmtBs(m.totalRevenue)} · Gastos {fmtBs(m.totalExpenses)}
                    </p>
                  </div>
                  {netPositive
                    ? <TrendingUpIcon className="h-10 w-10 text-green-300" />
                    : <TrendingDownIcon className="h-10 w-10 text-red-300" />
                  }
                </div>
              </div>
            );
          })()}

          {/* Fila de métricas de balance — Q3-4: 2 cols en mobile, 4 en lg */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {/* Q3-4: p-3 en mobile, p-5 en sm+ | text-base en mobile, text-xl en sm+ */}
            <div className="rounded-lg border bg-white p-3 sm:p-5">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-xs sm:text-sm">Ingresos</p>
                <TrendingUpIcon className="h-4 w-4 text-green-500 shrink-0" />
              </div>
              <p className="mt-1.5 sm:mt-2 text-base sm:text-xl font-bold text-green-600 truncate">{fmtBs(m.totalRevenue)}</p>
              <p className="text-muted-foreground mt-1 text-xs hidden sm:block">acumulado del período</p>
            </div>

            <div className="rounded-lg border bg-white p-3 sm:p-5">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-xs sm:text-sm">Gastos</p>
                <TrendingDownIcon className="h-4 w-4 text-red-500 shrink-0" />
              </div>
              <p className="mt-1.5 sm:mt-2 text-base sm:text-xl font-bold text-red-600 truncate">{fmtBs(m.totalExpenses)}</p>
              <p className="text-muted-foreground mt-1 text-xs hidden sm:block">acumulado del período</p>
            </div>

            <div className="rounded-lg border bg-white p-3 sm:p-5">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-xs sm:text-sm">Total Activos</p>
                <ScaleIcon className="h-4 w-4 text-blue-500 shrink-0" />
              </div>
              <p className="mt-1.5 sm:mt-2 text-base sm:text-xl font-bold truncate">{fmtBs(m.totalAssets)}</p>
            </div>

            <div className="rounded-lg border bg-white p-3 sm:p-5">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-xs sm:text-sm">Total Pasivos</p>
                <ScaleIcon className="h-4 w-4 text-zinc-400 shrink-0" />
              </div>
              <p className="mt-1.5 sm:mt-2 text-base sm:text-xl font-bold truncate">{fmtBs(m.totalLiabilities)}</p>
            </div>
          </div>

          {m.lastTransaction && (
            <div className="rounded-lg border bg-white p-5">
              <p className="text-muted-foreground mb-3 text-sm">Último Asiento Registrado</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono font-semibold text-blue-600">{m.lastTransaction.number}</p>
                  <p className="mt-0.5 text-sm text-zinc-700">{m.lastTransaction.description}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-zinc-500">
                    {new Date(m.lastTransaction.date).toLocaleDateString("es-VE")}
                  </p>
                  <Link
                    href={`/company/${companyId}/transactions`}
                    className="mt-1 inline-block text-xs text-blue-600 hover:underline"
                  >
                    Ver todos →
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Actividad del período — métricas de sistema, tamaño reducido */}
          <div className="grid gap-3 sm:grid-cols-2 rounded-lg border bg-zinc-50 p-4">
            <div className="flex items-center gap-3">
              <FileTextIcon className="h-4 w-4 shrink-0 text-purple-400" />
              <div>
                <p className="text-xs text-zinc-500">Asientos del mes</p>
                <p className="text-sm font-semibold text-zinc-700">
                  {m.monthTransactions}
                  <span className="ml-1 font-normal text-zinc-500">({m.totalTransactions} en total)</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <BookOpenIcon className="h-4 w-4 shrink-0 text-blue-400" />
              <div>
                <p className="text-xs text-zinc-500">Plan de cuentas</p>
                <p className="text-sm font-semibold text-zinc-700">
                  {m.totalAccounts}
                  <span className="ml-1 font-normal text-zinc-500">cuentas registradas</span>
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ─── Métricas operativas (ADMINISTRATIVE) ────────────────────────── */}
      {role === "ADMINISTRATIVE" && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border bg-white p-5">
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-sm">Facturas este mes</p>
              <ReceiptTextIcon className="h-4 w-4 text-green-500" />
            </div>
            <p className="mt-2 text-2xl font-bold">{m.monthTransactions}</p>
            <p className="text-muted-foreground mt-1 text-xs">movimientos registrados</p>
          </div>

          <div className="col-span-2 flex items-center justify-center rounded-lg border border-dashed bg-white p-8 text-center">
            <div>
              <p className="text-sm font-medium text-zinc-500">Métricas operativas</p>
              <p className="mt-1 text-xs text-zinc-500">
                Facturas por cobrar, pagos pendientes y más en los módulos de Facturas y Cartera.
              </p>
              <Link
                href={`/company/${companyId}/invoices`}
                className="mt-3 inline-block text-sm font-medium text-blue-600 hover:underline"
              >
                Ver Facturas →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ─── KPIs ejecutivos (OWNER, ADMIN, ACCOUNTANT) — posición prioritaria ── */}
      {showKpis && kpiResult?.success && (
        <ExecutiveKpiPanel companyId={companyId} initialData={kpiResult.data} />
      )}

      {/* ─── Tareas pendientes IA (OWNER, ADMIN, ACCOUNTANT) ────────────── */}
      {showKpis && pendingTasksResult?.success && pendingTasksResult.data.tasks.length > 0 && (
        <PendingTasksWidget companyId={companyId} data={pendingTasksResult.data} />
      )}

      {/* ─── Aprobaciones pendientes — Gerente en móvil (Q3-4) ──────────── */}
      {isAdmin && (
        <ManagerApprovalInbox
          companyId={companyId}
          data={{ draftPayrollRuns, draftBudgetsCount, pendingVacationRequestsCount }}
        />
      )}

      {/* ─── Conflictos de concurrencia P2034 (OWNER, ADMIN) ────────────── */}
      {isAdmin && <P2034Widget data={p2034Data} />}

      {/* SetupWizard auto-open se maneja dentro de SetupWizardTrigger (arriba, en el header) */}
    </div>
  );
}
