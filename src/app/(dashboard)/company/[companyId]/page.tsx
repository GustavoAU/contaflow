// src/app/(dashboard)/company/[companyId]/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { getUserCompaniesAction } from "@/modules/auth/actions/user.actions";
import { getDashboardMetricsAction } from "@/modules/accounting/actions/dashboard.actions";
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
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { ROLE_LABELS } from "@/lib/auth-helpers";
import type { UserRole } from "@/lib/nav-items";

type Props = {
  params: Promise<{ companyId: string }>;
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
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
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
                <span className="rounded bg-zinc-100 px-1 text-[9px] text-zinc-400">Pronto</span>
              </div>
            );
          }
          return (
            <Link
              key={link.label}
              href={link.href}
              className="flex flex-col items-center gap-1.5 rounded-lg border bg-white p-3 transition-colors hover:bg-blue-50 hover:border-blue-200"
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

export default async function CompanyDashboardPage({ params }: Props) {
  const { companyId } = await params;

  const companies = await getUserCompaniesAction();
  const company = companies.find((c) => c.id === companyId);
  if (!company) redirect("/dashboard");

  const role = (company.role ?? "ACCOUNTANT") as UserRole;

  const metricsResult = await getDashboardMetricsAction(companyId);
  if (!metricsResult.success) redirect("/dashboard");

  const m = metricsResult.data;
  const showAccountingMetrics = role !== "ADMINISTRATIVE";

  return (
    <div className="space-y-6">
      {/* ─── Encabezado ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{company.name}</h1>
            {company.rif && <p className="text-muted-foreground text-sm">RIF: {company.rif}</p>}
          </div>
          <RoleBadge role={role} />
        </div>
        <DashboardCTA role={role} companyId={companyId} />
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
      {showAccountingMetrics && m.activePeriod && (
        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <CalendarIcon className="h-5 w-5 shrink-0 text-green-600" />
          <p className="text-sm font-medium text-green-800">
            Período activo: {MONTH_NAMES[m.activePeriod.month]} {m.activePeriod.year}
          </p>
        </div>
      )}

      {/* ─── Accesos rápidos ─────────────────────────────────────────────── */}
      <QuickAccess role={role} companyId={companyId} />

      {/* ─── Métricas contables (OWNER, ADMIN, ACCOUNTANT, VIEWER) ──────── */}
      {showAccountingMetrics && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border bg-white p-5">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-sm">Plan de Cuentas</p>
                <BookOpenIcon className="h-4 w-4 text-blue-500" />
              </div>
              <p className="mt-2 text-2xl font-bold">{m.totalAccounts}</p>
              <p className="text-muted-foreground mt-1 text-xs">cuentas registradas</p>
            </div>

            <div className="rounded-lg border bg-white p-5">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-sm">Asientos del Mes</p>
                <FileTextIcon className="h-4 w-4 text-purple-500" />
              </div>
              <p className="mt-2 text-2xl font-bold">{m.monthTransactions}</p>
              <p className="text-muted-foreground mt-1 text-xs">{m.totalTransactions} en total</p>
            </div>

            <div className="rounded-lg border bg-white p-5">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-sm">Ingresos</p>
                <TrendingUpIcon className="h-4 w-4 text-green-500" />
              </div>
              <p className="mt-2 text-2xl font-bold text-green-600">
                {Number(m.totalRevenue).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">acumulado</p>
            </div>

            <div className="rounded-lg border bg-white p-5">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-sm">Gastos</p>
                <TrendingDownIcon className="h-4 w-4 text-red-500" />
              </div>
              <p className="mt-2 text-2xl font-bold text-red-600">
                {Number(m.totalExpenses).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">acumulado</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border bg-white p-5">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-sm">Total Activos</p>
                <ScaleIcon className="h-4 w-4 text-blue-500" />
              </div>
              <p className="mt-2 text-2xl font-bold">
                {Number(m.totalAssets).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
              </p>
            </div>

            <div className="rounded-lg border bg-white p-5">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-sm">Total Pasivos</p>
                <ScaleIcon className="h-4 w-4 text-red-500" />
              </div>
              <p className="mt-2 text-2xl font-bold">
                {Number(m.totalLiabilities).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
              </p>
            </div>

            <div className="rounded-lg border bg-white p-5">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-sm">Utilidad Neta</p>
                {Number(m.netIncome) >= 0 ? (
                  <TrendingUpIcon className="h-4 w-4 text-green-500" />
                ) : (
                  <TrendingDownIcon className="h-4 w-4 text-red-500" />
                )}
              </div>
              <p className={`mt-2 text-2xl font-bold ${Number(m.netIncome) >= 0 ? "text-green-600" : "text-red-600"}`}>
                {Number(m.netIncome).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
              </p>
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
              <p className="mt-1 text-xs text-zinc-400">
                Facturas por cobrar, pagos pendientes y más — disponibles en Fase 28
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

      {m.totalAccounts === 0 && showAccountingMetrics && (
        <OnboardingWizard companyId={companyId} companyName={company.name} />
      )}
    </div>
  );
}
