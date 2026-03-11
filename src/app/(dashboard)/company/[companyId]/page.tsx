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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

type Props = {
  params: Promise<{ companyId: string }>;
};

const MONTH_NAMES = [
  "",
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

export default async function CompanyDashboardPage({ params }: Props) {
  const { companyId } = await params;

  const companies = await getUserCompaniesAction();
  const company = companies.find((c) => c.id === companyId);
  if (!company) redirect("/dashboard");

  const metricsResult = await getDashboardMetricsAction(companyId);
  if (!metricsResult.success) redirect("/dashboard");

  const m = metricsResult.data;

  return (
    <div className="space-y-6">
      {/* ─── Encabezado ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{company.name}</h1>
          {company.rif && <p className="text-muted-foreground text-sm">RIF: {company.rif}</p>}
        </div>
        <Button asChild>
          <Link href={`/company/${companyId}/transactions/new`} className="gap-2">
            <PlusIcon className="h-4 w-4" />
            Nuevo Asiento
          </Link>
        </Button>
      </div>

      {/* ─── Alerta: sin período abierto ────────────────────────────────── */}
      {!m.activePeriod && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertCircleIcon className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">No hay período contable abierto</p>
            <p className="mt-0.5 text-xs text-amber-700">
              No podrás registrar asientos hasta abrir un período.
            </p>
          </div>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="border-amber-300 text-amber-700 hover:bg-amber-100"
          >
            <Link href={`/company/${companyId}/settings`}>Abrir Período</Link>
          </Button>
        </div>
      )}

      {/* ─── Período activo ──────────────────────────────────────────────── */}
      {m.activePeriod && (
        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <CalendarIcon className="h-5 w-5 shrink-0 text-green-600" />
          <p className="text-sm font-medium text-green-800">
            Período activo: {MONTH_NAMES[m.activePeriod.month]} {m.activePeriod.year}
          </p>
        </div>
      )}

      {/* ─── Métricas principales ────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Cuentas */}
        <div className="rounded-lg border bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">Plan de Cuentas</p>
            <BookOpenIcon className="h-4 w-4 text-blue-500" />
          </div>
          <p className="mt-2 text-2xl font-bold">{m.totalAccounts}</p>
          <p className="text-muted-foreground mt-1 text-xs">cuentas registradas</p>
        </div>

        {/* Asientos del mes */}
        <div className="rounded-lg border bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">Asientos del Mes</p>
            <FileTextIcon className="h-4 w-4 text-purple-500" />
          </div>
          <p className="mt-2 text-2xl font-bold">{m.monthTransactions}</p>
          <p className="text-muted-foreground mt-1 text-xs">{m.totalTransactions} en total</p>
        </div>

        {/* Ingresos */}
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

        {/* Gastos */}
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

      {/* ─── Segunda fila ────────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Activos */}
        <div className="rounded-lg border bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">Total Activos</p>
            <ScaleIcon className="h-4 w-4 text-blue-500" />
          </div>
          <p className="mt-2 text-2xl font-bold">
            {Number(m.totalAssets).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
          </p>
        </div>

        {/* Pasivos */}
        <div className="rounded-lg border bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">Total Pasivos</p>
            <ScaleIcon className="h-4 w-4 text-red-500" />
          </div>
          <p className="mt-2 text-2xl font-bold">
            {Number(m.totalLiabilities).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
          </p>
        </div>

        {/* Utilidad neta */}
        <div className="rounded-lg border bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">Utilidad Neta</p>
            {Number(m.netIncome) >= 0 ? (
              <TrendingUpIcon className="h-4 w-4 text-green-500" />
            ) : (
              <TrendingDownIcon className="h-4 w-4 text-red-500" />
            )}
          </div>
          <p
            className={`mt-2 text-2xl font-bold ${
              Number(m.netIncome) >= 0 ? "text-green-600" : "text-red-600"
            }`}
          >
            {Number(m.netIncome).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* ─── Último asiento ──────────────────────────────────────────────── */}
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

      {m.totalAccounts === 0 && (
        <OnboardingWizard companyId={companyId} companyName={company.name} />
      )}
    </div>
  );
}
